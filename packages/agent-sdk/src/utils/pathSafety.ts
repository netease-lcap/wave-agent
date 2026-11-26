import path from "node:path";
import fs from "node:fs";
import { homedir } from "node:os";

/**
 * `\\?\` / `\\.\` — a device or a namespace the filesystem APIs read
 * differently from an ordinary path, so asking "what is the real path of this"
 * is the wrong question (`\\.\PhysicalDrive0` has no directory behind it).
 *
 * `\\?\C:\x` is the same shape and is deliberately *not* unwrapped here: the
 * reminder is that the caller resolves it first (`restoreWindowsPath`), and a
 * path that still carries the prefix is one this module refuses to interpret.
 */
const DEVICE_PATH = /^[\\/]{2}[?.][\\/]/;
/**
 * `\\host\admin$` / `\\host\d$` — a share that *is* a whole disk or a whole
 * installation. Together with the `\\?\` / `\\.\` shapes above these are the UNC
 * paths that cannot be placed on a local drive: a `<letter>$` share of *this*
 * machine is expanded to the drive before it gets here (`restoreWindowsPath`),
 * so whatever is left names another machine's disk — an entire drive, which no
 * removal should reach, or something this check cannot see into at all.
 */
const UNPLACEABLE_UNC =
  /^[\\/]{2}(?:[?.][\\/]|[^\\/]+[\\/](?:admin|[A-Za-z])\$(?=$|[\\/]))/i;

/**
 * What the filesystem said about a path.
 *
 * Three outcomes are not the same question, and collapsing them is how a
 * symlink or a not-yet-created directory stops being comparable to the path it
 * will resolve to. Claude Code draws the same three lines around its own
 * `realpathSync.native` call.
 */
type RealPathProbe =
  | { state: "resolved"; path: string }
  /** Nothing there yet (ENOENT / ENOTDIR) — resolve through the nearest parent. */
  | { state: "absent" }
  /** A device path: there is no such question to ask. */
  | { state: "unprobed" }
  /** Any other failure (EACCES, ELOOP, …) — keep the spelling rather than guess. */
  | { state: "error" };

function isDevicePath(p: string): boolean {
  return DEVICE_PATH.test(p);
}

/**
 * `realpathSync.native`, deliberately, and not the JavaScript one.
 *
 * The JS implementation resolves each segment as a link and leaves everything
 * else alone, so an 8.3 short name comes back unchanged: `C:\Users\LIUYIQ~1`
 * stays `C:\Users\LIUYIQ~1` and never compares equal to `C:\Users\liuyiqi02`.
 * The native call goes to the OS, which expands the short name — the only way
 * "delete the user's profile", typed in the 8.3 spelling, is recognised as the
 * profile. Claude Code made the same call for the same reason.
 */
function probeRealPath(p: string): RealPathProbe {
  if (isDevicePath(p)) return { state: "unprobed" };
  try {
    const resolved = fs.realpathSync.native(p);
    if (typeof resolved !== "string" || resolved.length === 0) {
      return { state: "error" };
    }
    return { state: "resolved", path: resolved };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? { state: "absent" }
      : { state: "error" };
  }
}

/**
 * Get the real path of a file or directory, even if it doesn't exist.
 * For non-existent paths, it resolves the real path of the nearest existing parent.
 *
 * A path that cannot be resolved at all (a device path, EACCES) keeps its own
 * spelling: guessing there would turn something unreachable into something that
 * looks like an ordinary directory, and every caller compares real paths to
 * decide whether a deletion is allowed.
 */
function getSafeRealPath(p: string): string {
  const probe = probeRealPath(p);
  if (probe.state === "resolved") return probe.path;
  if (probe.state === "absent") {
    const parent = path.dirname(p);
    if (parent === p) return p; // Root reached
    return path.join(getSafeRealPath(parent), path.basename(p));
  }
  return p;
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
 * ordinary path. On Windows this list is not what does the work: there, *every*
 * drive's first-level directory is critical (see
 * {@link isCriticalSystemDirectory}), because `D:\media` and `E:\tmp` are as
 * unrecoverable as `C:\Windows` when they are the only copy.
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

/**
 * Is this first-level name one of the system directories (`tmp`, `etc`, `Users`…)?
 *
 * Asked by the removal gate about a target whose first segment is a shell
 * variable: when the variable is empty, the segment after it becomes the path's
 * first level, so `$DIR/tmp` is `/tmp` waiting to happen. Name-based on
 * purpose — the question is what the name means, not where this machine keeps
 * its `tmp`, so it must not go through the drive rules.
 */
