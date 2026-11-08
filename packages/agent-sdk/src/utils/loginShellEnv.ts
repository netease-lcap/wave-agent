/**
 * Login-shell environment probing — the one-time "what does the user's shell
 * export?" step every host (desktop main process, VS Code extension host,
 * JetBrains plugin) performs at startup.
 *
 * Why it exists: GUI-launched hosts inherit a bare environment (Finder/Dock,
 * the extension host). PATH misses nvm/Homebrew, and every non-PATH export in
 * the user's shell config (API keys, corporate proxy, self-signed CA hints,
 * `SSH_AUTH_SOCK`) is gone — MCP servers cannot find `npx`, `git push` cannot
 * reach the agent, proxies and custom CAs are ignored.
 *
 * The fix is deliberately **not** per-command: loading the profile for every
 * command (`-c -l`) pays a shell startup per command and mixes rc output into
 * the command result. Instead the host probes **once** at startup, adopts the
 * whitelisted subset into its own process environment, and every child
 * (Bash tool, background tasks, `!` commands, MCP servers, hooks, LSP servers,
 * git) inherits it. Every command still runs as a plain `-c`; this module only
 * solves process-environment injection and never sources a profile for a
 * command.
 *
 * Constraint: this module is reachable from the `/host` entry, whose closure
 * must stay free of third-party dependencies and free of import-time side
 * effects — hence `node:` builtins only and nothing executed at module scope.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveShellPath } from "./shellResolver.js";

/** Result of one successful probe. */
export type LoginShellEnvProbe = {
  /** Parsed environment (PWD/OLDPWD/SHLVL/_ and the probe's own noise markers removed; Windows keeps PATH only). */
  env: Record<string, string>;
  /** true when `env -0` was unavailable and the output was parsed line by line. */
  parsedByLines: boolean;
  /** Shell the probe actually ran. */
  shell: string;
};

export type LoginShellEnvOptions = {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
  /** Test seam: run a command and resolve its stdout. */
  execFile?: (
    file: string,
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeout: number },
  ) => Promise<string>;
  /** Test seam, defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam, defaults to `os.homedir()`. */
  homedir?: string;
  /**
   * Test seam, defaults to an fs check (executable bit for shell binaries,
   * existence for `~/.zshrc` / `~/.bashrc`). Providing it replaces both checks.
   */
  fileExists?: (p: string) => boolean;
};

/**
 * Variables a host is willing to take from the login shell. Everything else in
 * the user's profile is dropped on purpose: dumping the whole environment into
 * the host process would let `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `GIT_*`
 * change the behaviour of Electron / the extension host itself.
 */
export const LOGIN_SHELL_ENV_KEYS: readonly string[] = [
  "PATH",
  "SSH_AUTH_SOCK",
  "WAVE_SHELL",
  "WAVE_GIT_BASH_PATH",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "LANG",
  "DISPLAY",
  "WAYLAND_DISPLAY",
];

/** Prefixes (locale / XDG session) adopted together with the explicit keys. */
export const LOGIN_SHELL_ENV_PREFIXES: readonly string[] = ["LC_", "XDG_"];

/**
 * Probe budget, shared by all three hosts (the JetBrains plugin hard-codes the
 * same numbers — keep them in step): one attempt gets 4s, and the worst case
 * (2 attempts + backoff) is ~8.4s, which is also how long the first CLI spawn
 * may wait. Any tighter and a slow profile (nvm on a cold network mount) gets
 * cut off; any looser and a hung profile delays the first session noticeably.
 */
const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_PRIME_ATTEMPTS = 2;
const DEFAULT_PRIME_BACKOFF_BASE_MS = 200;

/** Probing order for POSIX hosts; `/bin/sh` is the last resort. */
const SHELL_BINARIES = ["/bin/zsh", "/bin/bash"] as const;
const FALLBACK_SHELL = "/bin/sh";
const ZSHRC = ".zshrc";
const BASHRC = ".bashrc";

/**
 * Markers injected into the probe child and removed from the result — but only
 * while the value still equals ours, so a user who deliberately exports one of
 * these keeps their own value.
 */
const PROBE_NOISE_ENV: Readonly<Record<string, string>> = {
  DISABLE_AUTO_UPDATE: "true",
  ZSH_DISABLE_COMPFIX: "true",
  SSH_ASKPASS_REQUIRE: "never",
  DBUS_SESSION_BUS_ADDRESS: "disabled:",
  WAVE_LOGIN_SHELL_PROBE: "1",
};

/** Base of the minimal probe environment (everything else is locale/display). */
const MINIMAL_ENV_KEYS = ["HOME", "PATH", "SHELL", "USER", "SSH_AUTH_SOCK"];

