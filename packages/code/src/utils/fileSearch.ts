import { glob } from "fs/promises";
import { getGlobIgnorePatterns } from "wave-agent-sdk";
import * as fs from "fs";
import * as path from "path";

export interface FileItem {
  path: string;
  type: "file" | "directory";
}

/**
 * Convert a glob pattern to case-insensitive by replacing each alphabetic character
 * with a bracket expression containing both uppercase and lowercase versions.
 * Example: "*.js" becomes "*.[jJ][sS]"
 */
const makeCaseInsensitive = (pattern: string): string => {
  return pattern.replace(/[a-zA-Z]/g, (char) => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper ? char : `[${lower}${upper}]`;
  });
};

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
    ignoreCase?: boolean;
  },
): Promise<FileItem[]> => {
  const {
    maxResults = 10,
    workingDirectory = process.cwd(),
    ignoreCase = false,
  } = options || {};

  try {
    let files: string[] = [];
    let directories: string[] = [];

    const globOptions = {
      exclude: getGlobIgnorePatterns(workingDirectory),
      cwd: workingDirectory, // Specify search root directory
    };

    if (!query.trim()) {
      // When query is empty, show some common file types and directories
      let commonPatterns = [
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.json",
        "*/", // For directories at the first level
      ];

      // Apply case insensitive transformation if needed
      if (ignoreCase) {
        commonPatterns = commonPatterns.map(makeCaseInsensitive);
      }

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
      // Apply case insensitive transformation to query if needed
      const searchQuery = ignoreCase ? makeCaseInsensitive(query) : query;

      // Build glob patterns to search files and directories together
      const allPatterns = [
        // Match files with filenames containing query
        `**/*${searchQuery}*`,
        // Match files with query in path (match directory names)
        `**/${searchQuery}*/**/*`,
        // Match directory names containing query
        `**/*${searchQuery}*/`,
        // Match directories containing query in path
        `**/${searchQuery}*/`,
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
