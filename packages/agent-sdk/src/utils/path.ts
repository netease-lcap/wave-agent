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