/** Locale / display / XDG session variables the shell itself may need. */
const MINIMAL_ENV_PASSTHROUGH_RE =
  /^(XDG_(CURRENT_DESKTOP|SESSION_TYPE|SESSION_DESKTOP|DATA_DIRS|CONFIG_DIRS|CONFIG_HOME|DATA_HOME|STATE_HOME|CACHE_HOME|MENU_PREFIX)|LC_\w+|LANG|DISPLAY|WAYLAND_DISPLAY)$/;

/** Keys the shell rewrites for itself and that must never leak into the host. */
const DROPPED_ENV_KEYS = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

/** `KEY=value` — a line starting like this begins a new entry in line mode. */
const ENV_LINE_RE = /^([^\s=]+)=([\s\S]*)$/;

/**
 * Cached probe promise. Successful probes are process-wide (one probe per host
 * process, never per session nor per command); failures are evicted so the
 * caller's retry budget actually retries.
 */
let cachedProbe: Promise<LoginShellEnvProbe> | undefined;

function isExecutableFile(candidate: string): boolean {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isFileOnDisk(candidate: string): boolean {
  try {
    fs.accessSync(candidate);
    return true;
  } catch {
    return false;
  }
}

function lastNonEmptyLine(output: string): string | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[lines.length - 1];
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Run the probe shell and resolve its stdout. A shell whose rc file makes it
 * exit non-zero still produced usable output, so non-empty stdout wins over the
 * exit code; a killed child (timeout) is always a failure, because its output
 * is a truncated environment.
 */
function defaultExecFile(
  file: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        timeout: options.timeout,
        env: options.env,
        windowsHide: true,
      },
      (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        const killed = (error as NodeJS.ErrnoException & { killed?: boolean })
          .killed;
        if (!killed && typeof stdout === "string" && stdout.trim()) {
          resolve(stdout);
          return;
        }
        reject(error);
      },
    );
  });
}

/**
 * Pick the shell used for probing.
 *
 * POSIX order (never hard-code one shell — a Linux box with only bash would
 * otherwise fail the probe):
 *   1. `$SHELL` when it is an absolute path to an executable file
 *   2. `/bin/zsh` when it exists and `~/.zshrc` does
 *   3. `/bin/bash` when it exists and `~/.bashrc` does
 *   4. the first existing `/bin/zsh`, `/bin/bash`
 *   5. `/bin/sh`
 *
 * Windows delegates to the package-wide Git Bash resolver
 * (`resolveShellPath()`), so there is a single Git Bash discovery path.
 * Returns undefined when nothing is usable.
 */
export function resolveProbeShell(
  options: LoginShellEnvOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return resolveShellPath();
  }

  const env = options.env ?? process.env;
  const homedir = options.homedir ?? os.homedir();
  const isExecutable = options.fileExists ?? isExecutableFile;
  const exists = options.fileExists ?? isFileOnDisk;

  const envShell = env.SHELL;
  if (envShell && envShell.startsWith("/") && isExecutable(envShell)) {
    return envShell;
  }

  const [zsh, bash] = SHELL_BINARIES;
  // posix join: these are POSIX shell paths, whatever host runs the check.
  if (isExecutable(zsh) && exists(path.posix.join(homedir, ZSHRC))) {
    return zsh;
  }
  if (isExecutable(bash) && exists(path.posix.join(homedir, BASHRC))) {
    return bash;
  }

  for (const candidate of SHELL_BINARIES) {
    if (isExecutable(candidate)) return candidate;
  }

  return isExecutable(FALLBACK_SHELL) ? FALLBACK_SHELL : undefined;
}

/**
 * Keep only the whitelisted keys/prefixes of a probed environment.
 *
 * Matching is case-insensitive on Windows (`Path` vs `PATH`), but the emitted
 * record keeps the original key names from `probed` — hosts write into
 * `process.env` as-is.
 */
export function selectWhitelistedEnv(
  probed: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const fold = (value: string) =>
    platform === "win32" ? value.toUpperCase() : value;
  const keys = new Set(LOGIN_SHELL_ENV_KEYS.map(fold));
  const prefixes = LOGIN_SHELL_ENV_PREFIXES.map(fold);

  const selected: Record<string, string> = {};
  for (const [key, value] of Object.entries(probed)) {
    const folded = fold(key);
    const matched =
      keys.has(folded) || prefixes.some((prefix) => folded.startsWith(prefix));
    if (matched) selected[key] = value;
  }
  return selected;
}

