/**
 * Remote wave CLI resolution (spec: docs/specs/desktop/desktop-sessions.md 「SSH
 * 远程主机」 scenarios 7/8, desktop-shell.md 「内置 CLI 一致保障」). The CLI that runs
 * on a remote host is THIS app's bundled CLI (resources/wave-cli), pushed over
 * the existing ssh channel — it no longer depends on the remote npm registry or
 * the npm `wave-code` package (whose latest may lag behind the GUI's built-in
 * CLI, the 404 root cause this replaces). One-shot ssh probes run node presence
 * and a content check (sha256 of the remote `dist/bundle/wave.mjs`); when the
 * remote copy is missing/corrupt or its bytes differ from the bundled bundle,
 * the CLI files (bin/wave-code.js + dist/bundle/wave.mjs + package.json) are
 * tarred locally and streamed over ssh stdin into a sibling `.new` dir, then
 * atomically swapped into the fixed remote dir `~/.wave/cli/desktop` (mirrors
 * the local runtime copy, so the shim resolves ../package.json and wave.mjs
 * finds the shared @vscode/ripgrep under `~/.wave/cli/node_modules`). The sync
 * judge is content bytes, not a version string — GUI-only releases can ship new
 * bytes without bumping the bundled version. ripgrep is fetched by the REMOTE
 * side (npm install --prefix) — the platform binary must match the remote host.
 * Every failure surfaces an actionable message — nothing retries indefinitely.
 *
 * All probes/npm run through the user's login shell (`withRemoteLoginShell`):
 * nvm-style version managers expose node/npm only in interactive rc files,
 * which a plain `ssh host 'cmd'` never loads. Pure file-transfer commands (tar
 * push) need no login shell and skip it.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import type { Readable } from "stream";
import { c as createTarStream } from "tar";
import {
  buildSshSpawnArgs,
  buildSshTunnelArgs,
  shellQuote,
  withRemoteLoginShell,
} from "./sshHosts";
import { SocketClient } from "./stdio/socketClient";
import type { BundledCliSource } from "./stdio/binaryResolver";

const execFileAsync = promisify(execFile);

export const REMOTE_NODE_MIN_MAJOR = 22;
export const REMOTE_INSTALL_REGISTRY = "https://registry.npmmirror.com";
const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/** Files of the bundled CLI pushed to remote hosts (mirror of the local copy). */
const CLI_BUNDLE_FILES = ["bin", "dist", "package.json"] as const;

/**
 * Remote runtime layout mirrors the local one (~/.wave/cli/<end>): the CLI
 * files live under `~/.wave/cli/desktop` and the ripgrep packages under the
 * shared `~/.wave/cli/node_modules/@vscode` (sibling of the per-end dir, so a
 * CLI swap never wipes an already-fetched rg — same reasoning as the local
 * resolver). The shim reads ../package.json for `-v` and wave.mjs finds
 * @vscode/ripgrep by walking up to `~/.wave/cli/node_modules`.
 */
export function remoteCliRootDir(homeDir: string): string {
  return path.posix.join(homeDir, ".wave", "cli");
}

export function remoteCliDir(homeDir: string): string {
  return path.posix.join(remoteCliRootDir(homeDir), "desktop");
}

/** Remote entry point: the shim that boots the CLI (executable via shebang). */
export function remoteCliShimPath(homeDir: string): string {
  return path.posix.join(remoteCliDir(homeDir), "bin", "wave-code.js");
}

export interface RemoteCliInfo {
  /** Absolute path to the `wave` binary on the remote host. */
  binaryPath: string;
  nodeVersion: string;
}

/** stderr noise emitted by `bash/zsh -i` without a TTY — skip, not an error. */
const JOB_CONTROL_NOISE =
  /^(bash|zsh): (cannot set terminal process group|no job control in this shell)$/;

function describeError(error: unknown): string {
  const e = error as { stderr?: string; message?: string };
  const lines = (e.stderr ?? e.message ?? String(error)).trim().split("\n");
  return lines.find((line) => !JOB_CONTROL_NOISE.test(line.trim())) ?? lines[0];
}

/**
 * The ssh transport itself failed (host offline, network down, auth rejected,
 * probe timeout) — the probe cannot tell whether the remote directory exists.
 * Callers must NOT treat this as "directory gone": deleting persisted session
 * index entries on a transient outage would lose sessions whose worktree is
 * still intact.
 */
export class RemoteHostUnreachableError extends Error {
  constructor(host: string, cause: unknown) {
    super(`无法连接主机 ${host}：${describeError(cause)}`);
    this.name = "RemoteHostUnreachableError";
  }
}

