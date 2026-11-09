/**
 * Remote wave CLI resolution (spec: docs/specs/desktop/desktop-remote.md 「SSH
 * 远程主机」 scenarios 7/8, desktop-distribution.md 「内置 CLI 一致保障」). The CLI that runs
 * on a remote host is THIS app's bundled CLI (resources/wave-cli), pushed over
 * the existing ssh channel — it no longer depends on the remote npm registry or
 * the npm `wave-code` package (whose latest may lag behind the GUI's built-in
 * CLI, the 404 root cause this replaces). One-shot ssh probes run a content
 * check (sha256 of the remote `dist/bundle/wave.mjs`); when the remote copy is
 * missing/corrupt or its bytes differ from the bundled bundle, the CLI files
 * (bin/wave-code.js + dist/bundle/wave.mjs + package.json) are tarred locally
 * and streamed over ssh stdin into a sibling `.new` dir, then atomically swapped
 * into the fixed remote dir `~/.wave/cli/desktop` (mirrors the local runtime
 * copy, so the shim resolves ../package.json and wave.mjs finds the shared
 * @vscode/ripgrep under `~/.wave/cli/node_modules`). The sync judge is content
 * bytes, not a version string — GUI-only releases can ship new bytes without
 * bumping the bundled version. Runtime dependencies (ripgrep, sharp) are
 * installed by the remote CLI itself on startup — no npm on the remote host is
 * needed, and a failed download only degrades the affected tool. Every failure
 * surfaces an actionable message — nothing retries indefinitely.
 *
 * The remote host is NOT assumed to have a Node.js: the desktop app runs its
 * local CLI on its own `process.execPath`, which a bare ssh target has no
 * equivalent of. So the same channel also carries a Wave-managed runtime
 * (`~/.wave/runtime/node`, official Node tarball from the npm mirror, see
 * [ensureRemoteRuntime]); every remote process — the CLI push's sha256 probe,
 * the daemon liveness probe, the daemon itself — is launched through it. The
 * CLI shim's shebang is never used on a remote host.
 *
 * All probes run through the user's login shell (`withRemoteLoginShell`): nvm-
 * style version managers expose their directories only in interactive rc files,
 * which a plain `ssh host 'cmd'` never loads — that still matters for the user's
 * own tooling (a WSL distro's login shell `$PATH` is likewise captured for the
 * CLI child, though node itself always comes from the managed runtime).
 * Pure file-transfer commands (tar push) need no login shell and skip it.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { createHash } from "crypto";
import { promisify } from "util";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { c as createTarStream } from "tar";
import {
  buildSshSpawnArgs,
  buildSshTunnelArgs,
  shellQuote,
  withRemoteLoginShell,
} from "./sshHosts";
import { SocketClient } from "./stdio/socketClient";
import type { BundledCliSource } from "./stdio/binaryResolver";
import type { StartupStage } from "wave-agent-sdk/host";
import {
  buildWslExecSpec,
  buildWslRawSpec,
  parseWslHostId,
  withWslLoginShell,
} from "./wslHosts";

const execFileAsync = promisify(execFile);

/**
 * The Node version Wave ships to hosts without one (spec:
 * docs/specs/ui/stdio-transport.md 「托管 Node 运行时」). Pinned, not "latest
 * ≥ 22": the runtime must be reproducible across reconnects and machines, and a
 * marker match is what skips the download. Bumping this constant is the only
 * way an installed runtime gets replaced.
 */
export const MANAGED_RUNTIME_VERSION = "22.14.0";
const DEFAULT_NODE_MIRROR = "https://registry.npmmirror.com/-/binary/node";
/** Records the installed runtime's {version, platform} next to `bin/node`. */
const RUNTIME_MARKER_FILE = ".wave-runtime.json";
/** A Node tarball is ~50MB — slow links need far more headroom than a probe. */
const RUNTIME_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

const PROBE_TIMEOUT_MS = 15_000;

/** Files of the bundled CLI pushed to remote hosts (mirror of the local copy). */
const CLI_BUNDLE_FILES = ["bin", "dist", "package.json"] as const;

/**
 * Remote runtime layout mirrors the local one (~/.wave/cli/<end>): the CLI
 * files live under `~/.wave/cli/desktop` and the runtime dependencies the CLI
 * installs itself (ripgrep, sharp) under the shared `~/.wave/cli/node_modules`
 * (sibling of the per-end dir, so a CLI swap never wipes them — same reasoning
 * as the local resolver). The shim reads ../package.json for `-v` and wave.mjs
 * resolves its dependencies by walking up to `~/.wave/cli/node_modules`.
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
  /** Absolute path to the `wave` entry script on the remote host. */
  binaryPath: string;
  /** Node used to run it — the managed runtime's `node` on every host kind. */
  runtimePath: string;
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
    super(`无法连接${hostLabel(host)}：${describeError(cause)}`);
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

