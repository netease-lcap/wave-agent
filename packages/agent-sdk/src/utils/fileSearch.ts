import fuzzysort from "fuzzysort";
import type { FileItem } from "../types/fileSearch.js";
import { logger } from "./globalLogger.js";
import {
  deriveDirectories,
  getAllFiles,
  getFileIndex,
  defaultListing,
  queryIndex,
} from "./fileIndex.js";

/**
 * Search files and directories by name.
 *
 * Answers from the workspace index when one is available (see `fileIndex.ts`);
 * falls back to the per-request implementation below when the workspace is too
 * large to index. Both paths return the same shape, so callers never branch.
 */
export const searchFiles = async (
  query: string,
  options?: {
    maxResults?: number;
    workingDirectory?: string;
  },
): Promise<FileItem[]> => {
  const { maxResults = 100, workingDirectory = process.cwd() } = options || {};

  try {
    const index = await getFileIndex(workingDirectory);
    if (index) {
      return query.trim()
        ? queryIndex(index, query, maxResults)
        : defaultListing(index, maxResults);
    }
    return await searchFilesWithoutIndex(query, {
      maxResults,
      workingDirectory,
    });
  } catch (error) {
    logger.error("Fuzzy search error:", error);
    return [];
  }
};

/**
 * The pre-index implementation, kept as the oversize fallback: enumerate every
 * path, derive every directory, fuzzy-score everything, keep `maxResults`.
 */
async function searchFilesWithoutIndex(
  query: string,
  options: { maxResults: number; workingDirectory: string },
): Promise<FileItem[]> {
  const { maxResults, workingDirectory } = options;

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
}
