import path from "node:path";
import fs from "node:fs";
import { homedir } from "node:os";

/**
 * Get the real path of a file or directory, even if it doesn't exist.
 * For non-existent paths, it resolves the real path of the nearest existing parent.
 */
function getSafeRealPath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p; // Root reached
    return path.join(getSafeRealPath(parent), path.basename(p));
  }
}

/**
 * Check if a target path is inside a parent directory.
 * Resolves symlinks and handles absolute paths.
 * Returns true if target is the same as parent or is a subdirectory of parent.
 * @param target The path to check
 * @param parent The parent directory path
 * @returns boolean
 */
export function isPathInside(target: string, parent: string): boolean {
  try {
    const absoluteTarget = path.resolve(target);
    const absoluteParent = path.resolve(parent);

    const realTarget = getSafeRealPath(absoluteTarget);
    const realParent = getSafeRealPath(absoluteParent);

    const relative = path.relative(realParent, realTarget);

    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

/**
 * true when [target] is [inner] itself or one of its ancestors — i.e. deleting
 * `target` takes `inner` with it.
 *
 * The mirror image of {@link isPathInside}, and the direction that matters for
 * deletions: `rm -rf ..` from `/a/b` is not "inside the safe zone", it *is* the
 * safe zone's parent. Symlinks are resolved on both sides for the same reason
 * they are in `isPathInside`.
 */
export function isPathAtOrAbove(target: string, inner: string): boolean {
  return isPathInside(inner, target);
}

/**
 * Directories where a destructive command is refused outright, written relative
 * to the root and `/`-separated so one list serves `C:\Windows` and `/usr`.
 *
 * Mirrors Claude Code's first-level directory list plus the Windows entries the
 * PowerShell hard-deny already had. Only these exact directories are critical —
 * everything below them (`/usr/local/lib/x`, `C:\Windows\Temp\x.txt`) is an
 * ordinary path.
 */
const CRITICAL_SYSTEM_DIRS: ReadonlySet<string> = new Set([
  // POSIX first-level directories
  "bin",
  "boot",
  "cores",
  "dev",
  "etc",
  "home",
  "lib",
  "lib32",
  "lib64",
  "libx32",
  "lost+found",
  "media",
  "mnt",
  "nix",
  "opt",
  "proc",
  "root",
  "run",
  "sbin",
  "snap",
  "srv",
  "sys",
  "tmp",
  "usr",
  "usr/bin",
  "usr/sbin",
  "var",
  // macOS
  "applications",
  "library",
  "private",
  "system",
  "users",
  "volumes",
  // Windows
  "cygdrive",
  "program files",
  "program files (x86)",
  "programdata",
  "windows",
  "windows/system32",
  "windows/syswow64",
]);

/** true when [p] is a filesystem root: `/`, `\`, `C:\`. */
export function isFilesystemRoot(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

/**
 * true when [p] is a home directory itself. Compared against the real answer
 * rather than a spelling: `C:\Users\me` and `$env:USERPROFILE` are one place.
 */
export function isHomeDirectoryPath(p: string): boolean {
  const resolved = path.resolve(p);
  return [process.env.USERPROFILE, process.env.HOME, homedir()].some(
    (home) => typeof home === "string" && path.resolve(home) === resolved,
  );
}

/** true when [p] is one of the critical system directories itself. */
export function isCriticalSystemDirectory(p: string): boolean {
  const resolved = path.resolve(p);
  const parsed = path.parse(resolved);
  const relative = resolved
    .slice(parsed.root.length)
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
  return relative.length > 0 && CRITICAL_SYSTEM_DIRS.has(relative);
}
