import { glob, type Path } from "glob";
import { getGlobIgnorePatterns } from "wave-agent-sdk";

export interface FileItem {
  path: string;
  type: "file" | "directory";
}

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

    if (!query.trim()) {
      // When query is empty, show some common file types and directories
      const commonPatterns = [
        "**/*.ts",
        "**/*.tsx",
        "**/*.js",
        "**/*.jsx",
        "**/*.json",
      ];

      // Search files with nodir: true to get only files
      const filePromises = commonPatterns.map((pattern) =>
        glob(pattern, {
          ...globOptions,
          nodir: true,
        } as import("glob").GlobOptionsWithFileTypesTrue),
      );

      // Search directories (only search first level to avoid too many results)
      const dirPromises = [
        glob("*/", {
          ...globOptions,
          maxDepth: 1,
          nodir: false,
        } as import("glob").GlobOptionsWithFileTypesTrue),
      ];

      const fileResults = await Promise.all(filePromises);
      const dirResults = await Promise.all(dirPromises);

      // Flatten all Path objects
      const allPaths: Path[] = [
        ...(dirResults.flat() as Path[]),
        ...(fileResults.flat() as Path[]),
      ];

      // Convert to FileItems
      const fileItems = convertPathsToFileItems(allPaths.slice(0, maxResults));
      return fileItems;
    } else {
      // Build multiple glob patterns to support more flexible search
      const patterns = [
        // Match files with filenames containing query
        `**/*${query}*`,
        // Match files with query in path (match directory names)
        `**/${query}*/**/*`,
        // Match directory names containing query
        `**/*${query}*/`,
        // Match directories containing query in path
        `**/${query}*/`,
      ];

      // Search with all patterns
      const searchPromises = patterns.map((pattern) =>
        glob(pattern, globOptions),
      );

      const results = await Promise.all(searchPromises);

      // Flatten all Path objects and deduplicate by relative path
      const pathMap = new Map<string, Path>();
      (results.flat() as Path[]).forEach((pathObj) => {
        const relativePath = pathObj.relative();
        if (!pathMap.has(relativePath)) {
          pathMap.set(relativePath, pathObj);
        }
      });

      // Convert to array and sort: directories first, then files
      const allPaths: Path[] = Array.from(pathMap.values());
      allPaths.sort((a, b) => {
        const aIsDir = a.isDirectory();
        const bIsDir = b.isDirectory();
        if (aIsDir && !bIsDir) return -1;
        if (!aIsDir && bIsDir) return 1;
        return a.relative().localeCompare(b.relative());
      });

      // Convert to FileItems
      const fileItems = convertPathsToFileItems(allPaths.slice(0, maxResults));
      return fileItems;
    }
  } catch (error) {
    console.error("Glob search error:", error);
    return [];
  }
};
