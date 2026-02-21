import * as path from "node:path";
import * as fsSync from "node:fs";

/**
 * Check if a directory is a git repository
 * @param dirPath Directory path
 * @returns "Yes" if it's a git repository, "No" otherwise
 */
export function isGitRepository(dirPath: string): string {
  try {
    // Check if .git directory exists in current directory or any parent directory
    let currentPath = path.resolve(dirPath);
    while (currentPath !== path.dirname(currentPath)) {
      const gitPath = path.join(currentPath, ".git");
      if (fsSync.existsSync(gitPath)) {
        return "Yes";
      }
      currentPath = path.dirname(currentPath);
    }
    return "No";
  } catch {
    return "No";
  }
}
