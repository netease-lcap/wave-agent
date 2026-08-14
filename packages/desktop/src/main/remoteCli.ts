/**
 * Remote wave CLI resolution (spec: docs/specs/ui/desktop-app.md 「SSH 远程主
 * 机」 scenarios 7/8). One-shot ssh probes run node presence/version and
 * `command -v wave`; a missing CLI triggers a best-effort auto-install via the
 * npmmirror registry, then the flow continues. Every failure surfaces an
 * actionable message — nothing retries indefinitely.
 *
 * All probes run through the user's login shell (`withRemoteLoginShell`):
 * nvm-style version managers expose node/npm only in interactive rc files,
 * which a plain `ssh host 'cmd'` never loads.
 */

import { execFile, spawn, type ChildProcess } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";
import * as path from "path";
import {
  buildSshSpawnArgs,
  buildSshTunnelArgs,
  shellQuote,
  withRemoteLoginShell,
} from "./sshHosts";
import { SocketClient } from "./stdio/socketClient";
import { parseVersion, compareVersions } from "./version";

const execFileAsync = promisify(execFile);

export const REMOTE_NODE_MIN_MAJOR = 20;
export const REMOTE_INSTALL_REGISTRY = "https://registry.npmmirror.com";
const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

/**
 * Strict semver — versions are interpolated into the remote shell command
 * (login shell via ssh), so a non-semver version must never reach it.
 */
const SEMVER_RE = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * Build the remote `npm install -g wave-code[@<version>]` command. Pins the
 * exact version when one is known (same semantics as the local resolvers),
 * otherwise installs the bare package (resolves to @latest). Throws
 * "Invalid version" on non-semver input — the same no-shell-injection
 * guarantee upgradeRemoteWave holds.
 */
function remoteInstallCommand(targetVersion?: string): string {
  if (targetVersion != null && !SEMVER_RE.test(targetVersion)) {
    throw new Error(`Invalid version: ${targetVersion}`);
  }
  const spec =
    targetVersion == null ? "wave-code" : `wave-code@${targetVersion}`;
  return `npm install -g ${spec} --registry=${REMOTE_INSTALL_REGISTRY}`;
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

/** Run a remote probe command under the host's login shell. */
async function remoteCommand(host: string, command: string): Promise<string[]> {
  return buildSshSpawnArgs(host, await withRemoteLoginShell(host, command));
}

/**
 * Resolve the remote `wave` binary for `host`. Steps:
 * 1. `node -v` — must be present and ≥ REMOTE_NODE_MIN_MAJOR.
 * 2. `command -v wave` — return the path when found.
 * 3. (installIfMissing) `npm install -g wave-code[@<version>] --registry=…`, then re-probe.
 * Throws with an actionable, user-facing error on any failure.
 */
export async function resolveRemoteWaveBinary(
  host: string,
  installIfMissing = true,
  targetVersion?: string,
): Promise<RemoteCliInfo> {
  let nodeVersion = "";
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, "node -v"),
      {
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    nodeVersion = stdout.trim();
  } catch {
    throw new Error(
      `主机 ${host} 上未检测到 Node.js。请先在远端安装 Node.js ≥ ${REMOTE_NODE_MIN_MAJOR}（https://nodejs.org）后重试`,
    );
  }
  const major = Number(/^v?(\d+)/.exec(nodeVersion)?.[1]);
  if (!major || major < REMOTE_NODE_MIN_MAJOR) {
    throw new Error(
      `远端 Node.js 版本过低（${nodeVersion}，需要 ≥ ${REMOTE_NODE_MIN_MAJOR}）。请在远端升级 Node.js 后重试`,
    );
  }

  const probeWave = async (): Promise<string> => {
    try {
      const { stdout } = await execFileAsync(
        "ssh",
        await remoteCommand(host, "command -v wave"),
        {
          timeout: PROBE_TIMEOUT_MS,
        },
      );
      return stdout.trim();
    } catch {
      return "";
    }
  };

  const found = await probeWave();
  if (found) return { binaryPath: found, nodeVersion };

  const installCommand = remoteInstallCommand(targetVersion);
  if (installIfMissing) {
    try {
      await execFileAsync("ssh", await remoteCommand(host, installCommand), {
        timeout: INSTALL_TIMEOUT_MS,
        // npm writes progress to stderr — swallow it so failures surface only
        // the summarized error below.
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      throw new Error(
        `远端 wave-code 自动安装失败：${describeError(error)}。请手动执行 ssh ${host} "${installCommand}"`,
      );
    }
    const afterInstall = await probeWave();
    if (afterInstall) return { binaryPath: afterInstall, nodeVersion };
  }

  throw new Error(
    `远端未安装 wave-code CLI。请手动执行 ssh ${host} "${installCommand}" 后重试`,
  );
}

/**
 * Remote `wave -v` — null when the probe fails (missing/corrupt binary or ssh
 * error). Mirrors local getCliVersion: callers treat null as "needs upgrade"
 * rather than crashing.
 */
async function getRemoteCliVersion(
  host: string,
  binaryPath: string,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      await remoteCommand(host, `${shellQuote(binaryPath)} -v`),
      {
        timeout: PROBE_TIMEOUT_MS,
      },
    );
    const line = stdout.trim().split("\n")[0]?.trim();
    if (!line) return null;
    // `wave -v` prints the bare version; tolerate a leading "v" just in case.
    return line.replace(/^v/, "");
  } catch {
    return null;
  }
}