/**
 * Strip ANSI/OSC escape sequences from remote probe output. Some login shells
 * (zsh with iTerm2/WezTerm-style shell integration) write OSC 1337 markers to
 * stdout on every `-lic` invocation — without a TTY the shell never hides
 * them. They would break every strict parser below (`^v?\d+` version match,
 * first-line home dir, the WAVE_REMOTE_FILE_V1 header…).
 * ESC/BEL are interpolated by char code so the regex source carries no
 * control-character escapes (the no-control-regex lint rejects them).
 */
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const ANSI_ESCAPE_RE = new RegExp(
  `${ESC}\\]` +
    `[^${BEL}${ESC}]*` +
    `(?:${BEL}|${ESC}\\\\)` +
    `|${ESC}\\[[0-9;?]*[ -/]*[@-~]`,
  "g",
);

export function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, "");
}

/** Run a remote probe command under the host's login shell. */
async function remoteCommand(host: string, command: string): Promise<string[]> {
  return buildSshSpawnArgs(host, await withRemoteLoginShell(host, command));
}

/** Probe the remote `node -v`; throws an actionable error when it fails. */
async function probeRemoteNode(host: string): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, "node -v"),
      { timeout: PROBE_TIMEOUT_MS },
    ));
  } catch {
    throw new Error(
      `主机 ${host} 上未检测到 Node.js。请先在远端安装 Node.js ≥ ${REMOTE_NODE_MIN_MAJOR}（https://nodejs.org）后重试`,
    );
  }
  const nodeVersion = stripAnsiEscapes(stdout).trim();
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1]);
  if (!major || major < REMOTE_NODE_MIN_MAJOR) {
    throw new Error(
      `远端 Node.js 版本过低（${nodeVersion}，需要 ≥ ${REMOTE_NODE_MIN_MAJOR}）。请在远端升级 Node.js 后重试`,
    );
  }
  return nodeVersion;
}

/**
 * True when `@vscode/ripgrep` resolves from `~/.wave/cli` on the remote host.
 * The wrapper throws at module load unless the platform optional dependency is
 * installed, so a bare dynamic import is the presence probe (executed from the
 * cli root so Node resolves the bare specifier there, like wave.mjs does by
 * walking up from `~/.wave/cli/desktop/dist/bundle`).
 */
async function remoteRipgrepReady(
  host: string,
  cliRoot: string,
): Promise<boolean> {
  const probe =
    `cd ${shellQuote(cliRoot)} && node -e ` +
    shellQuote(
      `import('@vscode/ripgrep').then((m) => { if (!m || !m.rgPath) process.exit(1); }).catch(() => process.exit(1));`,
    );
  try {
    await execFileAsync("ssh", await remoteCommand(host, probe), {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the remote host can load @vscode/ripgrep — a top-level import of
 * wave.mjs, so the CLI cannot start without it (spec: desktop-shell.md 「内置 CLI 一致
 * 保障」 scenario 8). rg is fetched by the REMOTE side (`npm install --prefix
 * ~/.wave/cli` under the remote login shell): npm picks the wrapper version and
 * the platform binary via the wrapper's optionalDependencies, landing both
 * under `~/.wave/cli/node_modules/@vscode`. Runs BEFORE a CLI swap so a failed
 * fetch leaves the current CLI/daemon intact. Skipped entirely when the bundled
 * CLI declares no @vscode/ripgrep dependency. Throws an actionable error (with
 * a manual command) when the registry is unreachable or npm is absent — a later
 * reconnect retries automatically.
 */
export async function ensureRemoteRipgrep(
  host: string,
  source: BundledCliSource,
  homeDir: string,
): Promise<void> {
  if (!source.rgRange) return; // the CLI bundles no grep dependency
  const cliRoot = remoteCliRootDir(homeDir);
  if (await remoteRipgrepReady(host, cliRoot)) return; // already in place

  const installCommand =
    `npm install --prefix ${shellQuote(cliRoot)} --no-save --no-package-lock ` +
    `--registry=${REMOTE_INSTALL_REGISTRY} @vscode/ripgrep@${shellQuote(source.rgRange)}`;
  try {
    await execFileAsync("ssh", await remoteCommand(host, installCommand), {
      timeout: INSTALL_TIMEOUT_MS,
      // npm writes progress to stderr — swallow it so failures surface only
      // the summarized error below.
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `远端 ripgrep（grep 搜索依赖）安装失败：${describeError(error)}。请手动执行 ssh ${host} "${installCommand}"（server 无出网时需先恢复网络/npm）`,
    );
  }
  if (!(await remoteRipgrepReady(host, cliRoot))) {
    throw new Error(
      `远端 ripgrep 安装后仍不可用。请手动执行 ssh ${host} "${installCommand}"`,
    );
  }
}

/**
 * Stream a local stream into a remote command's stdin over the existing ssh
 * channel and await the remote exit code. Used to ship the tarred CLI bundle.
 * The push runs without a login shell (pure file transfer — no node/npm PATH
 * needed); stderr is captured for the error summary.
 */
function sshStreamCommand(
  host: string,
  args: string[],
  input: Readable,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn("ssh", args, { stdio: ["pipe", "ignore", "pipe"] });
    } catch (error) {
      reject(new Error(`无法启动 ssh：${describeError(error)}`));
      return;
    }
    let stderr = "";
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      input.destroy();
      try {
        child.kill();
      } catch {
        // already gone
      }
      reject(new Error(message));
    };
    child.stderr?.on("data", (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-2048);
    });
    child.once("error", (error) => {
      fail(`ssh 传输失败：${describeError(error)}`);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve();
        return;
      }
      fail(
        `ssh 推送失败（code: ${code}, signal: ${signal ?? ""}${stderr.trim() ? `: ${stderr.trim()}` : ""}）`,
      );
    });
    // EPIPE when ssh dies before consuming all input — the exit handler above
    // already settles the promise.
    child.stdin?.on("error", () => {});
    input.on("error", (error) =>
      fail(`推送内容打包失败：${describeError(error)}`),
    );
    input.pipe(child.stdin!);
  });
}

