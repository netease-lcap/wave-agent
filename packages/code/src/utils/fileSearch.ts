import { glob } from "fs/promises";
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
      exclude: getGlobIgnorePatterns(workingDirectory),
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
        "*/", // For directories at the first level
      ];

      files = [];
      directories = [];

      for (const pattern of commonPatterns) {
        for await (const dirent of glob(pattern, {
          ...globOptions,
          withFileTypes: true,
        })) {
          if (dirent.isFile()) {
            files.push(dirent.name);
          } else if (dirent.isDirectory()) {
            directories.push(dirent.name);
          }
        }
      }
    } else {
      // Build glob patterns to search files and directories together
      const allPatterns = [
        // Match files with filenames containing query
        `**/*${query}*`,
        // Match files with query in path (match directory names)
        `**/${query}*/**/*`,
        // Match directory names containing query
        `**/*${query}*/`,
        // Match directories containing query in path
        `**/${query}*/`,
      ];

      files = [];
      directories = [];

      // Search all patterns and separate files/directories using withFileTypes
      for (const pattern of allPatterns) {
        for await (const dirent of glob(pattern, {
          ...globOptions,
          withFileTypes: true,
        })) {
          if (dirent.isFile()) {
            files.push(dirent.name);
          } else if (dirent.isDirectory()) {
            directories.push(dirent.name);
          }
        }
      }
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
