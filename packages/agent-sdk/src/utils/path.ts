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
 * Binary file extension list
 */
export const binaryExtensions = [
  // Image files
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "svg",
  "sketch",
  // Audio files
  "mp3",
  "wav",
  "ogg",
  "aac",
  // Video files
  "mp4",
  "webm",
  "avi",
  "mov",
  // Document files
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  // Compressed files
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  // Font files
  "ttf",
  "otf",
  "woff",
  "woff2",
  "eot",
  // Other binary files
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
] as const;
/**
 * Check if a file is a binary file
 * @param filename File name
 * @returns Whether it is a binary file
 */
export const isBinary = (filename: string): boolean => {
  const parts = filename.split(".");
  const ext = parts.length > 1 ? parts.pop()?.toLowerCase() || "" : "";
  return binaryExtensions.includes(ext as (typeof binaryExtensions)[number]);
};

/**
 * Get relative path for display, use relative path if shorter and not in parent directory
 * @param filePath Absolute path
 * @param workdir Working directory
 * @returns Path for display (relative or absolute)
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
      return relativePath;
    }
  } catch {
    // If calculating the relative path fails, keep the original path
  }
  return filePath;
}