/**
 * Push the bundled CLI over the existing ssh channel and atomically replace
 * the remote `~/.wave/cli/desktop`: extract the tar stream into a sibling
 * `.new` dir, rename the live dir aside (`.old`), rename `.new` into place,
 * then delete `.old`. A failed push never touches the live dir, so a running
 * old daemon is unaffected (spec scenarios 5/6). @throws on any failure.
 */
async function pushRemoteCliBundle(
  host: string,
  source: BundledCliSource,
  homeDir: string,
): Promise<void> {
  for (const rel of CLI_BUNDLE_FILES) {
    if (!fs.existsSync(path.join(source.dir, rel))) {
      throw new Error(
        `内置 CLI 文件缺失（${path.join(source.dir, rel)}）。请重新安装应用。`,
      );
    }
  }
  const cliRoot = remoteCliRootDir(homeDir);
  const cliDir = remoteCliDir(homeDir);
  const stagingDir = `${cliDir}.new`;
  const backupDir = `${cliDir}.old`;
  // `mv dir dir.old 2>/dev/null || true` tolerates the first install (nothing
  // to move aside); the last `rm -rf` cleanup failure must not mask a
  // successful swap, hence the trailing separators. The explicit chmod covers
  // bundles built on Windows, whose archives carry no executable bit — the
  // daemon and CLI boot execute the shim directly via its shebang.
  const receive =
    `rm -rf ${shellQuote(stagingDir)}; ` +
    `mkdir -p ${shellQuote(cliRoot)} ${shellQuote(stagingDir)}; ` +
    `tar -xf - -C ${shellQuote(stagingDir)} && chmod +x ${shellQuote(path.posix.join(stagingDir, "bin", "wave-code.js"))} || exit 3; ` +
    `mv ${shellQuote(cliDir)} ${shellQuote(backupDir)} 2>/dev/null || true; ` +
    `mv ${shellQuote(stagingDir)} ${shellQuote(cliDir)} || exit 4; ` +
    `rm -rf ${shellQuote(backupDir)}`;
  // tar's own Pack stream type is a different base than node:stream's
  // Readable — structurally it is one (pipe/on/destroy), so narrow it here.
  const archive = createTarStream(
    { cwd: source.dir, gzip: false, portable: true },
    [...CLI_BUNDLE_FILES],
  ) as unknown as Readable;
  await sshStreamCommand(host, buildSshSpawnArgs(host, receive), archive);
}

/**
 * Resolve a runnable wave CLI on the remote host. The binary path is now the
 * fixed runtime shim `~/.wave/cli/desktop/bin/wave-code.js` (never a PATH
 * global install). Ensures Node ≥ 22, then returns the existing CLI when
 * present. With `installIfMissing` (the default), a missing CLI triggers the
 * full install (rg self-fetch + bundle push); with it false the missing case
 * throws an actionable error — the daemon fallback passes false so a failed
 * sync never double-installs within one connection.
 */
export async function resolveRemoteWaveBinary(
  host: string,
  source: BundledCliSource,
  homeDir: string,
  installIfMissing = true,
): Promise<RemoteCliInfo> {
  const nodeVersion = await probeRemoteNode(host);
  const binaryPath = remoteCliShimPath(homeDir);
  const current = await getRemoteBundleSha256(host, homeDir);
  if (current) return { binaryPath, nodeVersion };
  if (!installIfMissing) {
    throw new Error(
      `远端未安装 wave CLI（${binaryPath}）。重新连接主机会自动重试推送`,
    );
  }
  await ensureRemoteRipgrep(host, source, homeDir);
  await pushRemoteCliBundle(host, source, homeDir);
  return { binaryPath, nodeVersion };
}

