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