/**
 * Transport for "run this POSIX command on `host`" — the two host kinds share
 * every command in this module (node probe, bundle hash, CLI push, file read),
 * they differ only in the process that carries them: `ssh <host> …` for a
 * remote machine, `wsl.exe -d <distro> …` for a local distro (spec
 * docs/specs/desktop/desktop-wsl.md). Login-shell wrapping is identical on both
 * because the nvm-on-PATH problem is identical.
 */
async function hostCommandSpec(
  host: string,
  command: string,
): Promise<{ file: string; args: string[] }> {
  const distro = parseWslHostId(host);
  if (distro)
    return buildWslExecSpec(distro, await withWslLoginShell(distro, command));
  return { file: "ssh", args: await remoteCommand(host, command) };
}

/** Run one command on `host` and buffer its output. */
async function execOnHost(
  host: string,
  command: string,
  options: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> {
  const spec = await hostCommandSpec(host, command);
  const { stdout, stderr } = await execFileAsync(spec.file, spec.args, options);
  return { stdout: stdout as string, stderr: stderr as string };
}

/** Human-readable "where" for error messages: `主机 dev-box 上` / `WSL 发行版「Ubuntu」内`. */
function hostWhere(host: string): string {
  const distro = parseWslHostId(host);
  return distro ? `WSL 发行版「${distro}」内` : `主机 ${host} 上`;
}

/** The host as a noun for connect-time errors: `主机 dev-box` / `WSL 发行版「Ubuntu」`. */
function hostLabel(host: string): string {
  const distro = parseWslHostId(host);
  return distro ? `WSL 发行版「${distro}」` : `主机 ${host}`;
}

/**
 * Last non-empty line of probe output. `-lic` runs an INTERACTIVE login shell,
 * so the first lines are whatever its rc files print — an Ubuntu WSL user's
 * first login emits "To run a command as administrator…" and a daily motd
 * banner, a zsh with shell integration emits OSC markers (stripped above).
 * Command output is always last, so probes that expect a single value take the
 * last line instead of assuming the whole stdout is it.
 */
function lastMeaningfulLine(text: string): string {
  const lines = stripAnsiEscapes(text).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line) return line;
  }
  return "";
}

/**
 * Possessive form for messages that own a thing on the host: `主机 dev-box 的
 * 远端` / `WSL 发行版「Ubuntu」的`. The ssh wording keeps 远端 because that
 * machine's filesystem is genuinely elsewhere; a distro's is this machine's.
 */
function hostPossessive(host: string): string {
  const distro = parseWslHostId(host);
  return distro ? `${hostLabel(host)}的` : `${hostLabel(host)} 的远端`;
}

// ── Managed Node runtime ─────────────────────────────────────────
//
// A bare ssh target and a JVM plugin host have no `process.execPath` to borrow
// (unlike the desktop app and the VS Code extension, which both run the CLI on
// their own binary), and requiring a system Node ≥ 22 was the single biggest
// deployment obstacle for backend/ops customers. So Wave ships its own: the
// official Node tarball for the host's platform, fetched from the same npm
// mirror as the rest of the runtime deps (ripgrep/sharp), verified against the
// mirror's SHASUMS256.txt, unpacked to `~/.wave/runtime/node` with ONLY
// `bin/node` kept (no npm, no headers, no docs — nothing the CLI needs) and
// stamped with a marker so the next connect skips the download entirely.

/**
 * Base URL the Node tarballs come from (`<base>/v<version>/<file>` plus
 * `<base>/v<version>/SHASUMS256.txt`). Overridable so a private deployment can
 * point every host at an internal mirror without touching the hosts
 * themselves.
 */
export function nodeMirrorBase(): string {
  const override = process.env.WAVE_NODE_MIRROR?.trim();
  return (override || DEFAULT_NODE_MIRROR).replace(/\/+$/, "");
}

/** Remote runtime dir: `~/.wave/runtime/node` (only `bin/node` is kept). */
export function remoteRuntimeDir(homeDir: string): string {
  return path.posix.join(homeDir, ".wave", "runtime", "node");
}

/** The managed `node` binary — what the CLI and every remote script run on. */
export function remoteRuntimeNodePath(homeDir: string): string {
  return path.posix.join(remoteRuntimeDir(homeDir), "bin", "node");
}

