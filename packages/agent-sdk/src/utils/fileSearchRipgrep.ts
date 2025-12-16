import { spawn } from "child_process";
import { rgPath } from "@vscode/ripgrep";
import { getGlobIgnorePatterns } from "./fileFilter.js";
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
 * Execute ripgrep with given arguments and return results
 */
const executeRipgrep = (args: string[], cwd: string): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    if (!rgPath) {
      reject(new Error("ripgrep is not available"));
      return;
    }

    const rg = spawn(rgPath, args, { cwd });
    let stdout = "";
    let stderr = "";

    rg.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    rg.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    rg.on("close", (code) => {
      if (code === 0) {
        const results = stdout
          .trim()
          .split("\n")
          .filter((line) => line.length > 0);
        resolve(results);
      } else if (code === 1) {
        // ripgrep returns 1 when no matches found, which is normal
        resolve([]);
      } else {
        reject(new Error(`ripgrep failed with code ${code}: ${stderr}`));
      }
    });

    rg.on("error", (error) => {
      reject(error);
    });
  });
};

/**
 * Search files and directories using ripgrep with --files flag
 * This is more efficient for file listing than using glob patterns with content search
 */
export const searchFilesRipgrep = async (
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
    const allFiles: string[] = [];

    if (!query.trim()) {
      // When query is empty, show some common file types
      const commonPatterns = ["*.ts", "*.tsx", "*.js", "*.jsx", "*.json"];

      for (const pattern of commonPatterns) {
        const rgArgs = ["--files", "--color=never"];

        if (ignoreCase) {
          rgArgs.push("--iglob", pattern);
        } else {
          rgArgs.push("--glob", pattern);
        }

        // Add ignore patterns
        const ignorePatterns = getGlobIgnorePatterns(workingDirectory);
        for (const exclude of ignorePatterns) {
          rgArgs.push("--glob", `!${exclude}`);
        }

        try {
          const results = await executeRipgrep(rgArgs, workingDirectory);
          allFiles.push(...results);
        } catch {
          // Continue with other patterns even if one fails
          console.warn(`Failed to search pattern ${pattern}`);
        }
      }

      // Also search for directories (first level only to avoid too many results)
      try {
        const dirArgs = ["--files", "--color=never", "--glob", "*/"];
        const ignorePatterns = getGlobIgnorePatterns(workingDirectory);
        for (const exclude of ignorePatterns) {
          dirArgs.push("--glob", `!${exclude}`);
        }

        const dirResults = await executeRipgrep(dirArgs, workingDirectory);
        allFiles.push(...dirResults);
      } catch {
        // Directory search is optional
      }
    } else {
      // Build patterns to search files and directories
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

      for (const pattern of patterns) {
        const rgArgs = ["--files", "--color=never"];

        if (ignoreCase) {
          rgArgs.push("--iglob", pattern);
        } else {
          rgArgs.push("--glob", pattern);
        }

        // Add ignore patterns
        const ignorePatterns = getGlobIgnorePatterns(workingDirectory);
        for (const exclude of ignorePatterns) {
          rgArgs.push("--glob", `!${exclude}`);
        }

        try {
          const results = await executeRipgrep(rgArgs, workingDirectory);
          allFiles.push(...results);
        } catch {
          // Continue with other patterns
        }
      }
    }

    // Deduplicate files
    const uniqueFiles = Array.from(new Set(allFiles));

    // Sort by modification time (most recent first)
    const filesWithStats = await Promise.allSettled(
      uniqueFiles.map(async (file) => {
        try {
          const fullPath = path.isAbsolute(file)
            ? file
            : path.join(workingDirectory, file);
          const stats = await fs.promises.stat(fullPath);
          return {
            path: file,
            mtime: stats.mtime,
          };
        } catch {
          // If unable to get file stats, use current time
          return {
            path: file,
            mtime: new Date(),
          };
        }
      }),
    );

    // Filter successful results and sort by modification time
    const sortedFiles = filesWithStats
      .filter((result) => result.status === "fulfilled")
      .map(
        (result) =>
          (result as PromiseFulfilledResult<{ path: string; mtime: Date }>)
            .value,
      )
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Most recently modified files first
      .map((item) => item.path);

    // Limit to maximum results and convert to FileItem
    const fileItems = convertToFileItems(sortedFiles.slice(0, maxResults));
    return fileItems;
  } catch (error) {
    console.error("Ripgrep file search error:", error);
    return [];
  }
};
