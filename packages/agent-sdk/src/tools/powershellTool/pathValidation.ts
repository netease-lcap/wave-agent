/**
 * Where a PowerShell command's paths may point.
 *
 * Two different questions live here, and they get two different answers:
 *
 * - **Inside the Safe Zone?** — no. Asking is the answer (`isInsideSafeZone`,
 *   supplied by the caller, decides; this module only extracts the paths).
 * - **A path that must never be touched, whatever the rules say?** — `deny`.
 *   `Remove-Item C:\ -Recurse` is not a command whose persistence option should
 *   be offered; it is a machine that stops booting. Rules do not reach it.
 *
 * The list is short on purpose. Naming every dangerous directory is a losing
 * game; the four families below cover the ones where a single mistyped command
 * is unrecoverable: filesystem roots, the user's own profile root, the Windows
 * installation, and the POSIX system directories for a PowerShell on Linux.
 */

import path from "path";
import { homedir } from "os";

/**
 * System directories, written relative to the root and `/`-separated so one
 * list serves both `C:\Windows\System32` and `/usr`. Only these exact
 * directories are refused — everything below them (`C:\Windows\Temp\x.txt`)
 * is an ordinary path and reaches the normal ask.
 */
const DANGEROUS_ROOTS = new Set([
  "windows",
  "windows/system32",
  "windows/syswow64",
  "program files",
  "program files (x86)",
  "programdata",
  "etc",
  "usr",
  "usr/bin",
  "usr/sbin",
  "bin",
  "sbin",
  "lib",
  "lib64",
  "boot",
  "dev",
  "proc",
  "sys",
]);

/**
 * Environment-shaped home references. `$HOME` / `~` / `%USERPROFILE%` are all
 * written by a model that means "the user's home", and every one of them has
 * the same consequence when it ends up as the target of a recursive delete.
 */
const HOME_REFERENCES = new Set([
  "~",
  "$home",
  "${home}",
  "$env:home",
  "$env:userprofile",
  "%userprofile%",
  "${env:userprofile}",
]);

/** Does this text point at a home directory rather than a path inside one? */
function isHomeReference(target: string): boolean {
  const trimmed = target
    .trim()
    .replace(/[\\/]+$/, "")
    .toLowerCase();
  return HOME_REFERENCES.has(trimmed);
}

/**
 * Is [resolved] somebody's home directory? Compared against the real answer,
 * not a pattern: `Remove-Item C:\Users\liuyiqi02 -Recurse` is the same command
 * as `Remove-Item $env:USERPROFILE -Recurse` written the long way.
 */
function isHomeDirectory(resolved: string): boolean {
  const homes = [process.env.USERPROFILE, process.env.HOME, homedir()];
  return homes.some(
    (home) => typeof home === "string" && path.resolve(home) === resolved,
  );
}

/**
 * true when [target] is a path that must never be the target of a destructive
 * command: a drive/filesystem root, the Windows or POSIX system directories, or
 * a home directory itself.
 *
 * [workdir] resolves relative targets — `..\..` from `C:\a\b` is `C:\`, and that
 * has to count. A relative path that simply stays where it is (`.`) does not.
 */
export function isDangerousTargetPath(
  target: string,
  workdir?: string,
): boolean {
  const raw = target.trim();
  if (!raw) return false;
  if (isHomeReference(raw)) return true;

  const resolved = path.resolve(workdir ?? process.cwd(), raw);
  const parsed = path.parse(resolved);

  // A filesystem root: `/`, `\`, `C:\`.
  if (resolved === parsed.root) return true;

  // A home directory itself.
  if (isHomeDirectory(resolved)) return true;

  // A system directory: `C:\Windows`, `C:\Windows\System32`, `/etc`, `/usr/bin`.
  // Depth-insensitive by construction — the comparison is on the normalised
  // path below the root, not on the last segment.
  const relative = resolved
    .slice(parsed.root.length)
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/")
    .toLowerCase();
  if (relative && DANGEROUS_ROOTS.has(relative)) return true;

  return false;
}

/**
 * The home directory a target points at, if it is one, so the deny message can
 * name what was refused instead of echoing the model's spelling back.
 */
export function describeDangerousTarget(
  target: string,
  workdir?: string,
): string {
  return path.resolve(workdir ?? process.cwd(), target.trim());
}