/**
 * Remote `dist/bundle/wave.mjs` sha256 — null when the probe fails (missing/
 * corrupt CLI files or an ssh error). Mirrors the local content check: callers
 * treat null as "needs sync" rather than crashing. The remote file can only be
 * hashed remotely, so the probe reuses the remote node (guaranteed ≥ 22 by
 * [probeRemoteNode]) instead of the shim's `-v` — an unchanged version number
 * is not trusted as "same CLI" (GUI-only releases can ship new bytes without
 * bumping the bundled version, spec: desktop-shell.md 「内置 CLI 一致保障」 scenarios
 * 3/7). Verifies all three bundle files exist (a `-v`-able shim + package.json
 * + wave.mjs) before hashing, so a partial copy is treated as needing sync.
 */
async function getRemoteBundleSha256(
  host: string,
  homeDir: string,
): Promise<string | null> {
  const cliDir = remoteCliDir(homeDir);
  const probe =
    `node -e ` +
    shellQuote(
      "const fs=require('fs'),crypto=require('crypto');" +
        "const dir=process.argv[1];" +
        "for (const rel of ['bin/wave-code.js','package.json','dist/bundle/wave.mjs']) {" +
        "  if (!fs.existsSync(dir+'/'+rel)) process.exit(1);" +
        "}" +
        "const h=crypto.createHash('sha256').update(fs.readFileSync(dir+'/dist/bundle/wave.mjs')).digest('hex');" +
        "process.stdout.write(h);",
    ) +
    ` ${shellQuote(cliDir)}`;
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, probe),
      { timeout: PROBE_TIMEOUT_MS },
    );
    const hex = stripAnsiEscapes(stdout).trim();
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

export interface RemoteCliUpToDateResult {
  binaryPath: string;
  /** True when the CLI was (re)installed by this call. */
  upgraded: boolean;
}

/**
 * Ensure the remote CLI at ~/.wave/cli/desktop matches the bundled CLI's bytes
 * (spec: desktop-shell.md 「内置 CLI 一致保障」 scenarios 3/6/7). The probe hashes
 * the remote `dist/bundle/wave.mjs`; a null result (missing/corrupt) or a hash
 * differing from `source.bundleSha256` triggers a sync — rg first (a failed
 * fetch must leave the current install intact), then the atomic bundle push.
 * GUI upgrades that ship an unchanged bundle compare equal and push nothing
 * (scenario 7); GUI-only releases with changed bytes but an unchanged version
 * still push. The caller decides what to do about the still-running old daemon.
 */
export async function ensureRemoteCliUpToDate(
  host: string,
  source: BundledCliSource,
  homeDir: string,
): Promise<RemoteCliUpToDateResult> {
  const binaryPath = remoteCliShimPath(homeDir);
  await probeRemoteNode(host);
  const current = await getRemoteBundleSha256(host, homeDir);
  if (current !== null && current === source.bundleSha256) {
    return { binaryPath, upgraded: false };
  }
  // current is null (corrupt/missing) or differs from the bundled bytes → sync.
  await ensureRemoteRipgrep(host, source, homeDir);
  await pushRemoteCliBundle(host, source, homeDir);
  return { binaryPath, upgraded: true };
}

/**
 * Check a directory exists on a remote host via `test -d`. Used to validate
 * user-typed remote workdir paths (spec scenario 3) — the Electron dialog
 * cannot pick remote directories, so the path is a text input.
 *
 * Distinguishes the two failure classes so callers can keep persisted state
 * on transient outages: returns `false` only when the ssh session ran and
 * `test -d` reported the directory missing; throws
 * `RemoteHostUnreachableError` when the transport itself failed (ssh exit
 * code 255 — host down/auth/network — or a probe timeout), where the
 * directory's existence is simply unknown.
 */
export async function remotePathExists(
  host: string,
  remotePath: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      "ssh",
      await remoteCommand(host, `test -d ${shellQuote(remotePath)}`),
      { timeout: PROBE_TIMEOUT_MS },
    );
    return true;
  } catch (error) {
    const e = error as { code?: unknown; killed?: boolean };
    // ssh exits 255 on transport failures and never runs the remote command;
    // a timeout kills the probe; a spawn failure has no numeric exit code.
    // None of them say anything about the directory, so surface them as
    // unreachable rather than reporting "not found".
    if (e.killed || e.code === 255 || typeof e.code !== "number") {
      throw new RemoteHostUnreachableError(host, error);
    }
    return false;
  }
}

export interface RemoteDirListResult {
  /** Normalized absolute path (home expanded, relative components resolved). */
  resolvedPath: string;
  /** Subdirectory names of resolvedPath, sorted by name. */
  dirs: string[];
}

/**
 * List the subdirectories of a remote directory (remote directory browser,
 * spec scenarios 20/21). Runs over ssh under the host's login shell: `~` is
 * expanded by the shell, `cd` normalizes the path (with `pwd` printed as the
 * first output line), and `find -type d` yields directory entries only.
 * Throws with a user-facing message when the path is missing/unreadable (cd
 * fails) or the ssh connection fails.
 */
