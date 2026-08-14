/**
 * Windows path conversion utilities for Git Bash (POSIX shell) execution.
 *
 * Hook commands on Windows are executed via Git Bash instead of cmd.exe
 * (cmd.exe does not strip quotes from arguments after the first token, so
 * `node "C:\path\script.js"` silently fails — see issue #1773). Git Bash
 * cannot resolve Windows paths like `C:\Users\foo`: backslashes are treated
 * as escape characters and the drive letter breaks POSIX semantics. These
 * helpers convert Windows paths to the POSIX form Git Bash expects
 * (`C:\Users\foo` → `/c/Users/foo`), matching Claude Code's
 * `windowsPathToPosixPath`.
 */

/**
 * Convert a single Windows path to POSIX form for Git Bash:
 *   - `C:\Users\foo`  → `/c/Users/foo`
 *   - `C:/Users/foo`  → `/c/Users/foo`
 *   - `\\server\share` → `//server/share` (UNC preserved)
 *   - Already POSIX or relative paths are returned with slashes flipped.
 */
export function windowsPathToPosixPath(p: string): string {
  // UNC paths: \\server\share -> //server/share
  if (p.startsWith("\\\\")) {
    return p.replace(/\\/g, "/");
  }
  // Drive letter paths: C:\Users\foo -> /c/Users/foo
  const match = p.match(/^([A-Za-z]):[\\/]/);
  if (match) {
    const driveLetter = match[1]!.toLowerCase();
    return `/${driveLetter}${p.slice(2).replace(/\\/g, "/")}`;
  }
  // Already POSIX or relative — just flip slashes
  return p.replace(/\\/g, "/");
}

/**
 * Convert every Windows absolute path inside a shell command string to POSIX
 * form so Git Bash can parse it. Handles both quoted paths (which may contain
 * spaces, e.g. `node "C:\Program Files\script.js"`) and bare paths
 * (`cd C:\path\x`). Drive letters preceded by another alphanumeric character
 * (e.g. URLs like `http://`) are left untouched.
 */
export function toPosixCommand(command: string): string {
  // Quoted paths first (may contain spaces) — keep the surrounding quotes.
  let converted = command.replace(
    /"([A-Za-z]):[\\/][^"]*"/g,
    (quoted) => `"${windowsPathToPosixPath(quoted.slice(1, -1))}"`,
  );
  // Bare (unquoted) paths.
  converted = converted.replace(
    /(?<![A-Za-z0-9])([A-Za-z]):[\\/][^\s"']*/g,
    (match) => windowsPathToPosixPath(match),
  );
  return converted;
}
