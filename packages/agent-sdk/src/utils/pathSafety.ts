import path from "node:path";
import fs from "node:fs";

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

    const realTarget = fs.realpathSync(absoluteTarget);
    const realParent = fs.realpathSync(absoluteParent);

    const relative = path.relative(realParent, realTarget);

    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}
