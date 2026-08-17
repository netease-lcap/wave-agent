import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

export const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
];

// Common git.exe locations (checked before falling back to `where.exe`).
const WINDOWS_GIT_EXE_PATHS = [
  "C:\\Program Files\\Git\\cmd\\git.exe",
  "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
];

// Common directories where bash/zsh may live, used as fallback after PATH lookup.
const FIXED_SHELL_DIRS = [
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
];

function isExecutable(shellPath: string): boolean {
  try {
    fs.accessSync(shellPath, fs.constants.X_OK);
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
 * Locate the `git` executable on Windows, then infer bash.exe from it.
 * Checks common Git for Windows install locations first, then falls back
 * to `where.exe git` (aligned with Claude Code's findExecutable('git')).
 * Returns the inferred bash.exe path, or undefined if not found.
 */
function inferGitBashFromGit(): string | undefined {
  // 1. Common git.exe locations
  let gitExe: string | undefined;
  for (const candidate of WINDOWS_GIT_EXE_PATHS) {
    if (fs.existsSync(candidate)) {
      gitExe = candidate;
      break;
    }
  }

  // 2. Fallback: where.exe git
  if (!gitExe) {
    try {
      const result = execFileSync("where", ["git"], {
        stdio: "pipe",
        encoding: "utf8",
        timeout: 3000,
      }).trim();
      // where.exe may return multiple lines; take the first non-empty one.
      gitExe = result.split(/\r?\n/).find((line) => line.trim()) || undefined;
    } catch {
      gitExe = undefined;
    }
  }

  if (!gitExe) return undefined;

  // git.exe is at <install>/cmd/git.exe → bash.exe is at <install>/bin/bash.exe
  // join treats git.exe as a segment, so ".." cancels it (→ cmd dir),
  // the second ".." cancels cmd (→ <install>), then bin/bash.exe.
  const bashPath = path.win32.join(gitExe, "..", "..", "bin", "bash.exe");
  if (fs.existsSync(bashPath)) {
    return bashPath;
  }
  return undefined;
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
 *   1. WAVE_GIT_BASH_PATH env var
 *   2. Infer from `git` executable location (<git dir>/../../bin/bash.exe)
 *   3. Common install paths (C:\Program Files\Git\bin\bash.exe, etc.)
 */
function resolveWindowsShell(): string | undefined {
  // 1. Env var override
  if (process.env.WAVE_GIT_BASH_PATH) {
    return process.env.WAVE_GIT_BASH_PATH;
  }

  // 2. Infer from git executable location
  const inferred = inferGitBashFromGit();
  if (inferred) {
    return inferred;
  }

  // 4. Common install paths
  const paths = [
    ...WINDOWS_GIT_BASH_PATHS,
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`
      : null,
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return undefined;
}

export function resolveShellPath(): string | undefined {
  if (process.platform === "win32") {
    return resolveWindowsShell();
  }

  return resolveUnixShell();
}
