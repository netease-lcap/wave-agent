/**
 * SSH host support for remote development (spec: docs/specs/ui/desktop-app.md
 * 「SSH 远程主机」). Host discovery mirrors VS Code Remote-SSH: hosts are the
 * top-level `Host` block names in ~/.ssh/config (wildcard patterns skipped);
 * connection parameters are resolved by ssh itself at spawn time. 「添加主机…」
 * writes a new Host block into ~/.ssh/config.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const SHELL_PROBE_TIMEOUT_MS = 15_000;

/** Sentinel host name for local (non-remote) sessions. */
export const LOCAL_HOST = 'local';

/**
 * Options applied to every remote ssh invocation. BatchMode forbids password /
 * keyboard-interactive prompts — auth is key/ssh-agent only and fails fast
 * with a usable error (spec scenario 6). accept-new auto-accepts a host key
 * on first connection. ConnectTimeout bounds an unreachable host.
 */
export const SSH_BASE_OPTIONS = [
  '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=accept-new',
  '-o', 'ConnectTimeout=15',
];

export function getSshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config');
}

/**
 * Parse the top-level `Host` block names from an ssh config. Wildcard entries
 * (`Host *`, `Host *.example.com`) are patterns, not concrete hosts, so they
 * are skipped. Returns [] when the file is missing or unreadable (spec
 * scenario 12 — the picker then shows only 本地 + 添加主机…).
 */
export function parseSshConfigHosts(configPath: string = getSshConfigPath()): string[] {
  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return [];
  }
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#') || /^Include\s+/i.test(trimmed)) continue;
    const m = /^Host\s+(.+)$/i.exec(trimmed);
    if (!m) continue;
    for (const name of m[1].split(/\s+/)) {
      if (!name || /[*?]/.test(name)) continue;
      if (!seen.has(name)) {
        seen.add(name);
        hosts.push(name);
      }
    }
  }
  return hosts;
}

export interface ParsedConnection {
  /** Host block name and ssh target (brackets stripped from IPv6 literals). */
  host: string;
  /** Hostname as typed (IPv6 keeps its brackets for the HostName option). */
  hostName?: string;
  user?: string;
  port?: number;
}

/**
 * Parse a VS Code Remote-SSH style connection string: `ssh user@hostname -p
 * port`. The leading `ssh ` is optional. Returns null for anything else —
 * unsupported options, multiple targets, or a missing target.
 */
export function parseConnectionString(input: string): ParsedConnection | null {
  const s = input.trim();
  if (!s) return null;
  let rest = s;
  const sshPrefix = /^ssh\s+/i.exec(s);
  if (sshPrefix) rest = s.slice(sshPrefix[0].length);
  const tokens = rest.split(/\s+/);
  let target: string | undefined;
  let port: number | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t === '-p') {
      const v = tokens[i + 1];
      if (v && /^\d+$/.test(v)) {
        port = Number(v);
        i++;
        continue;
      }
      return null;
    }
    if (t.startsWith('-')) return null; // unsupported option
    if (target === undefined) {
      target = t;
    } else {
      return null; // multiple targets
    }
  }
  if (!target) return null;
  const at = target.lastIndexOf('@');
  const user = at >= 0 ? target.slice(0, at) : undefined;
  const hostPart = at >= 0 ? target.slice(at + 1) : target;
  const host = hostPart.replace(/^\[|\]$/g, '');
  if (!host) return null;
  return { host, hostName: hostPart, user, port };
}

/**
 * Append a new Host block to ~/.ssh/config (creating the file on demand, spec
 * scenario 12). Refuses when a top-level Host block with the same name already
 * exists — never overwrite or duplicate (spec scenario 5). Returns the host
 * name written.
 */