export interface HostPlatform {
  /** `uname -s` verbatim (e.g. Linux, Darwin). */
  os: string;
  /** `uname -m` verbatim (e.g. x86_64, aarch64). */
  arch: string;
  /** `musl` when the host links musl (Alpine), else `glibc`. */
  libc: string;
}

/**
 * Markers the runtime probe prints ahead of its payloads. Like
 * WAVE_REMOTE_FILE_V1 they are located by name rather than by position — the
 * login shell's banner and `bash -i`'s job-control noise precede them.
 */
const HOST_PLATFORM_MARKER = "WAVE_HOST_PLATFORM_V1";
const RUNTIME_MARKER = "WAVE_RUNTIME_MARKER_V1";

/** Parse the `WAVE_HOST_PLATFORM_V1 <os>|<arch>|<libc>` probe line. */
export function parseHostPlatform(text: string): HostPlatform | null {
  const line = stripAnsiEscapes(text)
    .split("\n")
    .reverse()
    .find((candidate) => candidate.trim().startsWith(HOST_PLATFORM_MARKER));
  if (!line) return null;
  const [os, arch, libc] = line
    .trim()
    .slice(HOST_PLATFORM_MARKER.length)
    .trim()
    .split("|");
  if (!os || !arch) return null;
  return { os, arch, libc: libc || "glibc" };
}

/**
 * Map a host's uname pair onto Node's official dist key. Only the four targets
 * the desktop app itself ships for exist; anything else gets an actionable
 * error rather than a download that cannot work. musl is called out
 * specifically because the official dist has NO musl build at all (the mirror
 * carries no unofficial/musl path), so an Alpine host cannot be served by a
 * download and a silent glibc fallback would only die later at exec with a
 * cryptic dynamic-loader error.
 */
export function nodePlatformKey(platform: HostPlatform): string {
  const osName =
    platform.os === "Darwin"
      ? "darwin"
      : platform.os === "Linux"
        ? "linux"
        : "";
  // `uname -m` says aarch64 on Linux and arm64 on macOS; Node's dist key is
  // arm64 on both, so Linux ARM hosts would otherwise be rejected outright.
  const arch =
    platform.arch === "x86_64"
      ? "x64"
      : platform.arch === "aarch64"
        ? "arm64"
        : platform.arch;
  if (!osName || (arch !== "x64" && arch !== "arm64")) {
    throw new Error(
      `暂不支持的平台（${platform.os} ${platform.arch}），无法自动获取托管 Node.js 运行时。请反馈该平台以便补充支持`,
    );
  }
  if (platform.libc === "musl") {
    throw new Error(
      `暂不支持 musl libc 的 ${platform.os}（${platform.arch}）：官方 Node.js 不提供 musl 构建，无法自动获取托管运行时。请改用 glibc 发行版，或在主机上手动安装 Node.js ≥ ${MANAGED_RUNTIME_VERSION} 后反馈`,
    );
  }
  return `${osName}-${arch}`;
}

interface NodeRuntimeTarget {
  /** Archive name on the mirror (e.g. node-v22.14.0-linux-x64.tar.gz). */
  file: string;
  /** Member inside the archive that becomes `<runtime>/bin/node`. */
  member: string;
}

/**
 * Official Node POSIX distribution layout: `<top dir>/bin/node`.
 * `.tar.gz`, not the smaller `.tar.xz`: the desktop must be able to unpack it
 * itself on a machine without `xz` (macOS), and Node has no built-in xz
 * decoder — gzip is universal and the transfer goes over ssh anyway.
 */
export function nodeRuntimeTarget(platformKey: string): NodeRuntimeTarget {
  const top = `node-v${MANAGED_RUNTIME_VERSION}-${platformKey}`;
  return { file: `${top}.tar.gz`, member: `${top}/bin/node` };
}

/** Marker body written after a successful install; compared verbatim. */
export function runtimeMarker(platformKey: string): string {
  return JSON.stringify({
    version: MANAGED_RUNTIME_VERSION,
    platform: platformKey,
  });
}

/** Marker body read back from the host ("" when the file is absent). */
export function parseRuntimeMarker(text: string): string {
  const line = stripAnsiEscapes(text)
    .split("\n")
    .reverse()
    .find((candidate) => candidate.trim().startsWith(RUNTIME_MARKER));
  return line ? line.trim().slice(RUNTIME_MARKER.length).trim() : "";
}

/** sha256 for `file` from an official `SHASUMS256.txt` body. */
export function parseSha256Sums(text: string, file: string): string {
  for (const raw of text.split("\n")) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(raw.trim());
    if (match && match[2].trim() === file) return match[1];
  }
  throw new Error(`镜像的 SHASUMS256.txt 中没有 ${file} 的校验值`);
}