export async function listRemoteDirs(
  host: string,
  dir: string,
): Promise<RemoteDirListResult> {
  // `~`-prefix handling is shell parameter expansion, so `${p#'~'}` must stay
  // in a plain string literal (a template literal would parse it as JS).
  const command =
    `p=${shellQuote(dir)}; ` +
    `case "$p" in '~') p="$HOME";; '~/'*) p="$HOME` +
    "${p#'~'}" +
    `";; esac; ` +
    `cd "$p" 2>/dev/null || { echo '目录不存在或不可读' >&2; exit 3; }; ` +
    `pwd; find "$p" -maxdepth 1 -mindepth 1 -type d -exec basename {} \\;`;
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, command),
      {
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    const lines = stripAnsiEscapes(stdout)
      .split("\n")
      .filter((line) => line.length > 0);
    const resolvedPath = lines[0] ?? dir;
    const dirs = lines
      .slice(1)
      .filter((name) => name !== "." && name !== "..")
      .sort((a, b) => a.localeCompare(b));
    return { resolvedPath, dirs };
  } catch (error) {
    throw new Error(`读取远端目录失败：${describeError(error)}`);
  }
}

/** Cap for the file panel's remote read: first N lines / bytes are enough. */
export const REMOTE_FILE_MAX_LINES = 2000;
export const REMOTE_FILE_MAX_BYTES = 2 * 1024 * 1024;

export interface RemoteFileReadResult {
  type: "text" | "image" | "binary";
  /** Lowercased mime of the remote file (e.g. text/plain, image/png). */
  mime: string;
  /** Full-file line count (text only; may be undefined when unreadable). */
  totalLines?: number;
  /** True when the payload was truncated to REMOTE_FILE_MAX_* (text only). */
  truncated?: boolean;
  /** base64-encoded text content (text only). */
  contentBase64?: string;
  /** base64-encoded image bytes (image only). */
  imageBase64?: string;
}

/**
 * Read a remote file for the file panel (spec: docs/specs/desktop/desktop-file-panel.md
 * 「文件面板」 scenarios 1-3/14/15/19). A single ssh invocation reports the mime via
 * `file` (flag fallback chain `--mime-type` → `-I` → `-i`, since support varies
 * across file builds; when `file` is missing, common image extensions are
 * mapped instead), inlines images as base64, NUL-detects binaries on the first
 * 8KB, and truncates text to REMOTE_FILE_MAX_BYTES/REMOTE_FILE_MAX_LINES.
 * Output is a fixed-position header (V1 line, type=, mime=, total=,
 * truncated=) followed by one base64 payload line — parsed by position, not by
 * key=value heuristics, because base64 payloads can start with letters.
 * Exit codes: 3 = missing, 4 = unreadable (messages go to stderr).
 */
export async function readRemoteFile(
  host: string,
  remotePath: string,
): Promise<RemoteFileReadResult> {
  const command =
    `p=${shellQuote(remotePath)}; ` +
    `case "$p" in '~') p="$HOME";; '~/'*) p="$HOME` +
    "${p#'~'}" +
    `";; esac; ` +
    `test -f "$p" || { echo '文件不存在' >&2; exit 3; }; ` +
    `test -r "$p" || { echo '文件不可读' >&2; exit 4; }; ` +
    `mime=$(file -b --mime-type "$p" 2>/dev/null | head -1 | tr -d ' \\r\\n'); ` +
    `[ -z "$mime" ] && mime=$(file -b -I "$p" 2>/dev/null | head -1 | tr -d ' \\r\\n'); ` +
    `[ -z "$mime" ] && mime=$(file -b -i "$p" 2>/dev/null | head -1 | tr -d ' \\r\\n'); ` +
    `mime=\${mime%%;*}; mime=$(printf '%s' "$mime" | tr 'A-Z' 'a-z'); ` +
    `if [ -z "$mime" ]; then case "\${p##*.}" in png) mime=image/png;; jpg|jpeg) mime=image/jpeg;; gif) mime=image/gif;; webp) mime=image/webp;; bmp) mime=image/bmp;; ico) mime=image/x-icon;; svg) mime=image/svg+xml;; esac; fi; ` +
    `case "$mime" in image/*) printf 'WAVE_REMOTE_FILE_V1\\ntype=image\\nmime=%s\\ntotal=-\\ntruncated=-\\n%s\\n' "$mime" "$(base64 "$p" | tr -d '\\n')"; exit 0;; esac; ` +
    `prefix=$(head -c 8192 "$p" | wc -c | tr -d ' '); ` +
    `nul=$(head -c 8192 "$p" | LC_ALL=C tr -d '\\000' | wc -c | tr -d ' '); ` +
    `if [ "$nul" -lt "$prefix" ]; then printf 'WAVE_REMOTE_FILE_V1\\ntype=binary\\nmime=%s\\ntotal=-\\ntruncated=-\\n\\n' "$mime"; exit 0; fi; ` +
    `total=$(awk 'END { print NR }' "$p" | tr -d ' '); ` +
    `content=$(head -c ${REMOTE_FILE_MAX_BYTES} "$p" | head -n ${REMOTE_FILE_MAX_LINES}); ` +
    `outbytes=$(printf '%s' "$content" | wc -c | tr -d ' '); ` +
    `if [ "$outbytes" -ge ${REMOTE_FILE_MAX_BYTES} ] || [ "$total" -gt ${REMOTE_FILE_MAX_LINES} ]; then truncated=1; else truncated=0; fi; ` +
    `printf 'WAVE_REMOTE_FILE_V1\\ntype=text\\nmime=%s\\ntotal=%s\\ntruncated=%s\\n%s\\n' "$mime" "$total" "$truncated" "$(printf '%s' "$content" | base64 | tr -d '\\n')"`;
  try {
    // maxBuffer must cover base64(payload) ≈ 1.37 × file size + headers.
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, command),
      {
        timeout: PROBE_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const lines = stripAnsiEscapes(stdout).split("\n");
    if (lines[0] !== "WAVE_REMOTE_FILE_V1") {
      throw new Error("远端返回了无法识别的响应");
    }
    const type = lines[1].replace(/^type=/, "") as RemoteFileReadResult["type"];
    const mime = lines[2].replace(/^mime=/, "");
    const totalLines = Number(lines[3].replace(/^total=/, ""));
    const truncated = lines[4] === "truncated=1";
    const payload = lines.slice(5).join("\n").replace(/\s+$/, "");
    if (type === "image")
      return { type, mime, imageBase64: `data:${mime};base64,${payload}` };
    if (type === "binary") return { type, mime };
    return {
      type,
      mime,
      totalLines: Number.isFinite(totalLines) ? totalLines : undefined,
      truncated,
      contentBase64: payload,
    };
  } catch (error) {
    const e = error as { code?: number };
    if (e.code === 3) throw new Error(`远端文件不存在：${remotePath}`);
    if (e.code === 4) throw new Error(`远端文件不可读：${remotePath}`);
    throw new Error(`读取远端文件失败：${describeError(error)}`);
  }
}

