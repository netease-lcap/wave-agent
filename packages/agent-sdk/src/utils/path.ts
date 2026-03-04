import { resolve } from "path";
import { homedir } from "os";
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
 * Get relative path for display, use relative path if shorter and not in parent directory
 * @param filePath Absolute path
 * @param workdir Working directory
 * @returns Path for display (relative or absolute)
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
      return relativePath;
    }
  } catch {
    // If calculating the relative path fails, keep the original path
  }
  return filePath;
}
