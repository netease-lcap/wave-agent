/**
 * SSH support for remote development (spec: docs/specs/desktop/desktop-remote.md
 * 「SSH 远程主机」). Hosts are the desktop app's own **connection entries**
 * (`SshConnection`, stored in wave-desktop.json) — mirrors Claude Code desktop:
 * the picker lists those entries, 「添加主机…」 fills them in through a form, and
 * `~/.ssh/config` is never written. An entry's `host` field may be a
 * `user@hostname` target or a plain alias from `~/.ssh/config`, in which case
 * ssh itself resolves the rest of the connection parameters at spawn time
 * (spec scenario 33). `parseSshConfigHosts` survives only for the one-time
 * upgrade import of the pre-existing hosts (spec scenario 32).
 */

import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const execFileAsync = promisify(execFile);
const SHELL_PROBE_TIMEOUT_MS = 15_000;

/** Sentinel host name for local (non-remote) sessions. */
export const LOCAL_HOST = "local";

/**
 * Options applied to every remote ssh invocation. BatchMode forbids password /
 * keyboard-interactive prompts — auth is key/ssh-agent only and fails fast
 * with a usable error (spec scenario 6). accept-new auto-accepts a host key
 * on first connection. ConnectTimeout bounds an unreachable host.
 */
export const SSH_BASE_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "StrictHostKeyChecking=accept-new",
  "-o",
  "ConnectTimeout=15",
];

export function getSshConfigPath(): string {
  return path.join(os.homedir(), ".ssh", "config");
}

/**
 * Parse the top-level `Host` block names from an ssh config. Wildcard entries
 * (`Host *`, `Host *.example.com`) are patterns, not concrete hosts, so they
 * are skipped. Returns [] when the file is missing or unreadable.
 *
 * Only used by the one-time upgrade import (spec scenario 32) — the picker's
 * host list is the saved connection entries, not this file.
 */