// ── Remote daemon (后台模式) ─────────────────────────────────────
//
// 远端 daemon = `nohup wave --daemon <socket>` 常驻进程（nohup+重定向使 ssh
// 只等启动器 fork 即返回，见 specs「SSH 远程主机」）。桌面端通过
// `ssh -N -L` 转发后复用同一套 JSON-RPC 客户端，因此断线重连只换传输层，
// 会话与挂起审批都在 daemon 进程里存活。本地转发端在 POSIX 是 unix socket、
// Windows 是 127.0.0.1 的 TCP 端口（Windows OpenSSH 无法 bind 本地 unix
// socket，见 connectRemoteDaemon）。

export const DAEMON_START_TIMEOUT_MS = 10_000;
export const DAEMON_POLL_INTERVAL_MS = 500;
/** 等待本地转发 socket 出现（含 connect 重试）的总时长。 */
export const TUNNEL_READY_TIMEOUT_MS = 10_000;

/**
 * Probe the remote user's home directory. `~` is not expanded inside
 * shellQuote single quotes, so the daemon socket path must be built from an
 * explicit `echo $HOME` probe.
 */
export async function getRemoteHomeDir(host: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, "echo $HOME"),
      {
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    const home = stripAnsiEscapes(stdout).trim();
    if (!home) throw new Error("empty");
    return home;
  } catch {
    throw new Error(`无法获取主机 ${host} 的远端主目录（$HOME）`);
  }
}

/** Remote daemon socket path under the user's home (posix). */
export function remoteDaemonSocketPath(homeDir: string): string {
  return path.posix.join(homeDir, ".wave", "daemon.sock");
}

/** Local end of the tunnel: a unique socket per host in the tmp dir. */
export function localDaemonSocketPath(host: string): string {
  return path.join(
    os.tmpdir(),
    `wave-daemon-${host.replace(/[^a-zA-Z0-9_.-]/g, "_")}.sock`,
  );
}

/**
 * True when the remote daemon socket exists AND accepts a probe connection.
 * `test -S` alone can't tell a live daemon from a stale socket left by a
 * crashed one — the daemon would never be relaunched. Probe with node's
 * `net.connect` (node is required to run wave anyway): connect → alive,
 * failure/refused → dead, and `ensureRemoteDaemon` relaunches (the daemon
 * cleans the stale socket itself on start).
 */