/** Fetch a mirror URL into memory (the CDN redirect is followed). */
async function fetchNodeMirror(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(RUNTIME_DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function runtimeDownloadError(url: string, cause: unknown): Error {
  return new Error(
    `获取托管 Node.js 运行时失败：${describeError(cause)}。下载地址 ${url}；` +
      `若当前网络无法访问默认镜像，可把环境变量 WAVE_NODE_MIRROR 指向内部镜像（当前 ${nodeMirrorBase()}）后重试`,
  );
}

/**
 * Download the pinned Node archive and verify it against the mirror's own
 * checksum list. The bytes cross a network and land on a customer host that
 * will execute them, so an unverified download is not acceptable — and
 * SHASUMS256.txt is served next to the archive, so the real hash is always
 * available (no need to trust a byte count or an HTTPS promise alone).
 */
async function downloadNodeRuntime(target: NodeRuntimeTarget): Promise<Buffer> {
  const base = `${nodeMirrorBase()}/v${MANAGED_RUNTIME_VERSION}`;
  const sumsUrl = `${base}/SHASUMS256.txt`;
  const archiveUrl = `${base}/${target.file}`;
  let sums: string;
  try {
    sums = (await fetchNodeMirror(sumsUrl)).toString("utf8");
  } catch (error) {
    throw runtimeDownloadError(sumsUrl, error);
  }
  const expected = parseSha256Sums(sums, target.file);
  let archive: Buffer;
  try {
    archive = await fetchNodeMirror(archiveUrl);
  } catch (error) {
    throw runtimeDownloadError(archiveUrl, error);
  }
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `托管 Node.js 运行时校验失败（${target.file}）：期望 sha256 ${expected}，实际 ${actual}。请检查镜像完整性（${archiveUrl}）`,
    );
  }
  return archive;
}

/** Startup progress callback (spec: docs/specs/ui/stdio-transport.md). */
export type StartupStageReporter = (stage: StartupStage) => void;

/**
 * Report a startup stage without ever letting the reporter break the install:
 * the text is a progress hint, and a host that cannot deliver it (window gone,
 * pane closed) must not fail a 50 MB runtime push.
 */
function notifyStage(
  reporter: StartupStageReporter | undefined,
  stage: StartupStage,
): void {
  try {
    reporter?.(stage);
  } catch {
    // Report-only — never fatal.
  }
}

/**
 * Decide glibc vs musl on the host. The bare presence of a musl loader is NOT
 * proof of a musl system: Ubuntu/Debian's `musl` + `musl-tools` packages
 * (installed by anyone cross-compiling) drop `/lib/ld-musl-x86_64.so.1` onto a
 * perfectly ordinary glibc machine. Reading that file as "Alpine" refused the
 * whole host with `暂不支持 musl libc` — the reported symptom on a stock
 * Ubuntu-24.04 distro.
 *
 * `getconf GNU_LIBC_VERSION` is glibc answering about itself (musl's getconf
 * does not know the variable and prints nothing on stdout), so it is asked
 * first; the loader file is only consulted when getconf cannot answer, and
 * glibc is the default when neither does (macOS, minimal images). `ldd` cannot
 * answer at all: it is a wrapper on glibc and absent on musl.
 */
const LIBC_PROBE =
  "if getconf GNU_LIBC_VERSION >/dev/null 2>&1; then echo glibc; " +
  "elif [ -e /lib/ld-musl-x86_64.so.1 ] || [ -e /lib/ld-musl-aarch64.so.1 ]; then echo musl; " +
  "else echo glibc; fi";

/**
 * Probe the host's platform AND the installed runtime marker in one round trip
 * (an ssh round trip is the expensive unit here).
 */
async function probeRuntimeState(
  host: string,
  markerPath: string,
): Promise<{ platform: HostPlatform; marker: string }> {
  const command =
    `printf '%s\\n' "${HOST_PLATFORM_MARKER} $(uname -s)|$(uname -m)|$(${LIBC_PROBE})"; ` +
    `printf '%s\\n' "${RUNTIME_MARKER} $(cat ${shellQuote(markerPath)} 2>/dev/null)"`;
  const { stdout } = await execOnHost(host, command, {
    timeout: PROBE_TIMEOUT_MS,
  });
  const platform = parseHostPlatform(stdout);
  if (!platform) {
    throw new Error(
      `${hostWhere(host)}无法识别运行环境（uname 输出：${lastMeaningfulLine(stdout) || "空"}）`,
    );
  }
  return { platform, marker: parseRuntimeMarker(stdout) };
}

