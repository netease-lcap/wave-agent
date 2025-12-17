import { globIterate, type Path } from "glob";
import { getGlobIgnorePatterns } from "./fileFilter.js";
import type { FileItem } from "../types/fileSearch.js";

/**
 * Convert Path objects to FileItem objects
 */
export const convertPathsToFileItems = (paths: Path[]): FileItem[] => {
  return paths.map((pathObj) => ({
    path: pathObj.relative(),
    type: pathObj.isDirectory() ? "directory" : "file",
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
    const globOptions: import("glob").GlobOptionsWithFileTypesTrue = {
      ignore: getGlobIgnorePatterns(workingDirectory),
      maxDepth: 10,
      nocase: true, // Case insensitive
      dot: true, // Include hidden files and directories
      cwd: workingDirectory, // Specify search root directory
      withFileTypes: true, // Get Path objects instead of strings
    };

    // Build glob patterns based on query
    let patterns: string[] = [];

    if (!query.trim()) {
      // When query is empty, show some common file types and directories
      patterns = [
        "**/*.{ts,tsx,js,jsx,json,py,java}", // Combine common file extensions
        "*/", // First level directories
      ];
    } else {
      // Build multiple glob patterns to support more flexible search
      patterns = [
        // Match files with filenames containing query
        `**/*${query}*`,
        // Match files with query in path (match directory names)
        `**/${query}*/**/*`,
        // Match directory names containing query
        `**/*${query}*/`,
        // Match directories containing query in path
        `**/${query}*/`,
      ];
    }

    // Collect results until we reach maxResults
    const collectedPaths: Path[] = [];
    const seenPaths = new Set<string>();

    // Process each pattern sequentially
    for (const pattern of patterns) {
      if (collectedPaths.length >= maxResults) {
        break;
      }

      // Use globIterate to get results one by one
      const iterator = globIterate(pattern, globOptions) as AsyncGenerator<
        Path,
        void,
        void
      >;

      for await (const pathObj of iterator) {
        if (collectedPaths.length >= maxResults) {
          // Stop the iterator when we have enough results
          break;
        }

        const relativePath = pathObj.relative();
        if (!seenPaths.has(relativePath)) {
          seenPaths.add(relativePath);
          collectedPaths.push(pathObj);
        }
      }
    }

    // Sort collected paths: directories first, then files
    collectedPaths.sort((a, b) => {
      const aIsDir = a.isDirectory();
      const bIsDir = b.isDirectory();
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.relative().localeCompare(b.relative());
    });

    // Convert to FileItems
    const fileItems = convertPathsToFileItems(collectedPaths);
    return fileItems;
  } catch (error) {
    console.error("Glob search error:", error);
    return [];
  }
};
