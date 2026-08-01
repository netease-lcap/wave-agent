/**
 * Remote wave CLI resolution (spec: docs/specs/ui/desktop-app.md 「SSH 远程主
 * 机」 scenarios 7/8). One-shot ssh probes run node presence/version and
 * `command -v wave`; a missing CLI triggers a best-effort auto-install via the
 * npmmirror registry, then the flow continues. Every failure surfaces an
 * actionable message — nothing retries indefinitely.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { buildSshSpawnArgs } from './sshHosts';

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

function describeError(error: unknown): string {
  const e = error as { stderr?: string; message?: string };
  return (e.stderr ?? e.message ?? String(error)).trim().split('\n')[0];
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
    const { stdout } = await execFileAsync(
      'ssh',
      buildSshSpawnArgs(host, 'node -v'),
      { timeout: PROBE_TIMEOUT_MS },
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
        'ssh',
        buildSshSpawnArgs(host, 'command -v wave'),
        { timeout: PROBE_TIMEOUT_MS },
      );
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
      await execFileAsync('ssh', buildSshSpawnArgs(host, installCommand), {
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

/** Single-quote a string for the remote shell (ssh joins argv into one command). */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Check a directory exists on a remote host via `test -d`. Used to validate
 * user-typed remote workdir paths (spec scenario 3) — the Electron dialog
 * cannot pick remote directories, so the path is a text input.
 */
export async function remotePathExists(host: string, remotePath: string): Promise<boolean> {
  try {
    await execFileAsync('ssh', buildSshSpawnArgs(host, `test -d ${shellQuote(remotePath)}`), {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}