/**
 * Download, ship and install the managed runtime, then swap it in. Same
 * `.new`/`.old` atomic swap as the CLI bundle: extract into a staging dir, keep
 * only `bin/node`, VERIFY IT RUNS on the host — the sha256 proves the bytes
 * crossed intact, only an exec proves the binary matches the host's libc and
 * CPU — then rename into place. A failed push leaves the previous runtime
 * untouched, so a running daemon keeps working.
 */
async function pushRemoteRuntime(
  host: string,
  homeDir: string,
  platformKey: string,
  onStage?: StartupStageReporter,
): Promise<void> {
  const target = nodeRuntimeTarget(platformKey);
  // Only reached when the marker does not match, i.e. the download really
  // happens — a warm host never reports this (no false "downloading" text).
  notifyStage(onStage, "downloadingRuntime");
  const archive = await downloadNodeRuntime(target);
  notifyStage(onStage, "installingRuntime");
  const runtimeDir = remoteRuntimeDir(homeDir);
  const stagingDir = `${runtimeDir}.new`;
  const backupDir = `${runtimeDir}.old`;
  const stagingNode = path.posix.join(stagingDir, "bin", "node");
  const member = path.posix.join(stagingDir, target.member);
  const receive =
    `rm -rf ${shellQuote(stagingDir)}; ` +
    `mkdir -p ${shellQuote(path.posix.join(stagingDir, "bin"))}; ` +
    `tar -xzf - -C ${shellQuote(stagingDir)} ${shellQuote(target.member)} || exit 3; ` +
    // Bundles built on Windows carry no executable bit; the runtime is exec'd
    // directly, so set it explicitly rather than trusting the archive.
    `chmod +x ${shellQuote(member)} || exit 4; ` +
    `mv ${shellQuote(member)} ${shellQuote(stagingNode)} || exit 5; ` +
    `rm -rf ${shellQuote(path.posix.join(stagingDir, target.member.split("/")[0]))}`;
  await hostStreamCommand(host, receive, Readable.from([archive]));

  const discard = async () => {
    try {
      await execOnHost(host, `rm -rf ${shellQuote(stagingDir)}`, {
        timeout: PROBE_TIMEOUT_MS,
      });
    } catch {
      // Best effort — a leftover `.new` is wiped by the next push anyway.
    }
  };

  let versionOutput = "";
  try {
    ({ stdout: versionOutput } = await execOnHost(
      host,
      `${shellQuote(stagingNode)} --version`,
      { timeout: PROBE_TIMEOUT_MS },
    ));
  } catch (error) {
    await discard();
    throw new Error(
      `${hostWhere(host)}托管 Node.js 运行时无法执行（${describeError(error)}）。请反馈该主机平台（${platformKey}）以便补充支持`,
    );
  }
  const reported = lastMeaningfulLine(versionOutput);
  if (reported !== `v${MANAGED_RUNTIME_VERSION}`) {
    await discard();
    throw new Error(
      `${hostWhere(host)}托管 Node.js 运行时版本异常（期望 v${MANAGED_RUNTIME_VERSION}，实际 ${reported || "无输出"}）`,
    );
  }

  // The marker is written INTO the staging dir before the swap, so a runtime
  // that is installed is always a runtime with a marker — no window where the
  // next connect sees `bin/node` but no marker (and redownloads 50MB).
  const finalize =
    `printf '%s' ${shellQuote(runtimeMarker(platformKey))} > ${shellQuote(path.posix.join(stagingDir, RUNTIME_MARKER_FILE))} || exit 6; ` +
    `rm -rf ${shellQuote(backupDir)}; ` +
    `mv ${shellQuote(runtimeDir)} ${shellQuote(backupDir)} 2>/dev/null || true; ` +
    `mv ${shellQuote(stagingDir)} ${shellQuote(runtimeDir)} || exit 7; ` +
    `rm -rf ${shellQuote(backupDir)}`;
  try {
    await execOnHost(host, finalize, { timeout: PROBE_TIMEOUT_MS });
  } catch (error) {
    await discard();
    throw new Error(`安装托管 Node.js 运行时失败（${describeError(error)}）`);
  }
}

/**
 * Ensure the host has the managed runtime and return the absolute `node` path.
 * One rule for every host kind — SSH remote and local WSL distro alike: this is
 * the node that runs the host's one-shot probes, the daemon and the CLI, and
 * what the host itself has (nothing, an old Node, an nvm-managed one) is never
 * consulted (spec docs/specs/desktop/desktop-wsl.md 场景 6/20). A marker
 * matching {pinned version, host platform} short-circuits, so the download
 * happens only on first use, after a Wave upgrade that bumps
 * [MANAGED_RUNTIME_VERSION], or when the host platform changed.
 */
