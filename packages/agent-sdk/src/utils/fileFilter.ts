import * as fs from "fs";
import * as path from "path";

/**
 * Common ignore directory and file patterns
 * Can be reused by multiple tools (glob, ripgrep, etc.)
 */
export const COMMON_IGNORE_PATTERNS = {
  // Dependencies and build directories
  dependencies: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    ".nyc_output/**",
    "tmp/**",
    "temp/**",
  ],

  // Cache and temporary files
  cache: ["*.log", "*.cache", ".DS_Store", "Thumbs.db", "*~", "*.swp", "*.swo"],

  // Editor and IDE files
  editor: [".vscode/**", ".idea/**", "*.sublime-*"],

  // Operating system related
  os: [".DS_Store", "Thumbs.db", "desktop.ini"],
};

/**
 * Get flat array of all common ignore patterns
 */
export const getAllIgnorePatterns = (): string[] => {
  return [
    ...COMMON_IGNORE_PATTERNS.dependencies,
    ...COMMON_IGNORE_PATTERNS.cache,
    ...COMMON_IGNORE_PATTERNS.editor,
    ...COMMON_IGNORE_PATTERNS.os,
  ];
};

/**
 * Recursively find all .gitignore files in directory
 * @param dir Directory to search
 * @param maxDepth Maximum recursion depth to prevent too deep searches
 * @returns Array of .gitignore file paths
 */
const findAllGitignoreFiles = (dir: string, maxDepth: number = 5): string[] => {
  const gitignoreFiles: string[] = [];

  if (maxDepth <= 0) return gitignoreFiles;

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isFile() && item.name === ".gitignore") {
        gitignoreFiles.push(fullPath);
      } else if (item.isDirectory() && !shouldSkipDirectory(item.name)) {
        // Recursively search subdirectories, but skip some obviously unnecessary directories
        gitignoreFiles.push(...findAllGitignoreFiles(fullPath, maxDepth - 1));
      }
    }
  } catch {
    // Ignore permission errors and other issues
  }

  return gitignoreFiles;
};

/**
 * Determine whether to skip searching a directory
 */
const shouldSkipDirectory = (dirName: string): boolean => {
  const skipDirs = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    ".nyc_output",
    "tmp",
    "temp",
    ".cache",
  ];
  return skipDirs.includes(dirName);
};

/**
 * Parse single .gitignore file content
 * @param gitignorePath .gitignore file path
 * @param basePath Base path for calculating relative paths
 * @returns Array of parsed glob patterns
 */
const parseGitignoreFile = (
  gitignorePath: string,
  basePath: string,
): string[] => {
  const patterns: string[] = [];

  try {
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      const gitignoreDir = path.dirname(gitignorePath);
      // Calculate relative directory relative to base path
      const relativeDirFromBase = path.relative(basePath, gitignoreDir);

      const lines = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      for (const line of lines) {
        // Skip negation rules (starting with !)
        if (line.startsWith("!")) {
          continue;
        }

        let pattern = line;

        // Handle patterns starting with / (relative to current .gitignore file directory)
        if (pattern.startsWith("/")) {
          pattern = pattern.slice(1); // Remove leading /
        }

        // If .gitignore is in subdirectory, need to add path prefix
        if (relativeDirFromBase && relativeDirFromBase !== ".") {
          pattern = path.posix.join(relativeDirFromBase, pattern);
        }

        // If directory pattern (ending with /)
        if (pattern.endsWith("/")) {
          const dirName = pattern.slice(0, -1);
          // For directory patterns, add both exact match and wildcard match
          patterns.push(`${dirName}/**`); // Directory and all its sub-content
          // If no path separators, it's a simple directory name, add global match
          if (!dirName.includes("/") && !dirName.includes("*")) {
            patterns.push(`**/${dirName}/**`); // Match directories of same name at any level
          }
        } else {
          // File pattern
          patterns.push(pattern);
          // If no wildcards and no extension, also treat as directory
          if (!pattern.includes("*") && !pattern.includes(".")) {
            patterns.push(`${pattern}/**`);
            // Also add global match for simple directory names
            if (!pattern.includes("/")) {
              patterns.push(`**/${pattern}/**`);
            }
          }
        }
      }
    }
  } catch {
    // Ignore errors when reading .gitignore files
  }

  return patterns;
};

/**
 * Parse all .gitignore files in the working directory and its subdirectories and convert to glob patterns
 * @param workdir Working directory
 * @returns Array of glob ignore patterns
 */
export const parseGitignoreToGlob = (workdir: string): string[] => {
  const patterns: string[] = [];

  try {
    // Find all .gitignore files
    const gitignoreFiles = findAllGitignoreFiles(workdir);

    // Parse each .gitignore file
    for (const gitignoreFile of gitignoreFiles) {
      patterns.push(...parseGitignoreFile(gitignoreFile, workdir));
    }
  } catch {
    // Ignore errors during search process
  }

  return patterns;
};

/**
 * Get ignore patterns for glob search
 * @param workdir Working directory for resolving .gitignore files
 */
export const getGlobIgnorePatterns = (workdir?: string): string[] => {
  const patterns = getAllIgnorePatterns();

  // If working directory is provided, parse .gitignore files
  if (workdir) {
    patterns.push(...parseGitignoreToGlob(workdir));
  }

  return patterns;
};