/**
 * Whitelist + no-override adoption: writes the whitelisted probe values into
 * `target` **only** for keys that are not set yet (an explicit host or user
 * configuration always wins), and returns the keys it actually wrote.
 *
 * `PATH` is the one exception, and it has to be: a host process practically
 * always inherits *some* `PATH`, so a strict "already set → skip" would throw
 * the probed `PATH` away every time — and those nvm/Homebrew/pnpm entries are
 * the main reason the probe exists. Probed segments go first, inherited ones
 * after, duplicates dropped.
 *
 * Windows compares existing keys case-insensitively (`Path` already set means a
 * probed `PATH` updates that key instead of adding a second one).
 */
export function adoptLoginShellEnv(
  target: NodeJS.ProcessEnv,
  probed: Record<string, string>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const fold = (value: string) =>
    platform === "win32" ? value.toUpperCase() : value;
  const existingKey = (name: string) =>
    Object.keys(target).find(
      (key) => target[key] !== undefined && fold(key) === fold(name),
    );

  const adopted: string[] = [];

  const probedPathKey = Object.keys(probed).find((key) => fold(key) === "PATH");
  const probedPath =
    probedPathKey === undefined ? undefined : probed[probedPathKey];
  if (probedPath !== undefined) {
    const targetPathKey = existingKey("PATH");
    const inheritedPath =
      targetPathKey === undefined ? undefined : target[targetPathKey];
    const merged = mergePathSegments(
      probedPath,
      inheritedPath ?? undefined,
      platform === "win32" ? ";" : ":",
    );
    if (merged !== undefined) {
      target[targetPathKey ?? "PATH"] = merged;
      adopted.push("PATH");
    }
  }

  for (const [key, value] of Object.entries(
    selectWhitelistedEnv(probed, platform),
  )) {
    if (fold(key) === "PATH") continue; // handled above
    if (existingKey(key) !== undefined) continue;
    target[key] = value;
    adopted.push(key);
  }
  return adopted;
}

/**
 * Probed segments first, inherited segments after, deduped and in order.
 * Returns undefined when both sides are empty.
 */
function mergePathSegments(
  probedPath: string | undefined,
  inheritedPath: string | undefined,
  separator: string,
): string | undefined {
  const segments: string[] = [];
  for (const side of [probedPath, inheritedPath]) {
    if (!side) continue;
    for (const segment of side.split(separator)) {
      if (segment.length > 0 && !segments.includes(segment)) {
        segments.push(segment);
      }
    }
  }
  return segments.length > 0 ? segments.join(separator) : undefined;
}

/** The minimal, noise-suppressed environment the probe child runs with. */
function buildProbeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const probeEnv: NodeJS.ProcessEnv = {};
  for (const key of MINIMAL_ENV_KEYS) {
    const value = env[key];
    if (value !== undefined) probeEnv[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (MINIMAL_ENV_PASSTHROUGH_RE.test(key)) probeEnv[key] = value;
  }
  for (const [key, value] of Object.entries(PROBE_NOISE_ENV)) {
    probeEnv[key] = value;
  }
  return probeEnv;
}

function parseNulSeparated(region: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of region.split("\0")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    env[entry.slice(0, separator)] = entry.slice(separator + 1);
  }
  return env;
}

/**
 * Line-mode parser for shells without `env -0`.
 *
 * A value containing a newline is printed as several lines, so a line that does
 * not start with `KEY=` is a continuation and is glued back onto the previous
 * value with its `\n`. Those values are dropped afterwards — a line-mode result
 * cannot tell a real embedded newline from a wrapped one.
 */
function parseLineSeparated(region: string): Record<string, string> {
  const env: Record<string, string> = {};
  let pendingKey: string | undefined;
  let pendingValue = "";

  const flush = () => {
    if (pendingKey !== undefined) {
      env[pendingKey] = pendingValue;
      pendingKey = undefined;
      pendingValue = "";
    }
  };

  for (const line of region.split(/\r?\n/)) {
    if (!line) continue;
    const match = ENV_LINE_RE.exec(line);
    if (match) {
      flush();
      pendingKey = match[1];
      pendingValue = match[2];
      continue;
    }
    if (pendingKey !== undefined) {
      pendingValue += `\n${line}`;
    }
  }
  flush();
  return env;
}

function parseProbeOutput(
  output: string,
  startNonce: string,
  endNonce: string,
): { env: Record<string, string>; parsedByLines: boolean } {
  const startIndex = output.indexOf(startNonce);
  if (startIndex < 0) {
    throw new Error("Login shell probe output has no start marker");
  }

  const rest = output.slice(startIndex + startNonce.length);
  const endIndex = rest.indexOf(endNonce);
  // Only the region between the two markers counts: rc files are free to print
  // their own nonsense before and after it.
  const region = (endIndex >= 0 ? rest.slice(0, endIndex) : rest).replace(
    /^[\r\n]+/,
    "",
  );

  if (endIndex >= 0 && region.includes("\0")) {
    return { env: parseNulSeparated(region), parsedByLines: false };
  }
  return { env: parseLineSeparated(region), parsedByLines: true };
}

