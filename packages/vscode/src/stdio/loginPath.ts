/**
 * Login-shell PATH adoption for GUI-launched VS Code.
 *
 * VS Code started from Finder/Dock (macOS) or a desktop launcher (Linux)
 * inherits a bare system PATH without the user's nvm/homebrew/pnpm dirs, and
 * on Windows the Git Bash profile (~/.bashrc) is never sourced by the
 * extension host. Both the binary resolver (`which wave`/`which node`/
 * `which npm`) and the shell commands the agent spawns would then fail to
 * find user tools.
 *
 * Probe the user's login shell once at activation and adopt its PATH into
 * `process.env` — mirrors the desktop app's adoptLoginShellPath() and the
 * JetBrains plugin's BinaryResolver.resolveEnv(). The SDK itself runs every
 * shell command with a plain `-c`; the login PATH is injected once at the
 * host layer, so no per-command login-shell spawn is needed.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { decodeCommandOutput } from "./binaryResolver";

const PROBE_TIMEOUT_MS = 5000;

/**
 * Locate the Git Bash `bash.exe` on Windows (mirrors the agent-sdk shell
 * resolver's resolveWindowsShell):
 *   1. WAVE_GIT_BASH_PATH env var override
 *   2. Infer from `where git`: <git>/cmd/git.exe → <git>/bin/bash.exe
 *   3. Common install paths (Program Files, Program Files (x86),
 *      %LOCALAPPDATA%\Programs\Git)
 * Returns undefined on non-Windows or when no Git Bash can be found.
 */
export function resolveGitBashPath(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform !== "win32") return undefined;

  // 1. Env var override.
  if (process.env.WAVE_GIT_BASH_PATH) {
    return process.env.WAVE_GIT_BASH_PATH;
  }

  // 2. Infer from `where git`.
  try {
    const output = decodeCommandOutput(
      execFileSync("where", ["git"], {
        encoding: "buffer",
        stdio: "pipe",
        timeout: 3000,
      }),
    ).trim();
    const gitExe = output
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean);
    if (gitExe) {
      const bashPath = path.win32.resolve(
        gitExe,
        "..",
        "..",
        "bin",
        "bash.exe",
      );
      if (fs.existsSync(bashPath)) return bashPath;
    }
  } catch {
    // git not on PATH — fall through to common install paths
  }

  // 3. Common install paths.
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.win32.join(
        process.env.LOCALAPPDATA,
        "Programs",
        "Git",
        "bin",
        "bash.exe",
      ),
    );
  }
  return candidates.find((p) => fs.existsSync(p));
}

/** Run a probe command and return the last non-empty stdout line, if any. */
function probeWithShell(shellPath: string, args: string[]): string | undefined {
  try {
    const output = execFileSync(shellPath, args, {
      encoding: "utf-8",
      timeout: PROBE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim().split("\n").pop()?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe the user's login-shell PATH.
 *
 * macOS/Linux: `$SHELL` (if set and executable), else /bin/zsh, else
 * /bin/bash, with `-lic 'echo $PATH'` — `-l` sources the profile, `-i` picks
 * up interactive-only PATH additions (e.g. nvm's shell init).
 *
 * Windows: Git Bash `-lic 'cygpath -pw "$PATH"'` — cygpath converts the
 * POSIX-form Git Bash PATH back to Windows form (`;`-separated) so cmd.exe
 * and Node subprocesses can still resolve tools.
 *
 * Returns undefined on failure (shell missing, timeout, non-zero exit); the
 * caller then keeps the inherited environment.
 */
export function probeLoginPath(
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (platform === "win32") {
    const gitBashPath = resolveGitBashPath(platform);
    if (!gitBashPath) return undefined;
    return probeWithShell(gitBashPath, ["-lic", 'cygpath -pw "$PATH"']);
  }

  const shell = [process.env.SHELL, "/bin/zsh", "/bin/bash"].find(
    (c) => c && fs.existsSync(c),
  );
  if (!shell) return undefined;
  return probeWithShell(shell, ["-lic", "echo $PATH"]);
}

let adoptedPath: string | undefined;

/**
 * Probe the login PATH once and inject it into process.env. Safe to call
 * multiple times (the probe result is cached). Never throws — on failure the
 * environment is left untouched and the binary resolver surfaces its usual
 * errors.
 */
export function adoptLoginPathIntoEnv(
  platform: NodeJS.Platform = process.platform,
): void {
  if (adoptedPath !== undefined) return;
  const probed = probeLoginPath(platform);
  if (probed) {
    adoptedPath = probed;
    process.env.PATH = probed;
  }
}

/** Reset the cached adoption — for testing only. */
export function _resetLoginPathCacheForTesting(): void {
  adoptedPath = undefined;
}