async function ensureRemoteRuntime(
  host: string,
  homeDir: string,
  onStage?: StartupStageReporter,
): Promise<string> {
  const markerPath = path.posix.join(
    remoteRuntimeDir(homeDir),
    RUNTIME_MARKER_FILE,
  );
  const { platform, marker } = await probeRuntimeState(host, markerPath);
  const platformKey = nodePlatformKey(platform);
  if (marker !== runtimeMarker(platformKey)) {
    await pushRemoteRuntime(host, homeDir, platformKey, onStage);
  }
  return remoteRuntimeNodePath(homeDir);
}

/**
 * A node path → shell-safe. The bare `node` fallback only applies to the daemon
 * helpers' optional argument (a caller that resolved no runtime); every resolved
 * host path is absolute.
 */
function nodeCommand(runtimePath?: string): string {
  return runtimePath ? shellQuote(runtimePath) : "node";
}

/**
 * Stream a local stream into a host command's stdin and await its exit code.
 * Used to ship the tarred CLI bundle over either transport (ssh channel or
 * `wsl.exe`). The push runs without a login shell (pure file transfer — no node
 * PATH needed); stderr is captured for the error summary.
 */
async function hostStreamCommand(
  host: string,
  command: string,
  input: Readable,
): Promise<void> {
  const distro = parseWslHostId(host);
  const transport = distro ? "wsl.exe" : "ssh";
  let spec: { file: string; args: string[] };
  try {
    spec = distro
      ? buildWslRawSpec(distro, command)
      : // ssh takes the plain command (no login shell): pure file transfer.
        { file: transport, args: buildSshSpawnArgs(host, command) };
  } catch (error) {
    input.destroy();
    throw new Error(`无法启动 ${transport}：${describeError(error)}`);
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(spec.file, spec.args, {
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      input.destroy();
      reject(new Error(`无法启动 ${transport}：${describeError(error)}`));
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
      fail(`${transport} 传输失败：${describeError(error)}`);
    });
    child.once("exit", (code, signal) => {
      if (settled) return;
      if (code === 0) {
        settled = true;
        resolve();
        return;
      }
      fail(
        `${transport} 推送失败（code: ${code}, signal: ${signal ?? ""}${stderr.trim() ? `: ${stderr.trim()}` : ""}）`,
      );
    });
    // EPIPE when the transport dies before consuming all input — the exit
    // handler above already settles the promise.
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
  await hostStreamCommand(host, receive, archive);
}

/**
 * Resolve a runnable wave CLI on the remote host. The binary path is the fixed
 * runtime shim `~/.wave/cli/desktop/bin/wave-code.js` (never a PATH global
 * install) and it is run by the managed runtime — the returned [RemoteCliInfo]
 * carries both so no caller has to re-derive them. With `installIfMissing` (the
 * default), a missing CLI triggers the full install (bundle push); with it
 * false the missing case throws an actionable error — the daemon fallback
 * passes false so a failed sync never double-installs within one connection.
 */
export async function resolveRemoteWaveBinary(
  host: string,
  source: BundledCliSource,
  homeDir: string,
  installIfMissing = true,
): Promise<RemoteCliInfo> {
  const runtimePath = await ensureRemoteRuntime(host, homeDir);
  const binaryPath = remoteCliShimPath(homeDir);
  const current = await getRemoteBundleSha256(host, homeDir, runtimePath);
  if (current) return { binaryPath, runtimePath };
  if (!installIfMissing) {
    throw new Error(
      `远端未安装 wave CLI（${binaryPath}）。重新连接主机会自动重试推送`,
    );
  }
  await pushRemoteCliBundle(host, source, homeDir);
  return { binaryPath, runtimePath };
}

/**
 * Remote `dist/bundle/wave.mjs` sha256 — null when the probe fails (missing/
 * corrupt CLI files or an ssh error). Mirrors the local content check: callers
 * treat null as "needs sync" rather than crashing. The remote file can only be
 * hashed remotely, so the probe runs a small script on `runtimePath` (the
 * managed runtime — the shim's `-v` would execute the CLI, and an unchanged
 * version number is not trusted as "same CLI" anyway: GUI-only releases can
 * ship new bytes without bumping the bundled version, spec:
 * desktop-distribution.md 「内置 CLI 一致保障」 scenarios 3/7). Verifies all three bundle
 * files exist (a `-v`-able shim + package.json + wave.mjs) before hashing, so a
 * partial copy is treated as needing sync.
 */
async function getRemoteBundleSha256(
  host: string,
  homeDir: string,
  runtimePath?: string,
): Promise<string | null> {
  const cliDir = remoteCliDir(homeDir);
  const probe =
    `${nodeCommand(runtimePath)} -e ` +
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
    const { stdout } = await execOnHost(host, probe, {
      timeout: PROBE_TIMEOUT_MS,
    });
    // Last line, not the whole stdout: the login shell's banner precedes it.
    const hex = lastMeaningfulLine(stdout);
    return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
  } catch {
    return null;
  }
}

