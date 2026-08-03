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

import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildSshSpawnArgs, shellQuote, withRemoteLoginShell } from './sshHosts';

const execFileAsync = promisify(execFile);

export const REMOTE_NODE_MIN_MAJOR = 20;
export const REMOTE_INSTALL_REGISTRY = 'https://registry.npmmirror.com';
const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 5 * 60_000;

export interface RemoteCliInfo {
  /** Absolute path to the `wave` binary on the remote host. */
  binaryPath: string;
  nodeVersion: string;
}

/** stderr noise emitted by `bash/zsh -i` without a TTY — skip, not an error. */
const JOB_CONTROL_NOISE = /^(bash|zsh): (cannot set terminal process group|no job control in this shell)$/;

function describeError(error: unknown): string {
  const e = error as { stderr?: string; message?: string };
  const lines = (e.stderr ?? e.message ?? String(error)).trim().split('\n');
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
 * 3. (installIfMissing) `npm install -g wave-code --registry=…`, then re-probe.
 * Throws with an actionable, user-facing error on any failure.
 */
export async function resolveRemoteWaveBinary(host: string, installIfMissing = true): Promise<RemoteCliInfo> {
  let nodeVersion = '';
  try {
    const { stdout } = await execFileAsync('ssh', await remoteCommand(host, 'node -v'), {
      timeout: PROBE_TIMEOUT_MS,
    });
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
      const { stdout } = await execFileAsync('ssh', await remoteCommand(host, 'command -v wave'), {
        timeout: PROBE_TIMEOUT_MS,
      });
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const found = await probeWave();
  if (found) return { binaryPath: found, nodeVersion };

  const installCommand = `npm install -g wave-code --registry=${REMOTE_INSTALL_REGISTRY}`;
  if (installIfMissing) {
    try {
      await execFileAsync('ssh', await remoteCommand(host, installCommand), {
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
 * Check a directory exists on a remote host via `test -d`. Used to validate
 * user-typed remote workdir paths (spec scenario 3) — the Electron dialog
 * cannot pick remote directories, so the path is a text input.
 */
export async function remotePathExists(host: string, remotePath: string): Promise<boolean> {
  try {
    await execFileAsync(
      'ssh',
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
export async function listRemoteDirs(host: string, dir: string): Promise<RemoteDirListResult> {
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
    const { stdout } = await execFileAsync('ssh', await remoteCommand(host, command), {
      timeout: PROBE_TIMEOUT_MS,
    });
    const lines = stdout.split('\n').filter((line) => line.length > 0);
    const resolvedPath = lines[0] ?? dir;
    const dirs = lines
      .slice(1)
      .filter((name) => name !== '.' && name !== '..')
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
  type: 'text' | 'image' | 'binary';
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
 * 件面板」 scenarios 1-3/14/15). A single ssh invocation reports the mime via
 * `file -b -I`, inlines images as base64, NUL-detects binaries on the first
 * 8KB, and truncates text to REMOTE_FILE_MAX_BYTES/REMOTE_FILE_MAX_LINES.
 * Output is a fixed-position header (V1 line, type=, mime=, total=,
 * truncated=) followed by one base64 payload line — parsed by position, not by
 * key=value heuristics, because base64 payloads can start with letters.
 * Exit codes: 3 = missing, 4 = unreadable (messages go to stderr).
 */
export async function readRemoteFile(host: string, remotePath: string): Promise<RemoteFileReadResult> {
  const command =
    `p=${shellQuote(remotePath)}; ` +
    `case "$p" in '~') p="$HOME";; '~/'*) p="$HOME` +
    "${p#'~'}" +
    `";; esac; ` +
    `test -f "$p" || { echo '文件不存在' >&2; exit 3; }; ` +
    `test -r "$p" || { echo '文件不可读' >&2; exit 4; }; ` +
    `mime=$(file -b -I "$p" 2>/dev/null | head -1 | tr -d ' \\r\\n'); mime=\${mime%%;*}; mime=$(printf '%s' "$mime" | tr 'A-Z' 'a-z'); ` +
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
    const { stdout } = await execFileAsync('ssh', await remoteCommand(host, command), {
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    const lines = stdout.split('\n');
    if (lines[0] !== 'WAVE_REMOTE_FILE_V1') {
      throw new Error('远端返回了无法识别的响应');
    }
    const type = lines[1].replace(/^type=/, '') as RemoteFileReadResult['type'];
    const mime = lines[2].replace(/^mime=/, '');
    const totalLines = Number(lines[3].replace(/^total=/, ''));
    const truncated = lines[4] === 'truncated=1';
    const payload = lines.slice(5).join('\n').replace(/\s+$/, '');
    if (type === 'image') return { type, mime, imageBase64: `data:${mime};base64,${payload}` };
    if (type === 'binary') return { type, mime };
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