export function addSshHost(connectionString: string, configPath: string = getSshConfigPath()): string {
  const parsed = parseConnectionString(connectionString);
  if (!parsed) {
    throw new Error('无法解析连接串，请使用 ssh user@hostname -p port 格式');
  }
  const name = parsed.host;
  if (parseSshConfigHosts(configPath).includes(name)) {
    throw new Error(`主机 ${name} 已存在于 ~/.ssh/config，未做修改`);
  }
  const optionLines: string[] = [];
  if (parsed.hostName !== name) optionLines.push(`    HostName ${parsed.hostName}`);
  if (parsed.user) optionLines.push(`    User ${parsed.user}`);
  if (parsed.port) optionLines.push(`    Port ${parsed.port}`);
  const block = `\nHost ${name}\n${optionLines.join('\n')}\n`;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  let existing = '';
  try {
    existing = fs.readFileSync(configPath, 'utf-8');
  } catch {
    // new file — the block itself starts with a leading newline, so it reads
    // cleanly when appended to the empty file.
  }
  if (existing && !existing.endsWith('\n')) existing += '\n';
  fs.writeFileSync(configPath, existing + block, 'utf-8');
  return name;
}

/**
 * Spawn args for the `ssh` executable targeting `host`, running
 * `remoteCommand` on the remote shell. The remote command is passed as ONE
 * argv entry: ssh joins everything after the hostname into a single command
 * string. No `--` separator is used — OpenSSH only supports `--` since 9.3,
 * and older versions would execute it as the first remote token; the wave
 * binary path can never start with `-`, so none is needed.
 */
export function buildSshSpawnArgs(host: string, remoteCommand: string): string[] {
  return [...SSH_BASE_OPTIONS, host, remoteCommand];
}

/**
 * Spawn args for an `ssh -N` unix-socket forward: `localSocket:remoteSocket`.
 * `-N` means no remote command — the tunnel just forwards. ExitOnForwardFailure
 * makes ssh exit (instead of idling) when the remote end refuses the forward,
 * so a missing daemon socket surfaces as a tunnel exit rather than a silent
 * half-open connection. No login shell is needed: `-N` tunnels never run a
 * remote command.
 */
export function buildSshTunnelArgs(
  host: string,
  localSocketPath: string,
  remoteSocketPath: string,
): string[] {
  return [
    ...SSH_BASE_OPTIONS,
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-L', `${localSocketPath}:${remoteSocketPath}`,
    host,
  ];
}

/**
 * Single-quote a string for a remote shell command. ssh joins every argv
 * after the hostname into one remote command line, so any user-supplied path
 * (remote cwd, git pathspecs, untracked file paths) must be shell-escaped.
 */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Per-host login shell, probed once per session and reused for every command. */
const loginShellCache = new Map<string, Promise<string>>();

/** Test-only: drop the per-host login shell cache. */
export function resetRemoteShellCache(): void {
  loginShellCache.clear();
}

/**
 * Resolve the remote user's login shell from passwd (`echo $SHELL` is set even
 * in a non-interactive session). nvm-style version managers put node/npm on
 * PATH only in interactive rc files (.bashrc/.zshrc), which a plain
 * `ssh host 'cmd'` never loads — so the shell is needed to run every remote
 * command with its full user environment.
 */
export function getRemoteLoginShell(host: string): Promise<string> {
  let cached = loginShellCache.get(host);
  if (!cached) {
    cached = execFileAsync('ssh', buildSshSpawnArgs(host, 'echo $SHELL'), {
      timeout: SHELL_PROBE_TIMEOUT_MS,
    })
      .then(({ stdout }) => stdout.trim() || '/bin/sh')
      .catch(() => '/bin/sh');
    loginShellCache.set(host, cached);
  }
  return cached;
}

/**
 * Wrap a remote command so it runs in the user's login shell:
 * `<shell> -lic '<command>'`. `-l` loads .profile/.zprofile, `-i` loads
 * .bashrc/.zshrc — the combination covers where nvm init lives. Without a TTY
 * the shell prints a job-control warning on stderr (harmless, stdout stays
 * clean); a genuinely failing command still surfaces its own stderr.
 */
export async function withRemoteLoginShell(host: string, command: string): Promise<string> {
  const shell = await getRemoteLoginShell(host);
  return `${shell} -lic ${shellQuote(command)}`;
}
