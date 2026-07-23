import fs from "fs";
import path from "path";

export const WINDOWS_GIT_BASH_PATHS = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
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

export function resolveShellPath(): string | undefined {
  if (process.platform === "win32") {
    if (process.env.GIT_BASH_PATH) {
      return process.env.GIT_BASH_PATH;
    }

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

  return resolveUnixShell();
}
