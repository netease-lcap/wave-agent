import { resolve } from "path";
import { homedir, hostname } from "os";
import { relative } from "path";

/**
 * Handle paths, supporting ~ expansion
 * @param filePath File path
 * @param workdir Working directory
 * @returns Resolved absolute path
 */
export function resolvePath(filePath: string, workdir: string): string {
  // If the path starts with ~, replace it with the user's home directory
  if (filePath.startsWith("~/")) {
    return resolve(homedir(), filePath.slice(2));
  }

  // If the path starts with ~ but has no slash, it means it's the home directory
  if (filePath === "~") {
    return homedir();
  }

  // For other paths, resolve using the specified working directory
  return resolve(workdir, filePath);
}

/**
 * Get relative path for display, use relative path if shorter and not in parent directory.
 *
 * The returned path is always normalized to forward slashes (posix) regardless of
 * platform. This keeps display output consistent across Windows/Unix so that logs,
 * LLM context, and tests don't need platform-specific branches — `path.relative`
 * and `path.join` produce backslashes on Windows, which we collapse here.
 *
 * @param filePath Absolute path
 * @param workdir Working directory
 * @returns Path for display (relative or absolute), always forward-slash
 */
export function getDisplayPath(filePath: string, workdir: string): string {
  if (!filePath) {
    return filePath;
  }

  try {
    const relativePath = relative(workdir, filePath);

    // If the relative path is empty (i.e., the paths are the same), return "."
    if (relativePath === "") {
      return ".";
    }

    // If the relative path is shorter than the absolute path and does not start with .. (not in parent directory), use the relative path
    if (
      relativePath.length < filePath.length &&
      !relativePath.startsWith("..")
    ) {
      return toPosixPath(relativePath);
    }
  } catch {
    // If calculating the relative path fails, keep the original path
  }
  return toPosixPath(filePath);
}

/**
 * Convert backslashes to forward slashes for shell compatibility on Windows.
 * On Windows, os.tmpdir() returns paths with backslashes (e.g., C:\Users\foo\Temp),
 * which are treated as escape characters when interpolated into shell command strings.
 * Returns the path as-is on non-Windows platforms.
 */
export function toPosixPath(p: string): string {
  return process.platform === "win32" ? p.replace(/\\/g, "/") : p;
}

/**
 * Convert a POSIX-style path to a native Windows path. Git Bash / MSYS shells
 * print POSIX paths (e.g. `pwd -P` outputs `/c/Users/foo`), which Node.js on
 * Windows would otherwise resolve against the current drive root (e.g. `/c/...`
 * becomes `C:\c\...`) and fail with ENOENT. Handles `/c/...` (MSYS2/Git Bash),
 * `/cygdrive/c/...` and `//server/share` (UNC) forms. Returns the path as-is on
 * non-Windows platforms.
 */
