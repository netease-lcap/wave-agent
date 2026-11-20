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
 * game; the families below cover the ones where a single mistyped command is
 * unrecoverable: filesystem roots, first-level system directories, the user's
 * own profile root — and, like the bash channel, **the session's working
 * directory and its ancestors**, which is how "delete the repository you are
 * working in" is caught with no notion of what a repository is.
 *
 * The critical-path families themselves live in `utils/pathSafety.ts` so the
 * bash channel judges the same paths by the same list.
 */

import path from "node:path";
import { homedir } from "node:os";
import {
  isCriticalSystemDirectory,
  isFilesystemRoot,
  isHomeDirectoryPath,
  isPathAtOrAbove,
} from "../../utils/pathSafety.js";

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

/** Why a target is refused — the deny message names it. */
export type DangerousTargetReason =
  | "root"
  | "home"
  | "system"
  | "working_directory";

export interface DangerousTarget {
  reason: DangerousTargetReason;
  /** Where the target really points, so the message can name it. */
  resolved: string;
}

/**
 * Judge a destructive command's target.
 *
 * [workdir] resolves relative targets — `..\..` from `C:\a\b` is `C:\`, and that
 * has to count. [protectedRoots] are the directories the session works in (its
 * working directory and every additional directory): a target that *contains*
 * one of them is an ancestor of one, which is the shape that deletes the whole
 * checkout instead of a folder inside it.
 */
export function findDangerousTarget(
  target: string,
  workdir?: string,
  protectedRoots: string[] = [],
): DangerousTarget | null {
  const raw = target.trim();
  if (!raw) return null;
  if (isHomeReference(raw)) return { reason: "home", resolved: homedir() };

  const resolved = path.resolve(workdir ?? process.cwd(), raw);
  const at = (reason: DangerousTargetReason): DangerousTarget => ({
    reason,
    resolved,
  });

  // A filesystem root: `/`, `\`, `C:\`.
  if (isFilesystemRoot(resolved)) return at("root");

  // A home directory itself.
  if (isHomeDirectoryPath(resolved)) return at("home");

  // The working directory itself, or an ancestor of it.
  if (protectedRoots.some((root) => isPathAtOrAbove(resolved, root))) {
    return at("working_directory");
  }

  // A system directory: `C:\Windows`, `C:\Windows\System32`, `/etc`, `/usr/bin`.
  // Depth-insensitive by construction — the comparison is on the normalised
  // path below the root, not on the last segment.
  if (isCriticalSystemDirectory(resolved)) return at("system");

  return null;
}

/** true when [target] must never be the target of a destructive command. */
export function isDangerousTargetPath(
  target: string,
  workdir?: string,
  protectedRoots: string[] = [],
): boolean {
  return findDangerousTarget(target, workdir, protectedRoots) !== null;
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