/**
 * Upgrade the remote wave CLI to a specific version via npm global install
 * (spec: desktop-app.md 「自动更新 CLI」 scenario 3). The version is validated
 * against a strict semver pattern before it is interpolated into the remote
 * shell command — the same no-shell-injection guarantee the local
 * upgradeWaveBinary holds. Returns the freshly resolved binary path.
 */
export async function upgradeRemoteWave(
  host: string,
  targetVersion: string,
): Promise<string> {
  const installCommand = remoteInstallCommand(targetVersion);
  try {
    await execFileAsync("ssh", await remoteCommand(host, installCommand), {
      timeout: INSTALL_TIMEOUT_MS,
      // npm writes progress to stderr — swallow it so failures surface only
      // the summarized error below.
      maxBuffer: 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `远端 wave-code 升级失败：${describeError(error)}。请手动执行 ssh ${host} "${installCommand}"`,
    );
  }
  return (await resolveRemoteWaveBinary(host)).binaryPath;
}

export interface RemoteCliUpToDateResult {
  binaryPath: string;
  /** True when the CLI was upgraded by this call. */
  upgraded: boolean;
}

/**
 * Ensure the remote wave CLI version is >= targetVersion (spec: desktop-app.md
 * 「自动更新 CLI」 scenarios 3/4). Mirrors local ensureCliUpToDate: resolve →
 * `wave -v` → compare → upgrade when the version is null (corrupt) or older.
 * The caller decides what to do about the still-running old daemon.
 */
export async function ensureRemoteCliUpToDate(
  host: string,
  targetVersion: string,
): Promise<RemoteCliUpToDateResult> {
  const { binaryPath } = await resolveRemoteWaveBinary(
    host,
    true,
    targetVersion,
  );
  const current = await getRemoteCliVersion(host, binaryPath);
  if (current !== null) {
    const cur = parseVersion(current);
    const target = parseVersion(targetVersion);
    if (cur && target && compareVersions(cur, target) >= 0) {
      return { binaryPath, upgraded: false };
    }
  }
  // current is null (unreadable) or older than target → upgrade.
  return {
    binaryPath: await upgradeRemoteWave(host, targetVersion),
    upgraded: true,
  };
}

/**
 * Check a directory exists on a remote host via `test -d`. Used to validate
 * user-typed remote workdir paths (spec scenario 3) — the Electron dialog
 * cannot pick remote directories, so the path is a text input.
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
  } catch {
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
    const lines = stdout.split("\n").filter((line) => line.length > 0);
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
 * Read a remote file for the file panel (spec: docs/specs/ui/desktop-app.md 「文
 * 件面板」 scenarios 1-3/14/15/19). A single ssh invocation reports the mime via
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
    const lines = stdout.split("\n");
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
    const home = stdout.trim();
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
 * Ensure a wave daemon runs on `host` with a compatible CLI version:
 * 1. ensureRemoteCliUpToDate — upgrade the remote wave CLI to targetVersion
 *    when it is older. Upgrade failures surface via onNotice and fall back to
 *    the existing binary (mirroring the local CLI's fallback semantics).
 * 2. After a successful upgrade, the still-running old daemon executes
 *    pre-upgrade code — it MUST be restarted or the upgrade never takes effect.
 *    Kill it and wait for its socket to release before relaunching.
 * 3. Reuse a live daemon; otherwise launch one detached and wait for its
 *    socket. Returns the remote daemon socket path to forward.
 */
export async function ensureRemoteDaemon(
  host: string,
  targetVersion: string,
  onNotice?: (message: string) => void,
): Promise<string> {
  const homeDir = await getRemoteHomeDir(host);
  const socketPath = remoteDaemonSocketPath(homeDir);

  let binaryPath: string | undefined;
  let upgraded = false;
  try {
    ({ binaryPath, upgraded } = await ensureRemoteCliUpToDate(
      host,
      targetVersion,
    ));
  } catch (error) {
    console.warn(
      `[remoteCli] ${host} wave CLI 升级失败，继续使用现有版本:`,
      error,
    );
    onNotice?.(
      `远程 wave-code CLI 升级失败：${error instanceof Error ? error.message : String(error)}。` +
        `可通过 ssh ${host} "npm install -g wave-code@${targetVersion}" 手动升级`,
    );
  }

  if (upgraded) {
    await killRemoteDaemon(host, socketPath);
    await waitForRemoteDaemonExit(host, socketPath);
  }

  if (await remoteDaemonAlive(host, socketPath)) return socketPath;
  binaryPath ??= (await resolveRemoteWaveBinary(host, true, targetVersion))
    .binaryPath;
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
