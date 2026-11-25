import { accessSync, constants, existsSync } from "fs";
import path from "path";
import { logger } from "./globalLogger.js";

export const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

// Common git.exe locations (checked before walking cwd and PATH).
const WINDOWS_GIT_EXE_PATHS = [
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
];

/**
 * Extensions that can name a `git` executable, in cmd.exe's default order. A
 * user-set `PATHEXT` supplies the order but is filtered to these four — the
 * same list Claude Code keeps (`S` in its `which`) — and the default order
 * applies when nothing survives, so a stray `.FOO` entry can never turn
 * `git.foo` into a Git install.
 */
const WINDOWS_GIT_EXTS = [".com", ".exe", ".bat", ".cmd"];

/** Lower-cased basenames `WAVE_GIT_BASH_PATH` may point at (Claude Code's list). */
const GIT_BASH_BASENAMES = ["bash.exe", "sh.exe", "bash", "sh"];

// Common directories where bash/zsh may live, used as fallback after PATH lookup.
const FIXED_SHELL_DIRS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
];

function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Resolve a command name (e.g. "bash") to an absolute path by searching $PATH. */
function which(command: string): string | undefined {
  const pathEnv = process.env.PATH;
  if (!pathEnv) return undefined;
  for (const dir of pathEnv.split(":")) {
    if (!dir) continue;
    const candidate = path.join(dir, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function isSupportedShell(shellPath: string): boolean {
  return shellPath.includes("bash") || shellPath.includes("zsh");
}

/**
 * Where Git for Windows keeps bash.exe relative to any of its `git`
 * executables: `<install>\cmd\git.exe` and `<install>\usr\bin\git.exe` (the
 * "Git + Unix tools" installer option) both land on `<install>\bin\bash.exe`.
 * join treats git.exe as a segment, so ".." cancels it (→ its directory),
 * the second ".." cancels that directory (→ <install>), then bin/bash.exe.
 */
function bashBesideGit(gitExe: string): string {
  return path.win32.join(gitExe, "..", "..", "bin", "bash.exe");
}

/**
 * Every `git` executable reachable from `cwd` and `PATH`, in lookup order.
 *
 * This replaces `where.exe git`, whose first output line was all the old code
 * read: a `git.cmd` shim ahead of the real Git hid every later hit, and the
 * Bash tool reported "Git Bash not found" on a machine that had Git. The walk
 * is what Claude Code's `which` does — cwd first, then each `PATH` directory,
 * the name tried with every `PATHEXT` extension — except that Claude Code
 * stops at the first hit and this returns all of them, so the caller can look
 * for `bin\bash.exe` behind each one. Deliberate divergence: with only the
 * first hit, a shim ahead of the real Git defeats detection there too.
 */
function findGitExecutables(): string[] {
  const extensions = (process.env.PATHEXT ?? "")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter((ext) => WINDOWS_GIT_EXTS.includes(ext));
  const names = [
    ...(extensions.length > 0 ? extensions : WINDOWS_GIT_EXTS).map(
      (ext) => `git${ext}`,
    ),
    "git",
  ];

  const dirs: string[] = [];
  try {
    dirs.push(process.cwd());
  } catch {
    // cwd was removed underneath the process; PATH still gets walked.
  }
  for (const entry of (process.env.PATH ?? "").split(";")) {
    const dir = entry.trim().replace(/^"(.*)"$/, "$1");
    if (dir) dirs.push(dir);
  }

  const hits: string[] = [];
  const tried = new Set<string>();
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.win32.join(dir, name);
      // PATH entries are case-insensitive and often duplicated.
      const key = candidate.toLowerCase();
      if (tried.has(key)) continue;
      tried.add(key);
      if (existsSync(candidate)) hits.push(candidate);
    }
  }
  return hits;
}

/**
 * Locate `git` on Windows and infer bash.exe next to it: the two common
 * `cmd\git.exe` locations first, then every `git` on cwd / `PATH` in order.
 * Each hit gets its own `../../bin/bash.exe` check — a hit without bash.exe
 * (a shim, a Git without the bash component) is skipped, not obeyed. Every
 * miss is appended to `skipped` for the diagnostic the caller logs.
 */
function inferGitBashFromGit(skipped: string[]): string | undefined {
  // 1. Common git.exe locations
  const fixed = WINDOWS_GIT_EXE_PATHS.filter((candidate) => {
    if (existsSync(candidate)) return true;
    skipped.push(`git.exe not found: ${candidate}`);
    return false;
  });

  // 2. Every git on cwd + PATH
  const onPath = findGitExecutables();
  if (onPath.length === 0) skipped.push("no git executable on cwd or PATH");

  const seen = new Set<string>();
  for (const gitExe of [...fixed, ...onPath]) {
    if (seen.has(gitExe.toLowerCase())) continue;
    seen.add(gitExe.toLowerCase());
    const bashPath = bashBesideGit(gitExe);
    if (existsSync(bashPath)) return bashPath;
    skipped.push(`bash.exe not found: ${bashPath} (behind ${gitExe})`);
  }
  return undefined;
}

/**
 * `logger.warn`, once per process per message. `resolveShellPath()` re-runs on
 * every Bash call (deliberately not memoized), so a machine that cannot resolve
 * would otherwise append the same diagnostic each time. Routed to the
 * configured logger only (the CLI's log file) — never `console`, since stdout
 * is the JSON-RPC channel under `--stdio`.
 */
const warned = new Set<string>();
function warnOnce(message: string, detail?: unknown): void {
  if (warned.has(message)) return;
  warned.add(message);
  if (detail === undefined) logger.warn(message);
  else logger.warn(message, detail);
}

/** Drop the once-per-process memo so a test can observe the warning again. */
export function __resetShellResolverWarnMemoForTesting(): void {
  warned.clear();
}

/**
 * Resolve a bash or zsh binary on macOS/Linux.
 *
 * Priority (aligned with Claude Code's findSuitableShell):
 *   1. WAVE_SHELL env var (only if it points to an executable bash/zsh)
 *   2. $SHELL (only if it is bash/zsh)
 *   3. `which bash` / `which zsh` discovered on $PATH
 *   4. Common fixed locations (/bin, /usr/bin, /usr/local/bin, /opt/homebrew/bin)
 *
 * When $SHELL is bash, bash is preferred; otherwise zsh is preferred. This
 * matters because /bin/sh may be dash (Debian/Ubuntu) or POSIX-mode bash
 * (macOS), neither of which supports bashisms like process substitution
 * `<()`, causing `eval '<()...'` to fail at parse time.
 */
function resolveUnixShell(): string | undefined {
  // 1. WAVE_SHELL env override
  const waveShell = process.env.WAVE_SHELL;
  if (waveShell && isSupportedShell(waveShell) && isExecutable(waveShell)) {
    return waveShell;
  }

  // 2. $SHELL (only bash/zsh)
  const envShell = process.env.SHELL;
  const isEnvShellSupported = !!envShell && isSupportedShell(envShell);
  const preferBash = envShell?.includes("bash") ?? false;

  // 3. Locate via PATH
  const bashPath = which("bash");
  const zshPath = which("zsh");

  // 4. Fixed common locations, ordered by user preference
  const shellOrder = preferBash ? ["bash", "zsh"] : ["zsh", "bash"];
  const candidates = shellOrder.flatMap((shell) =>
    FIXED_SHELL_DIRS.map((dir) => `${dir}/${shell}`),
  );

  // Discovered PATH paths: preferred type first, the other as fallback
  if (preferBash) {
    if (bashPath) candidates.unshift(bashPath);
    if (zshPath) candidates.push(zshPath);
  } else {
    if (zshPath) candidates.unshift(zshPath);
    if (bashPath) candidates.push(bashPath);
  }

  // Always prioritize $SHELL if it is a supported, executable shell
  if (isEnvShellSupported && envShell && isExecutable(envShell)) {
    candidates.unshift(envShell);
  }

  return candidates.find((candidate) => isExecutable(candidate));
}

/**
 * Resolve the Git Bash path on Windows.
 *
 * Priority (aligned with Claude Code's findGitBashPath):
 *   1. WAVE_GIT_BASH_PATH env var — only when it names an existing bash/sh
 *      binary; anything else is ignored with a warning and detection goes on
 *   2. Infer from the `git` executable: fixed `cmd\git.exe` locations, then
 *      every `git` on cwd / PATH (<git dir>/../../bin/bash.exe)
 *   3. Common install paths (C:\Program Files\Git\bin\bash.exe, etc.)
 *
 * When nothing resolves, what was probed and why each candidate was skipped
 * is logged once (see warnOnce) — the "Git Bash not found" error the Bash
 * tool returns carries no detail, so this is where support starts.
 */
function resolveWindowsShell(): string | undefined {
  // 1. Env var override, validated the way CLAUDE_CODE_GIT_BASH_PATH is
  const waveBashPath = process.env.WAVE_GIT_BASH_PATH;
  if (waveBashPath) {
    const onDisk = existsSync(waveBashPath);
    const isBashName = GIT_BASH_BASENAMES.includes(
      path.win32.basename(waveBashPath).toLowerCase(),
    );
    if (onDisk && isBashName) return waveBashPath;
    warnOnce(
      `WAVE_GIT_BASH_PATH "${waveBashPath}" ${onDisk ? "is not a bash/sh binary" : "not found"}; falling back to auto-detection`,
    );
  }

  // 2. Infer from git executable location
  const skipped: string[] = [];
  const inferred = inferGitBashFromGit(skipped);
  if (inferred) {
    return inferred;
  }

  // 3. Common install paths
  const paths = [
    ...WINDOWS_GIT_BASH_PATHS,
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
      : null,
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      return p;
    }
    skipped.push(`bash.exe not found: ${p}`);
  }

  warnOnce("Git Bash not found; Bash tool unavailable on Windows", {
    probed: skipped,
  });
  return undefined;
}

export function resolveShellPath(): string | undefined {
  if (process.platform === "win32") {
    return resolveWindowsShell();
  }

  return resolveUnixShell();
}
