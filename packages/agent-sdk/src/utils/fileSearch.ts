import { spawn } from "child_process";
import { rgPath } from "@vscode/ripgrep";
import fuzzysort from "fuzzysort";
import { getAllIgnorePatterns } from "./fileFilter.js";
import type { FileItem } from "../types/fileSearch.js";
import { logger } from "./globalLogger.js";

/**
 * Execute ripgrep to get all file paths
 */
async function getAllFiles(workingDirectory: string): Promise<string[]> {
  if (!rgPath) {
    throw new Error("ripgrep is not available");
  }

  const ignorePatterns = getAllIgnorePatterns();
  const rgArgs = ["--files", "--color=never", "--hidden"];
  for (const pattern of ignorePatterns) {
    rgArgs.push("--glob", `!${pattern}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(rgPath, rgArgs, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(`ripgrep failed: ${stderr}`));
        return;
      }
      const files = stdout
        .trim()
        .split("\n")
        .filter((f) => f.length > 0)
        .map((f) => f.replace(/\\/g, "/")); // Normalize to forward slashes
      resolve(files);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Derive directory paths from file paths
 */
function deriveDirectories(files: string[]): string[] {
  const dirs = new Set<string>();
  for (const file of files) {
    const parts = file.split("/");
    // Add all parent directories
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") + "/";
      dirs.add(dir);
    }
  }
  return Array.from(dirs);
}

/**
 * Search files and directories using fuzzy matching
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
    const files = await getAllFiles(workingDirectory);

    if (!query.trim()) {
      // When query is empty, show some common file types and top-level directories
      const commonExtensions = new Set([
        "ts",
        "tsx",
        "js",
        "jsx",
        "json",
        "py",
        "java",
      ]);
      const results: FileItem[] = [];
      const seenDirs = new Set<string>();

      for (const file of files) {
        const parts = file.split("/");
        if (parts.length > 1) {
          const topDir = parts[0] + "/";
          if (!seenDirs.has(topDir)) {
            seenDirs.add(topDir);
            results.push({ path: topDir, type: "directory" });
          }
        }

        const ext = file.split(".").pop();
        if (ext && commonExtensions.has(ext)) {
          results.push({ path: file, type: "file" });
        }
      }

      // Sort: directories first, then files, then alphabetically
      return results
        .sort((a, b) => {
          if (a.type === "directory" && b.type === "file") return -1;
          if (a.type === "file" && b.type === "directory") return 1;
          return a.path.localeCompare(b.path);
        })
        .slice(0, maxResults);
    }

    const directories = deriveDirectories(files);
    const allItems: FileItem[] = [
      ...files.map((f) => ({ path: f, type: "file" as const })),
      ...directories.map((d) => ({ path: d, type: "directory" as const })),
    ];

    const fuzzyResults = fuzzysort.go(query, allItems, {
      key: "path",
      limit: maxResults,
      threshold: 0,
    });

    return fuzzyResults.map((res) => res.obj);
  } catch (error) {
    logger.error("Fuzzy search error:", error);
    return [];
  }
};