export async function remoteDaemonAlive(
  host: string,
  socketPath: string,
): Promise<boolean> {
  const probeScript = `const s=require('net').connect(${JSON.stringify(socketPath)});s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)`;
  try {
    await execFileAsync(
      "ssh",
      await remoteCommand(host, `node -e ${shellQuote(probeScript)}`),
      {
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch the remote daemon detached: `nohup <binary> --daemon <socket>
 * </dev/null >/dev/null 2>&1 &`. nohup + the redirects detach the process from
 * the ssh session and make ssh return immediately after the launcher forks —
 * the daemon keeps running when the tunnel/desktop app goes away.
 */
export async function startRemoteDaemon(
  host: string,
  binaryPath: string,
  socketPath: string,
): Promise<void> {
  const command = `nohup ${shellQuote(binaryPath)} --daemon ${shellQuote(socketPath)} </dev/null >/dev/null 2>&1 &`;
  await execFileAsync("ssh", await remoteCommand(host, command), {
    timeout: PROBE_TIMEOUT_MS,
  });
}

/** Poll `test -S` until the daemon socket appears (or the start timeout elapses). */
export async function waitForRemoteDaemon(
  host: string,
  socketPath: string,
): Promise<void> {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await remoteDaemonAlive(host, socketPath)) return;
    await new Promise((resolve) =>
      setTimeout(resolve, DAEMON_POLL_INTERVAL_MS),
    );
  }
  throw new Error(`远端 wave daemon 启动超时（${host}）`);
}

/**
 * Terminate the remote daemon for `socketPath` (spec 「自动更新 CLI」 scenario 4:
 * after a CLI upgrade the old daemon still runs pre-upgrade code and must be
 * restarted). The `[w]ave` bracket trick keeps pkill's own shell out of the
 * match — its command line contains the literal `[w]ave...` pattern, which the
 * regex does not match — so only the real daemon process dies.
 */
export async function killRemoteDaemon(
  host: string,
  socketPath: string,
): Promise<void> {
  const pattern = `[w]ave.*--daemon.*${socketPath}`;
  await execFileAsync(
    "ssh",
    await remoteCommand(host, `pkill -f ${shellQuote(pattern)} || true`),
    {
      timeout: PROBE_TIMEOUT_MS,
    },
  );
}

/** Poll remoteDaemonAlive until the daemon is gone (or the start timeout elapses). */
export async function waitForRemoteDaemonExit(
  host: string,
  socketPath: string,
): Promise<void> {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await remoteDaemonAlive(host, socketPath))) return;
    await new Promise((resolve) =>
      setTimeout(resolve, DAEMON_POLL_INTERVAL_MS),
    );
  }
  throw new Error(`远端 wave daemon 未能退出（${host}）`);
}

/**
 * Ensure a wave daemon runs on `host` backed by THIS app's bundled CLI (spec:
 * desktop-shell.md 「内置 CLI 一致保障」):
 * 1. ensureRemoteCliUpToDate — push the bundled CLI over ssh when the remote
 *    copy (~/.wave/cli/desktop) is missing, corrupt, or its bytes differ from
 *    the bundled `dist/bundle/wave.mjs` (decoupled from the GUI version). Sync
 *    failures surface via onNotice and fall back to the existing install; the
 *    next reconnect retries.
 * 2. After a successful sync, the still-running old daemon executes pre-sync
 *    code — it MUST be restarted or the sync never takes effect. Kill it and
 *    wait for its socket to release before relaunching.
 * 3. Reuse a live daemon; otherwise make sure ripgrep is fetchable (remote
 *    self-fetch; needed to boot any wave CLI), launch one detached and wait
 *    for its socket. Returns the remote daemon socket path to forward.
 */
export async function ensureRemoteDaemon(
  host: string,
  source: BundledCliSource,
  onNotice?: (message: string) => void,
): Promise<string> {
  const homeDir = await getRemoteHomeDir(host);
  const socketPath = remoteDaemonSocketPath(homeDir);

  let binaryPath: string | undefined;
  let upgraded = false;
  try {
    ({ binaryPath, upgraded } = await ensureRemoteCliUpToDate(
      host,
      source,
      homeDir,
    ));
  } catch (error) {
    console.warn(
      `[remoteCli] ${host} wave CLI 同步失败，继续使用现有安装:`,
      error,
    );
    onNotice?.(
      `远程 wave CLI 同步失败：${error instanceof Error ? error.message : String(error)}。可稍后重新连接主机自动重试`,
    );
  }

  if (upgraded) {
    await killRemoteDaemon(host, socketPath);
    await waitForRemoteDaemonExit(host, socketPath);
  }

  if (await remoteDaemonAlive(host, socketPath)) return socketPath;
  binaryPath ??= (await resolveRemoteWaveBinary(host, source, homeDir, false))
    .binaryPath;
  // A current-bytes CLI that was never restarted still needs rg to boot
  // (the up-to-date path above skips the rg ensure).
  if (!upgraded) await ensureRemoteRipgrep(host, source, homeDir);
  await startRemoteDaemon(host, binaryPath, socketPath);
  await waitForRemoteDaemon(host, socketPath);
  return socketPath;
}

export interface RemoteDaemonConnection {
  client: SocketClient;
  /** The `ssh -N -L` forward process — keep it alive with the connection. */
  tunnel: ChildProcess;
}