export function parseSshConfigHosts(
  configPath: string = getSshConfigPath(),
): string[] {
  let content: string;
  try {
    content = fs.readFileSync(configPath, "utf-8");
  } catch {
    return [];
  }
  const hosts: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#") || /^Include\s+/i.test(trimmed))
      continue;
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

/**
 * One saved SSH connection — the picker's unit of remote host management
 * (spec 「SSH 远程主机」场景 5). `id` is the host identity used everywhere else
 * in the app (pane host, session index, recent workdirs), so renaming or
 * re-pointing an entry never orphans the sessions bound to it; `host` is what
 * gets handed to ssh.
 */
export interface SshConnection {
  id: string;
  /** Display name (falls back to `host` when the user leaves it empty). */
  name: string;
  /** `user@hostname`, a bare hostname, or a `~/.ssh/config` alias. */
  host: string;
  /** Explicit port; unset = ssh decides (22 or the config file). */
  port?: number;
  /** Private key path; unset = ssh config / ssh-agent decides. */
  identityFile?: string;
}

/** Fields the connection form submits (id absent = create). */
export interface SshConnectionInput {
  id?: string;
  name?: string;
  host?: string;
  port?: number | string;
  identityFile?: string;
}

/** Normalized form values, ready to be stored under `id`. */
export interface SshConnectionDraft {
  id?: string;
  name: string;
  host: string;
  port?: number;
  identityFile?: string;
}

/**
 * The installed entry list. `desktopHost` installs it on boot and after every
 * create/update/delete, so the ssh argv builders below can resolve an entry's
 * port/key without threading the store through every call site (terminal,
 * port forwarding, remote CLI, login-shell probe).
 */
let installedConnections: SshConnection[] = [];

export function setSshConnections(connections: SshConnection[]): void {
  installedConnections = connections.map((connection) => ({ ...connection }));
}

export function getSshConnections(): SshConnection[] {
  return installedConnections.map((connection) => ({ ...connection }));
}

export function findSshConnection(id: string): SshConnection | undefined {
  return installedConnections.find((connection) => connection.id === id);
}

/** Is `id` one of the saved SSH connection entries (vs local / WSL)? */
export function isSshConnectionId(id: string): boolean {
  return installedConnections.some((connection) => connection.id === id);
}

/** Stable, collision-free id for a newly created entry. */
export function newSshConnectionId(): string {
  return `ssh-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

const HOST_CHARS = /^[A-Za-z0-9._:@[\]%~-]+$/;

/**
 * Validate the connection form (spec scenario 29). The renderer runs the same
 * rules for its inline hints; this one is authoritative — the host never stores
 * an entry the form could not have produced.
 */
export function validateSshConnectionInput(
  input: SshConnectionInput,
  existing: SshConnection[] = installedConnections,
): { ok: true; value: SshConnectionDraft } | { ok: false; error: string } {
  const host = (input.host ?? "").trim();
  if (!host) {
    return {
      ok: false,
      error: "请填写主机（user@hostname 或 ~/.ssh/config 里的别名）",
    };
  }
  if (/^ssh:\/\//i.test(host)) {
    return { ok: false, error: "去掉 ssh:// 前缀，只填 user@hostname" };
  }
  if (/\s/.test(host)) {
    return { ok: false, error: "主机栏不能包含空格" };
  }
  // `host:2222` 这种「端口写在主机栏」的写法要挡掉（端口有独立输入框）。别名
  // 自身含冒号、以及 IPv6（`fe80::1` / `[::1]`）都不是这个形状：单冒号后跟全
  // 数字才算。
  if (/^(?:[^:@\s]+@)?[^:\s]+:\d+$/.test(host)) {
    return { ok: false, error: "端口请填到端口栏，主机栏只填主机或别名" };
  }
  if (host.startsWith("-")) {
    return { ok: false, error: "主机栏不能以 - 开头" };
  }
  if (!HOST_CHARS.test(host)) {
    return {
      ok: false,
      error: "主机名只能包含字母、数字、. - _ : @ 等字符",
    };
  }
  const rawPort = input.port;
  let port: number | undefined;
  if (rawPort !== undefined && rawPort !== null && `${rawPort}`.trim() !== "") {
    const parsed = Number(`${rawPort}`.trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { ok: false, error: "端口必须是 1–65535 的数字" };
    }
    port = parsed;
  }
  const duplicate = existing.find(
    (connection) =>
      connection.id !== input.id && connection.host.trim() === host,
  );
  if (duplicate) {
    return {
      ok: false,
      error: `已有使用该主机的连接：${duplicate.name || duplicate.host}`,
    };
  }
  const identityFile = (input.identityFile ?? "").trim() || undefined;
  return {
    ok: true,
    value: {
      id: input.id,
      name: (input.name ?? "").trim() || host,
      host,
      ...(port === undefined ? {} : { port }),
      ...(identityFile === undefined ? {} : { identityFile }),
    },
  };
}

/**
 * ssh argv for a host id: the entry's port/key first, then the target. Ids
 * without an entry (WSL distros never come here; a legacy binding whose entry
 * was deleted may) degrade to the id itself, which is what ssh used to receive
 * before entries existed.
 */
function sshTargetArgs(hostId: string): string[] {
  const connection = findSshConnection(hostId);
  if (!connection) return [hostId];
  const args: string[] = [];
  if (connection.port !== undefined) args.push("-p", String(connection.port));
  if (connection.identityFile) args.push("-i", connection.identityFile);
  args.push(connection.host);
  return args;
}

/**
 * Spawn args for the `ssh` executable targeting `host`, running
 * `remoteCommand` on the remote shell. The remote command is passed as ONE
 * argv entry: ssh joins everything after the hostname into a single command
 * string. No `--` separator is used — OpenSSH only supports `--` since 9.3,
 * and older versions would execute it as the first remote token; the wave
 * binary path can never start with `-`, so none is needed.
 */
export function buildSshSpawnArgs(
  host: string,
  remoteCommand: string,
): string[] {
  return [...SSH_BASE_OPTIONS, ...sshTargetArgs(host), remoteCommand];
}

/**
 * Spawn args for an `ssh -N` forward to the remote daemon socket:
 * `localForward:remoteSocket`. `-N` means no remote command — the tunnel just
 * forwards. `localForward` is the tunnel's local end: a unix socket path on
 * POSIX, or `127.0.0.1:<port>` on Windows (Windows OpenSSH cannot bind a local
 * unix socket — its `-L` parser rejects drive-letter paths like `C:\...`, and
 * its AF_UNIX bind rejects drive-less paths — so the desktop forwards to a
 * loopback TCP port there; OpenSSH's `-L port:remote_socket` form works on
 * every platform). ExitOnForwardFailure makes ssh exit (instead of idling)
 * when a forward cannot be established, so a missing daemon socket surfaces as
 * a tunnel exit rather than a silent half-open connection.
 * ServerAliveInterval/CountMax send application-level keepalives through the
 * encrypted channel: after a machine sleep the TCP connection is often
 * half-open (no RST/FIN), and only these probes make ssh detect the dead
 * tunnel in bounded time instead of idling on SO_KEEPALIVE (macOS probes after
 * ~2h idle by default). No login shell is needed: `-N` tunnels never run a
 * remote command.
 */
export function buildSshTunnelArgs(
  host: string,
  localForward: string,
  remoteSocketPath: string,
): string[] {
  return [
    ...SSH_BASE_OPTIONS,
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=4",
    "-N",
    "-L",
    `${localForward}:${remoteSocketPath}`,
    ...sshTargetArgs(host),
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
    cached = execFileAsync("ssh", buildSshSpawnArgs(host, "echo $SHELL"), {
      timeout: SHELL_PROBE_TIMEOUT_MS,
    })
      .then(({ stdout }) => stdout.trim() || "/bin/sh")
      .catch(() => "/bin/sh");
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
export async function withRemoteLoginShell(
  host: string,
  command: string,
): Promise<string> {
  const shell = await getRemoteLoginShell(host);
  return `${shell} -lic ${shellQuote(command)}`;
}