export function toWindowsPath(p: string): string {
  if (process.platform !== "win32") return p;
  // UNC paths: //server/share -> \\server\share
  if (p.startsWith("//")) {
    return p.replace(/\//g, "\\");
  }
  // /cygdrive/c/... -> C:\...
  const cygdriveMatch = p.match(/^\/cygdrive\/([A-Za-z])(\/|$)/);
  if (cygdriveMatch) {
    const driveLetter = cygdriveMatch[1]!.toUpperCase();
    const rest = p.slice(("/cygdrive/" + cygdriveMatch[1]).length);
    return driveLetter + ":" + (rest || "\\").replace(/\//g, "\\");
  }
  // /c/... (MSYS2/Git Bash) -> C:\...
  const driveMatch = p.match(/^\/([A-Za-z])(\/|$)/);
  if (driveMatch) {
    const driveLetter = driveMatch[1]!.toUpperCase();
    const rest = p.slice(2);
    return driveLetter + ":" + (rest || "\\").replace(/\//g, "\\");
  }
  // Already Windows or relative — just flip slashes
  return p.replace(/\//g, "\\");
}

/** `\\?\D:\x` or `\\?\D:` — a drive path behind the "no normalisation" prefix. */
const VERBATIM_DRIVE = /^[\\/]{2}\?\\([A-Za-z]):(?=[\\/]|$)/;
/** Any other `\\?\…` / `\\.\…` path: a device or a namespace, not a place on a drive. */
const DEVICE_PATH = /^[\\/]{2}[?.][\\/]/;
/** `//host/D$/x` — an administrative share, which always names that drive. */
const ADMIN_SHARE = /^[\\/]{2}([^\\/]+)[\\/]([A-Za-z])\$(?=$|[\\/])/;
/** `/c/x`, `/cygdrive/c/x`, `/proc/cygdrive/c/x` — MSYS. */
const MSYS_DRIVE = /^\/(?:(?:proc\/)?cygdrive\/)?([A-Za-z])(?=\/|$)/;

/**
 * Read a path the way the shell on Windows will read it.
 *
 * The **reverse** of {@link toWindowsPath}, and the direction a *judgment* has
 * to use. `toWindowsPath` answers "where does this shell output live on disk"
 * (`pwd -P` prints `/c/Users/foo`); this one answers "which directory does this
 * command line actually delete", where the model may have written any of Git
 * Bash's spellings: `rm -rf /d/x`, `rm -rf /cygdrive/d/x`,
 * `rm -rf //localhost/D$/x` and `rm -rf \\?\D:\x` all delete `D:\x`.
 *
 * Judging with the forward mapping instead is how "the path that gets judged is
 * not the path that gets deleted" happens: it turns `/usr` into `\usr` on the
 * *current* drive and `D:/x` into a form the drive-letter question no longer
 * recognises. So the comparison always runs on the restored spelling.
 *
 * Returns the path as written on non-Windows platforms, where none of these
 * spellings name a drive.
 */
export function restoreWindowsPath(p: string): string {
  if (process.platform !== "win32") return p;

  const verbatim = p.match(VERBATIM_DRIVE);
  if (verbatim) {
    return withDriveRoot(verbatim[1]!, p.slice(verbatim[0].length));
  }
  // A device path (`\\?\GLOBALROOT\Device\…`, `\\.\PhysicalDrive0`) has no
  // place on a drive, so there is nothing to restore. The callers refuse it.
  if (DEVICE_PATH.test(p)) return p;

  const admin = p.match(ADMIN_SHARE);
  if (admin) {
    const rest = p.slice(admin[0].length).replace(/\//g, "\\");
    // `\\localhost\D$\x` is `D:\x` on this machine — the same drive, reached
    // through the share Windows creates for it. Only the local host is expanded:
    // another machine's `D$` is a different disk, so the share is kept as it is
    // and `isCriticalSystemDirectory` refuses it instead of guessing.
    if (isOwnHost(admin[1]!)) return withDriveRoot(admin[2]!, rest);
    return `\\\\${admin[1]}\\${admin[2]!.toUpperCase()}$${rest}`;
  }
  // A UNC share is already native once the session separator is flipped.
  if (p.startsWith("//")) return p.replace(/\//g, "\\");

  const msys = p.match(MSYS_DRIVE);
  if (msys) return withDriveRoot(msys[1]!, p.slice(msys[0].length));

  return p;
}

/** `C` + `\rest` → `C:\rest`; an empty rest is the drive root itself. */
function withDriveRoot(letter: string, rest: string): string {
  return letter.toUpperCase() + ":" + (rest.replace(/\//g, "\\") || "\\");
}

/**
 * Does [host] name this machine? `localhost`, a loopback address, the host name
 * and its short form — the spellings that reach the same disks. Claude Code draws
 * the same line before it expands an administrative share (`ne` there), because
 * only then does `<letter>$` name a local drive.
 */
function isOwnHost(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  if (name === "localhost" || /^127(?:\.\d{1,3}){3}$/.test(name)) return true;
  const own = hostname().toLowerCase();
  return own.length > 0 && (name === own || name === own.split(".")[0]);
}
