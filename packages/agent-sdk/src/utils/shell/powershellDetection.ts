/**
 * Finding the PowerShell binary.
 *
 * Deliberately not `shellResolver.which()`: that one is bash's helper and
 * splits `PATH` on `":"`, which on Windows cuts drive letters in half
 * (`C:\Windows\System32` → `C` + `\Windows\System32`). Here the split is
 * `path.delimiter`.
 *
 * Preference is PowerShell 7+ (`pwsh`) over Windows PowerShell 5.1
 * (`powershell`), and it is *name-major*: every `PATH` directory is searched for
 * `pwsh.exe` before any is searched for `powershell.exe`. A directory-major scan
 * would usually find `System32\WindowsPowerShell\v1.0\powershell.exe` first
 * (System32 comes early in `PATH`) and silently pin the session to 5.1 even
 * when 7 is installed — and it would make the choice depend on the order of the
 * user's `PATH`, which is not something a parser should vary on.
 *
 * The parser and (in P3d) the executor must resolve through *this* module, so
 * "the shell that parses" and "the shell that runs" stay the same binary. That
 * matters: 5.1 rejects `&&` outright, so a 7-parse plus a 5.1-execute pairing
 * would accept a command it cannot run.
 */

import { accessSync, constants, statSync } from "fs";
import path from "path";

/** `core` = PowerShell 7+ (`pwsh`), `desktop` = Windows PowerShell 5.1. */
export type PowerShellEdition = "core" | "desktop";

const WINDOWS_EXECUTABLES = ["pwsh.exe", "powershell.exe"] as const;
const UNIX_EXECUTABLES = ["pwsh"] as const;

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) return false;
    // Windows has no execute bit; on Unix a non-executable file in PATH is not
    // a command.
    if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `PATH` entries, in order, with the quotes and trailing separators that
 * Windows installers like to leave behind removed.
 */
function pathDirectories(): string[] {
  return (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
    .filter((entry) => entry.length > 0);
}

/**
 * Absolute path of a PowerShell binary, or `undefined` when there is none.
 * Unmemoized: callers in a hot path use `getPowerShellPath()`.
 */
export function findPowerShell(): string | undefined {
  const executables =
    process.platform === "win32" ? WINDOWS_EXECUTABLES : UNIX_EXECUTABLES;
  const directories = pathDirectories();

  for (const executable of executables) {
    for (const directory of directories) {
      const candidate = path.join(directory, executable);
      if (isExecutableFile(candidate)) return candidate;
    }
  }

  // A PATH edit that drops System32 is common enough in embedded environments
  // (and breaks nothing else visibly), so the well-known location is worth a
  // last attempt before declaring PowerShell missing.
  if (process.platform === "win32") {
    const systemRoot = process.env.SystemRoot ?? process.env.windir;
    if (systemRoot) {
      const candidate = path.join(
        systemRoot,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      if (isExecutableFile(candidate)) return candidate;
    }
  }

  return undefined;
}

/** `undefined` until looked up; `null` once we know there is none. */
let cachedPath: string | null | undefined;

/** Memoized `findPowerShell()`. Missing PowerShell is cached too. */
export function getPowerShellPath(): string | undefined {
  if (cachedPath === undefined) {
    cachedPath = findPowerShell() ?? null;
  }
  return cachedPath ?? undefined;
}

/** Which PowerShell this binary is. Edition follows the executable's name. */
export function getPowerShellEdition(
  shellPath: string | undefined = getPowerShellPath(),
): PowerShellEdition | undefined {
  if (!shellPath) return undefined;
  return path.basename(shellPath).toLowerCase().startsWith("pwsh")
    ? "core"
    : "desktop";
}

/** Drop the memoized lookup (tests, and a session that edits `PATH`). */
export function resetPowerShellCache(): void {
  cachedPath = undefined;
}
