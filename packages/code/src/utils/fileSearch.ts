import { glob } from "glob";
import { getGlobIgnorePatterns } from "wave-agent-sdk";
import * as fs from "fs";
import * as path from "path";

export interface FileItem {
  path: string;
  type: "file" | "directory";
}

/**
 * Check if path is a directory
 */
export const isDirectory = (filePath: string): boolean => {
  try {
    const fullPath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);
    return fs.statSync(fullPath).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Convert string paths to FileItem objects
 */
export const convertToFileItems = (paths: string[]): FileItem[] => {
  return paths.map((filePath) => ({
    path: filePath,
    type: isDirectory(filePath) ? "directory" : "file",
  }));
};

/**
 * Search files and directories using glob patterns
 */
export const searchFiles = async (
  query: string,
  options?: {
    maxResults?: number;
    workingDirectory?: string;
  },
): Promise<FileItem[]> => {
  const { maxResults = 10, workingDirectory = process.cwd() } = options || {};

  try {
    let files: string[] = [];
    let directories: string[] = [];

    const globOptions = {
      ignore: getGlobIgnorePatterns(workingDirectory),
      maxDepth: 10,
      nocase: true, // Case insensitive
      dot: true, // Include hidden files and directories
      cwd: workingDirectory, // Specify search root directory
    };

    if (!query.trim()) {
      // When query is empty, show some common file types and directories
      const commonPatterns = [
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.json",
      ];

      // Search files
      const filePromises = commonPatterns.map((pattern) =>
        glob(pattern, { ...globOptions, nodir: true }),
      );

      // Search directories (only search first level to avoid too many results)
      const dirPromises = [glob("*/", { ...globOptions, maxDepth: 1 })];

      const fileResults = await Promise.all(filePromises);
      const dirResults = await Promise.all(dirPromises);

      files = fileResults.flat();
      directories = dirResults.flat().map((dir) => {
        // glob returns string type paths, remove trailing slash
        return String(dir).replace(/\/$/, "");
      });
    } else {
      // Build multiple glob patterns to support more flexible search
      const filePatterns = [
        // Match files with filenames containing query
        `**/*${query}*`,
        // Match files with query in path (match directory names)
        `**/${query}*/**/*`,
      ];

      const dirPatterns = [
        // Match directory names containing query
        `**/*${query}*/`,
        // Match directories containing query in path
        `**/${query}*/`,
      ];

      // Search files
      const filePromises = filePatterns.map((pattern) =>
        glob(pattern, { ...globOptions, nodir: true }),
      );

      // Search directories
      const dirPromises = dirPatterns.map((pattern) =>
        glob(pattern, { ...globOptions, nodir: false }),
      );

      const fileResults = await Promise.all(filePromises);
      const dirResults = await Promise.all(dirPromises);

      files = fileResults.flat();
      directories = dirResults.flat().map((dir) => {
        // glob returns string type paths, remove trailing slash
        return String(dir).replace(/\/$/, "");
      });
    }

    // Deduplicate and merge files and directories
    const uniqueFiles = Array.from(new Set(files));
    const uniqueDirectories = Array.from(new Set(directories));
    const allPaths = [...uniqueDirectories, ...uniqueFiles]; // Directories first

    // Limit to maximum results and convert to FileItem
    const fileItems = convertToFileItems(allPaths.slice(0, maxResults));
    return fileItems;
  } catch (error) {
    console.error("Glob search error:", error);
    return [];
  }
};