export function isSystemDirectoryName(name: string): boolean {
  return CRITICAL_SYSTEM_DIRS.has(name.toLowerCase());
}

/** The path's segments below its root, `/`-normalised and empty-free. */
function segmentsBelowRoot(resolved: string): string[] {
  const { root } = path.parse(resolved);
  return resolved
    .slice(root.length)
    .replace(/[\\/]+$/, "")
    .split(/[\\/]+/)
    .filter((segment) => segment.length > 0);
}

/** true when [p] is a filesystem root: `/`, `\`, `C:\`. */
export function isFilesystemRoot(p: string): boolean {
  const resolved = path.resolve(p);
  return resolved === path.parse(resolved).root;
}

/**
 * true when [p] is a home directory itself. Compared against the real answer
 * rather than a spelling: `C:\Users\me`, `$env:USERPROFILE` and the 8.3 form
 * `C:\Users\LIUYIQ~1` are one place.
 */
export function isHomeDirectoryPath(p: string): boolean {
  const resolved = getSafeRealPath(path.resolve(p));
  return [process.env.USERPROFILE, process.env.HOME, homedir()].some(
    (home) =>
      typeof home === "string" &&
      home.trim().length > 0 &&
      samePath(resolved, getSafeRealPath(path.resolve(home))),
  );
}

/** Windows paths are case-insensitive; POSIX paths are not. */
function samePath(a: string, b: string): boolean {
  const left = stripTrailingSeparator(a);
  const right = stripTrailingSeparator(b);
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function stripTrailingSeparator(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, "") : p;
}

/**
 * true when [p] is a directory that must never be deleted on its own.
 *
 * Three families, and the last two are the Windows-specific half:
 *
 * - **First-level directories by name** (`/etc`, `/usr/bin`, `C:\Windows`) —
 *   one list for every platform.
 * - **Any drive's first-level directory** (`D:\media`, `E:\tmp`, `C:\Users`) —
 *   Claude Code's rule (`/^[A-Za-z]:\/[^/]+$/`), and the reason `rm -rf
 *   D:/media` cannot be waved through as "some folder the agent knows". It
 *   applies whether or not the directory is there: a deletion target is judged
 *   by what it names, and a name one level below a drive root is never an
 *   ordinary build artefact.
 * - **Paths that cannot be placed on a drive at all** — device and namespace
 *   paths (`\\.\PhysicalDrive0`, `\\?\GLOBALROOT\…`), and administrative shares
 *   that are not this machine's (`\\host\admin$`, `\\host\D$`) — refused rather
 *   than guessed at, because there is nothing local to compare them to.
 */
export function isCriticalSystemDirectory(p: string): boolean {
  // The spelling is judged first, and not only the resolved path. A device path
  // has no real path to resolve (`\\.\PhysicalDrive0` is not a directory
  // behind another name), and a drive-qualified name is a statement about a
  // drive whether or not the host doing the judging has one — reading only the
  // resolved path would let this host's path semantics answer a question about
  // somebody else's.
  if (isUnplaceableSpelling(p) || isDriveFirstLevel(p)) return true;

  // The resolved path is judged as well, and this half is not optional: the
  // name list is written in first-level names, and those names are symlinks on
  // several systems (/etc and /tmp point into /private on macOS, /lib into
  // /usr/lib under usrmerge). Reading only the resolved path would lose the
  // very entry it looks up, so both spellings get their own look.
  const written = path.resolve(p);
  for (const spelling of [written, getSafeRealPath(written)]) {
    if (isUnplaceableSpelling(spelling) || isDriveFirstLevel(spelling)) {
      return true;
    }
    const segments = segmentsBelowRoot(spelling);
    if (segments.length === 0) return true; // a root, by definition
    if (CRITICAL_SYSTEM_DIRS.has(segments.join("/").toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * `\\.\PhysicalDrive0`, `\\?\GLOBALROOT\…`, `\\host\admin$` — a path with no
 * place on a drive: there is nothing local to compare it to, so it is refused
 * rather than resolved.
 */
function isUnplaceableSpelling(p: string): boolean {
  return UNPLACEABLE_UNC.test(p);
}

/** `D:\media` / `D:/media` — one level below a drive root, and nothing more. */
const DRIVE_FIRST_LEVEL = /^[A-Za-z]:[\\/][^\\/]+[\\/]?$/;

function isDriveFirstLevel(p: string): boolean {
  return DRIVE_FIRST_LEVEL.test(p);
}