export interface RemoteCliUpToDateResult {
  binaryPath: string;
  /** Node that runs the CLI on the host (see [RemoteCliInfo.runtimePath]). */
  runtimePath: string;
  /** True when the CLI was (re)installed by this call. */
  upgraded: boolean;
}

/**
 * Ensure the remote CLI at ~/.wave/cli/desktop matches the bundled CLI's bytes
 * (spec: desktop-distribution.md 「内置 CLI 一致保障」 scenarios 3/6/7). The managed
 * runtime is resolved first; it is what runs both the hash probe and — later —
 * the CLI itself, on every host kind. A null hash
 * (missing/corrupt) or one differing from `source.bundleSha256` triggers the
 * atomic bundle push. GUI upgrades that ship an unchanged bundle compare equal
 * and push nothing (scenario 7); GUI-only releases with changed bytes but an
 * unchanged version still push. The caller decides what to do about the
 * still-running old daemon.
 */
export async function ensureRemoteCliUpToDate(
  host: string,
  source: BundledCliSource,
  homeDir: string,
  onStage?: StartupStageReporter,
): Promise<RemoteCliUpToDateResult> {
  const binaryPath = remoteCliShimPath(homeDir);
  const runtimePath = await ensureRemoteRuntime(host, homeDir, onStage);
  const current = await getRemoteBundleSha256(host, homeDir, runtimePath);
  if (current !== null && current === source.bundleSha256) {
    return { binaryPath, runtimePath, upgraded: false };
  }
  // current is null (corrupt/missing) or differs from the bundled bytes → sync.
  notifyStage(onStage, "syncingCli");
  await pushRemoteCliBundle(host, source, homeDir);
  return { binaryPath, runtimePath, upgraded: true };
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
    const { stdout } = await execOnHost(host, command, {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const all = stripAnsiEscapes(stdout).split("\n");
    // The login shell's banner/motd precedes the payload — locate the header
    // instead of assuming line 0 (an Ubuntu WSL user's first login prints it).
    const start = all.indexOf("WAVE_REMOTE_FILE_V1");
    if (start < 0) {
      throw new Error("远端返回了无法识别的响应");
    }
    const lines = all.slice(start);
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
// 远端 daemon = `nohup <托管运行时> <shim> --daemon <socket>` 常驻进程（nohup+
// 重定向使 ssh 只等启动器 fork 即返回，见 specs「SSH 远程主机」）。桌面端通过
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
    const { stdout } = await execOnHost(host, "echo $HOME", {
      timeout: PROBE_TIMEOUT_MS,
    });
    // Last line: the login shell's banner comes first, `echo $HOME` answers last.
    const home = lastMeaningfulLine(stdout);
    if (!home) throw new Error("empty");
    return home;
  } catch (error) {
    // Carry the transport's own words: a distro that refuses the probe (Rancher
    // Desktop's implementation distros reject interactive commands) otherwise
    // reports a bare "cannot get $HOME" with no way to tell why.
    throw new Error(
      `无法获取${hostPossessive(host)}主目录（$HOME）：${describeError(error)}`,
    );
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
 * `net.connect` on the host's runtime (`runtimePath`, i.e. the managed node;
 * omitted only when the caller has none yet, which falls back to a PATH node):
 * connect → alive, failure/refused → dead, and `ensureRemoteDaemon` relaunches
 * (the daemon cleans the stale socket itself on start).
 */
export async function remoteDaemonAlive(
  host: string,
  socketPath: string,
  runtimePath?: string,
): Promise<boolean> {
  const probeScript = `const s=require('net').connect(${JSON.stringify(socketPath)});s.on('connect',()=>process.exit(0));s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),3000)`;
  try {
    await execFileAsync(
      "ssh",
      await remoteCommand(
        host,
        `${nodeCommand(runtimePath)} -e ${shellQuote(probeScript)}`,
      ),
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
 * Launch the remote daemon detached: `nohup <runtime> <entry> --daemon <socket>
 * </dev/null >/dev/null 2>&1 &`. The runtime is passed explicitly instead of
 * relying on the shim's shebang: on a host without a system node the shebang
 * resolves nothing, and the managed runtime is the only guaranteed interpreter.
 * nohup + the redirects detach the process from the ssh session and make ssh
 * return immediately after the launcher forks — the daemon keeps running when
 * the tunnel/desktop app goes away.
 */
export async function startRemoteDaemon(
  host: string,
  runtimePath: string,
  binaryPath: string,
  socketPath: string,
): Promise<void> {
  const command = `nohup ${nodeCommand(runtimePath)} ${shellQuote(binaryPath)} --daemon ${shellQuote(socketPath)} </dev/null >/dev/null 2>&1 &`;
  await execFileAsync("ssh", await remoteCommand(host, command), {
    timeout: PROBE_TIMEOUT_MS,
  });
}

/** Poll the socket probe until the daemon appears (or the start timeout elapses). */
export async function waitForRemoteDaemon(
  host: string,
  socketPath: string,
  runtimePath?: string,
): Promise<void> {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await remoteDaemonAlive(host, socketPath, runtimePath)) return;
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

/** Poll the socket probe until the daemon is gone (or the start timeout elapses). */
export async function waitForRemoteDaemonExit(
  host: string,
  socketPath: string,
  runtimePath?: string,
): Promise<void> {
  const deadline = Date.now() + DAEMON_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await remoteDaemonAlive(host, socketPath, runtimePath))) return;
    await new Promise((resolve) =>
      setTimeout(resolve, DAEMON_POLL_INTERVAL_MS),
    );
  }
  throw new Error(`远端 wave daemon 未能退出（${host}）`);
}

/**
 * Ensure a wave daemon runs on `host` backed by THIS app's bundled CLI (spec:
 * desktop-distribution.md 「内置 CLI 一致保障」):
 * 1. ensureRemoteCliUpToDate — resolve/install the managed runtime, then push
 *    the bundled CLI over ssh when the remote copy (~/.wave/cli/desktop) is
 *    missing, corrupt, or its bytes differ from the bundled
 *    `dist/bundle/wave.mjs` (decoupled from the GUI version). Failures surface
 *    via onNotice and fall back to whatever install already exists; the next
 *    reconnect retries.
 * 2. After a successful sync, the still-running old daemon executes pre-sync
 *    code — it MUST be restarted or the sync never takes effect. Kill it and
 *    wait for its socket to release before relaunching.
 * 3. Reuse a live daemon, else launch one detached through the managed runtime
 *    and wait for its socket. Returns the remote daemon socket path to forward.
 */
export async function ensureRemoteDaemon(
  host: string,
  source: BundledCliSource,
  onNotice?: (message: string) => void,
  onStage?: StartupStageReporter,
): Promise<string> {
  notifyStage(onStage, "checkingEnvironment");
  const homeDir = await getRemoteHomeDir(host);
  const socketPath = remoteDaemonSocketPath(homeDir);

  let info: RemoteCliUpToDateResult | undefined;
  try {
    info = await ensureRemoteCliUpToDate(host, source, homeDir, onStage);
  } catch (error) {
    console.warn(
      `[remoteCli] ${host} wave CLI 同步失败，继续使用现有安装:`,
      error,
    );
    onNotice?.(
      `远程 wave CLI 同步失败：${error instanceof Error ? error.message : String(error)}。可稍后重新连接主机自动重试`,
    );
  }

  if (info?.upgraded) {
    await killRemoteDaemon(host, socketPath);
    await waitForRemoteDaemonExit(host, socketPath, info.runtimePath);
  }

  if (info) {
    if (await remoteDaemonAlive(host, socketPath, info.runtimePath))
      return socketPath;
  } else if (await remoteDaemonAlive(host, socketPath)) {
    // Sync failed, but a daemon from an earlier connect is still serving —
    // reuse it rather than failing the whole connection over a transient
    // sync error.
    return socketPath;
  }

  // No live daemon: resolve the CLI (no second install attempt — a failed sync
  // must not double-install within one connection), then launch it.
  const resolved =
    info ?? (await resolveRemoteWaveBinary(host, source, homeDir, false));
  await startRemoteDaemon(
    host,
    resolved.runtimePath,
    resolved.binaryPath,
    socketPath,
  );
  await waitForRemoteDaemon(host, socketPath, resolved.runtimePath);
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
      windowsHide: true,
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
      windowsHide: true,
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