/**
 * Pick a free 127.0.0.1 TCP port for the tunnel's local end. The close-then-
 * spawn window is tiny; on a collision ssh exits with "local port forwarding
 * failed" and the tunnel-exit path in connectRemoteDaemonTcp surfaces it.
 */
async function allocateLoopbackPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

/**
 * Connect to the remote wave daemon over an ssh tunnel, choosing the transport
 * per platform. Windows OpenSSH cannot bind a local unix socket for `-L`: its
 * parser rejects drive-letter paths (`C:\...`) and its AF_UNIX bind rejects
 * drive-less paths (`/Users/...`), so the local end there is a 127.0.0.1 TCP
 * port (`-L port:remote_socket`, supported by OpenSSH on every platform).
 * POSIX keeps the unix-socket forward.
 */
export async function connectRemoteDaemon(
  host: string,
  remoteSocketPath: string,
): Promise<RemoteDaemonConnection> {
  return process.platform === "win32"
    ? connectRemoteDaemonTcp(host, remoteSocketPath)
    : connectRemoteDaemonSocket(host, remoteSocketPath);
}

/**
 * `connectRemoteDaemon` for POSIX: forward the remote daemon socket to a local
 * unix socket via `ssh -N -L`, then wrap the local socket in a SocketClient.
 * The tunnel keeps running until the caller disposes both — killing only the
 * client would close the socket but leave the ssh process lingering. Plain
 * `spawn('ssh', …)` (no login shell): `-N` tunnels never run a remote command.
 */
export async function connectRemoteDaemonSocket(
  host: string,
  remoteSocketPath: string,
): Promise<RemoteDaemonConnection> {
  const localSocket = localDaemonSocketPath(host);
  try {
    fs.unlinkSync(localSocket);
  } catch {
    // no stale local socket
  }
  const tunnel = spawn(
    "ssh",
    buildSshTunnelArgs(host, localSocket, remoteSocketPath),
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let tunnelStderr = "";
  tunnel.stderr?.on("data", (data: Buffer) => {
    tunnelStderr = (tunnelStderr + data.toString()).slice(-1024);
  });

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    tunnel.once("exit", (code, signal) => {
      fail(
        new Error(
          `ssh 隧道退出（code: ${code}, signal: ${signal}${tunnelStderr.trim() ? `: ${tunnelStderr.trim()}` : ""}）`,
        ),
      );
    });
    const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
    const attempt = () => {
      if (settled) return;
      if (Date.now() >= deadline) {
        fail(new Error(`本地转发 socket 未就绪（${localSocket}）`));
        return;
      }
      if (!fs.existsSync(localSocket)) {
        setTimeout(attempt, 100);
        return;
      }
      const sock = net.createConnection(localSocket);
      sock.once("connect", () => {
        settled = true;
        resolve(sock);
      });
      sock.once("error", () => {
        setTimeout(attempt, 100);
      });
    };
    attempt();
  }).catch((error) => {
    tunnel.kill();
    throw new Error(`无法连接远端 wave daemon（${describeError(error)}）`);
  });

  return { client: new SocketClient(socket), tunnel };
}

/**
 * `connectRemoteDaemon` for Windows: forward the remote daemon socket to a
 * local loopback TCP port (`ssh -N -L 127.0.0.1:<port>:<remote socket>`) and
 * wrap the port connection in a SocketClient. Same lifecycle as the socket
 * variant — the tunnel keeps running until the caller disposes both.
 */
export async function connectRemoteDaemonTcp(
  host: string,
  remoteSocketPath: string,
): Promise<RemoteDaemonConnection> {
  const port = await allocateLoopbackPort();
  const tunnel = spawn(
    "ssh",
    buildSshTunnelArgs(host, `127.0.0.1:${port}`, remoteSocketPath),
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let tunnelStderr = "";
  tunnel.stderr?.on("data", (data: Buffer) => {
    tunnelStderr = (tunnelStderr + data.toString()).slice(-1024);
  });

  const socket = await new Promise<net.Socket>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    tunnel.once("exit", (code, signal) => {
      fail(
        new Error(
          `ssh 隧道退出（code: ${code}, signal: ${signal}${tunnelStderr.trim() ? `: ${tunnelStderr.trim()}` : ""}）`,
        ),
      );
    });
    const deadline = Date.now() + TUNNEL_READY_TIMEOUT_MS;
    const attempt = () => {
      if (settled) return;
      if (Date.now() >= deadline) {
        fail(new Error(`本地转发端口未就绪（127.0.0.1:${port}）`));
        return;
      }
      const sock = net.createConnection({ host: "127.0.0.1", port });
      sock.once("connect", () => {
        settled = true;
        resolve(sock);
      });
      sock.once("error", () => {
        setTimeout(attempt, 100);
      });
    };
    attempt();
  }).catch((error) => {
    tunnel.kill();
    throw new Error(`无法连接远端 wave daemon（${describeError(error)}）`);
  });

  return { client: new SocketClient(socket), tunnel };
}