function sanitizeProbedEnv(
  parsed: Record<string, string>,
  parsedByLines: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (DROPPED_ENV_KEYS.has(key)) continue;
    const injected = PROBE_NOISE_ENV[key];
    if (injected !== undefined && value === injected) continue;
    if (parsedByLines && value.includes("\n")) continue;
    env[key] = value;
  }
  return env;
}

function randomNonce(): string {
  return randomUUID().replace(/-/g, "");
}

async function runProbe(
  options: LoginShellEnvOptions,
): Promise<LoginShellEnvProbe> {
  const platform = options.platform ?? process.platform;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const execFileImpl = options.execFile ?? defaultExecFile;
  const shell = resolveProbeShell(options);
  if (!shell) {
    throw new Error(
      platform === "win32"
        ? "Git Bash not found; cannot probe the login shell environment"
        : "No usable login shell found",
    );
  }

  const probeEnv = buildProbeEnv(options.env ?? process.env);

  if (platform === "win32") {
    // Git Bash only: Windows native variable semantics do not match Git Bash's,
    // and this round adopts PATH only (converted back to native form).
    const stdout = await execFileImpl(shell, ["-lic", 'cygpath -pw "$PATH"'], {
      env: probeEnv,
      timeout,
    });
    const probedPath = lastNonEmptyLine(stdout);
    if (!probedPath) {
      throw new Error("Git Bash probe produced no PATH");
    }
    return { env: { PATH: probedPath }, parsedByLines: true, shell };
  }

  const startNonce = randomNonce();
  const endNonce = randomNonce();
  // `env -0` keeps values with newlines intact; `|| env` is the line-mode
  // fallback for shells where the flag is unsupported.
  const command = `echo "${startNonce}"; env -0 && echo "${endNonce}" || env`;
  const stdout = await execFileImpl(shell, ["-l", "-i", "-c", command], {
    env: probeEnv,
    timeout,
  });
  const parsed = parseProbeOutput(stdout, startNonce, endNonce);
  return {
    env: sanitizeProbedEnv(parsed.env, parsed.parsedByLines),
    parsedByLines: parsed.parsedByLines,
    shell,
  };
}

/**
 * Probe the login shell environment once and cache the result for the process.
 *
 * Failures are not cached. Callers must not block startup on this — the host
 * awaits it off the critical path (see `primeProcessEnvFromLoginShell`).
 */
export async function probeLoginShellEnv(
  options: LoginShellEnvOptions = {},
): Promise<LoginShellEnvProbe> {
  if (!cachedProbe) {
    const pending = runProbe(options);
    cachedProbe = pending;
    pending.catch(() => {
      if (cachedProbe === pending) cachedProbe = undefined;
    });
  }
  const probe = await cachedProbe;
  // Hand out a copy: hosts may keep or mutate what they get.
  return { ...probe, env: { ...probe.env } };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe and adopt in one step — what the hosts actually call at startup.
 *
 * Never throws and never blocks a host's startup path for longer than its retry
 * budget: the probe is retried `attempts` times (default 2) with exponential
 * backoff (`backoffBaseMs * 2^n`, default 200ms) and a final failure degrades to
 * "keep the inherited environment" (`{ adopted: [], error }`) so the caller can
 * log one diagnostic line.
 */
export async function primeProcessEnvFromLoginShell(
  options: LoginShellEnvOptions & {
    target?: NodeJS.ProcessEnv;
    attempts?: number;
    backoffBaseMs?: number;
  } = {},
): Promise<{ adopted: string[]; error?: string }> {
  const attempts = Math.max(
    1,
    Math.floor(options.attempts ?? DEFAULT_PRIME_ATTEMPTS),
  );
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_PRIME_BACKOFF_BASE_MS;
  const target = options.target ?? process.env;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const probe = await probeLoginShellEnv(options);
      return {
        adopted: adoptLoginShellEnv(
          target,
          probe.env,
          options.platform ?? process.platform,
        ),
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1 && backoffBaseMs > 0) {
        await sleep(backoffBaseMs * 2 ** attempt);
      }
    }
  }

  return { adopted: [], error: toMessage(lastError) };
}

/** Drop the process-wide probe cache (tests only). */
export function _resetLoginShellEnvCacheForTesting(): void {
  cachedProbe = undefined;
}
