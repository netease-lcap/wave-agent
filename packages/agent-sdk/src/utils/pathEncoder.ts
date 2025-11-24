/**
 * Path encoding utility for converting working directory paths to filesystem-safe names
 * Handles cross-platform directory name encoding for project-based session organization
 */

import { resolve, join } from "path";
import { createHash } from "crypto";
import { realpath, mkdir } from "fs/promises";
import { homedir, platform } from "os";

/**
 * Project directory information
 */
export interface ProjectDirectory {
  readonly originalPath: string;
  readonly encodedName: string;
  readonly encodedPath: string;
  readonly pathHash?: string; // For collision resolution
  readonly isSymbolicLink: boolean;
}

/**
 * Path encoding configuration options
 */
export interface PathEncodingOptions {
  maxLength?: number; // Default: 200 characters
  pathSeparatorReplacement?: string; // Default: '-'
  spaceReplacement?: string; // Default: '_'
  invalidCharReplacement?: string; // Default: '_'
  preserveCase?: boolean; // Default: false (convert to lowercase)
  hashLength?: number; // Default: 8 characters
}

/**
 * Platform-specific filesystem constraints
 */
export interface FilesystemConstraints {
  readonly maxDirectoryNameLength: number;
  readonly maxPathLength: number;
  readonly invalidCharacters: string[];
  readonly reservedNames: string[];
  readonly caseSensitive: boolean;
}

/**
 * Path validation result
 */
export interface PathValidationResult {
  readonly isValid: boolean;
  readonly errors: string[];
  readonly warnings: string[];
  readonly suggestedFix?: string;
}

/**
 * PathEncoder class for converting working directory paths to filesystem-safe names
 */
export class PathEncoder {
  private readonly options: Required<PathEncodingOptions>;
  private readonly constraints: FilesystemConstraints;

  constructor(options: PathEncodingOptions = {}) {
    this.options = {
      maxLength: options.maxLength ?? 200,
      pathSeparatorReplacement: options.pathSeparatorReplacement ?? "-",
      spaceReplacement: options.spaceReplacement ?? "_",
      invalidCharReplacement: options.invalidCharReplacement ?? "_",
      preserveCase: options.preserveCase ?? false,
      hashLength: options.hashLength ?? 8,
    };
    this.constraints = this.getFilesystemConstraints();
  }

  /**
   * Encode a working directory path to a filesystem-safe directory name
   */
  async encode(originalPath: string): Promise<string> {
    // Resolve symbolic links and normalize path
    const resolvedPath = await this.resolvePath(originalPath);
    return this.encodeSync(resolvedPath);
  }

  /**
   * Synchronously encode a path to a filesystem-safe directory name
   * Note: Does not resolve symbolic links - use encode() for full path resolution
   */
  encodeSync(pathToEncode: string): string {
    // Convert to safe directory name
    let encoded = pathToEncode;

    // Remove leading slash to avoid empty directory names
    if (encoded.startsWith("/")) {
      encoded = encoded.substring(1);
    }

    // Replace path separators with hyphens
    encoded = encoded.replace(/[/\\]/g, this.options.pathSeparatorReplacement);

    // Replace spaces with underscores
    encoded = encoded.replace(/\s+/g, this.options.spaceReplacement);

    // Replace invalid characters with underscores
    const escapedChars = this.constraints.invalidCharacters
      .map((c) => `\\${c}`)
      .join("");
    const invalidChars = new RegExp(`[${escapedChars}]`, "g");
    encoded = encoded.replace(
      invalidChars,
      this.options.invalidCharReplacement,
    );

    // Convert to lowercase unless preserveCase is true
    if (!this.options.preserveCase) {
      encoded = encoded.toLowerCase();
    }

    // Handle length limit with hash
    if (encoded.length > this.options.maxLength) {
      const hash = this.generateHash(pathToEncode, this.options.hashLength);
      const maxBaseLength =
        this.options.maxLength - this.options.hashLength - 1; // -1 for separator
      encoded = `${encoded.substring(0, maxBaseLength)}-${hash}`;
    }

    return encoded;
  }

  /**
   * Decode an encoded directory name back to original path (limited functionality)
   * Note: This is best-effort as encoding is lossy
   */
  async decode(encodedName: string): Promise<string | null> {
    return this.decodeSync(encodedName);
  }

  /**
   * Synchronously decode an encoded directory name back to original path (limited functionality)
   * Note: This is best-effort as encoding is lossy
   */
  decodeSync(encodedName: string): string | null {
    // This is a simplified version - full reversal is not always possible
    // due to lossy encoding (case changes, character replacements, hashing)

    // Check if this has a hash suffix
    const hashPattern = new RegExp(`-[a-f0-9]{${this.options.hashLength}}$`);
    if (hashPattern.test(encodedName)) {
      // Cannot reliably decode hashed paths
      return null;
    }

    // Attempt basic reversal
    let decoded = encodedName;

    // Reverse path separator replacement
    decoded = decoded.replace(
      new RegExp(this.options.pathSeparatorReplacement, "g"),
      "/",
    );

    // Reverse space replacement
    decoded = decoded.replace(
      new RegExp(this.options.spaceReplacement, "g"),
      " ",
    );

    // Add leading slash
    decoded = `/${decoded}`;

    return decoded;
  }

  /**
   * Resolve symbolic links and normalize path before encoding
   */
  async resolvePath(path: string): Promise<string> {
    try {
      // Expand tilde to home directory
      const expandedPath = this.expandTilde(path);

      // Resolve to absolute path
      const absolutePath = resolve(expandedPath);

      // Resolve symbolic links
      const resolvedPath = await realpath(absolutePath);

      return resolvedPath;
    } catch (error) {
      throw new Error(`Failed to resolve path "${path}": ${error}`);
    }
  }

  /**
   * Create project directory entity from original path
   */
  async createProjectDirectory(
    originalPath: string,
    baseSessionDir: string,
  ): Promise<ProjectDirectory> {
    // Resolve the original path and check for symbolic links
    const expandedPath = this.expandTilde(originalPath);
    const absolutePath = resolve(expandedPath);

    let resolvedPath: string;
    let isSymbolicLink = false;

    try {
      resolvedPath = await realpath(absolutePath);
      isSymbolicLink = resolvedPath !== absolutePath;
    } catch {
      // If realpath fails, use the absolute path
      resolvedPath = absolutePath;
    }

    // Encode the resolved path
    const encodedName = await this.encode(resolvedPath);
    const encodedPath = join(baseSessionDir, encodedName);

    // Generate hash if encoding resulted in truncation
    let pathHash: string | undefined;
    if (resolvedPath.length > this.options.maxLength) {
      pathHash = this.generateHash(resolvedPath, this.options.hashLength);
    }

    // Ensure the encoded directory exists
    try {
      await mkdir(encodedPath, { recursive: true });
    } catch {
      // Ignore errors if directory already exists
    }

    return {
      originalPath: resolvedPath,
      encodedName,
      encodedPath,
      pathHash,
      isSymbolicLink,
    };
  }

  /**
   * Validate that an encoded name is filesystem-safe
   */
  validateEncodedName(encodedName: string): boolean {
    // Check length
    if (encodedName.length > this.constraints.maxDirectoryNameLength) {
      return false;
    }

    // Check for invalid characters
    for (const char of this.constraints.invalidCharacters) {
      if (encodedName.includes(char)) {
        return false;
      }
    }

    // Check for reserved names
    const lowerName = encodedName.toLowerCase();
    if (
      this.constraints.reservedNames.some(
        (reserved) => reserved.toLowerCase() === lowerName,
      )
    ) {
      return false;
    }

    // Check for empty or dots-only names
    if (!encodedName.trim() || /^\.+$/.test(encodedName)) {
      return false;
    }

    return true;
  }

  /**
   * Handle encoding collisions by generating unique names
   */
  resolveCollision(baseName: string, existingNames: Set<string>): string {
    if (!existingNames.has(baseName)) {
      return baseName;
    }

    // Try numbered suffixes first
    for (let i = 1; i <= 999; i++) {
      const candidate = `${baseName}-${i}`;
      if (!existingNames.has(candidate)) {
        return candidate;
      }
    }

    // If all numbered suffixes are taken, use hash
    const hash = this.generateHash(
      baseName + Date.now(),
      this.options.hashLength,
    );
    return `${baseName}-${hash}`;
  }

  /**
   * Get platform-specific filesystem constraints
   */
  private getFilesystemConstraints(): FilesystemConstraints {
    const currentPlatform = platform();

    switch (currentPlatform) {
      case "win32":
        return {
          maxDirectoryNameLength: 255,
          maxPathLength: 260,
          invalidCharacters: ["<", ">", ":", '"', "|", "?", "*"],
          reservedNames: [
            "CON",
            "PRN",
            "AUX",
            "NUL",
            "COM1",
            "COM2",
            "COM3",
            "COM4",
            "COM5",
            "COM6",
            "COM7",
            "COM8",
            "COM9",
            "LPT1",
            "LPT2",
            "LPT3",
            "LPT4",
            "LPT5",
            "LPT6",
            "LPT7",
            "LPT8",
            "LPT9",
          ],
          caseSensitive: false,
        };
      case "darwin":
        return {
          maxDirectoryNameLength: 255,
          maxPathLength: 1024,
          invalidCharacters: [":"],
          reservedNames: [],
          caseSensitive: false, // HFS+ is case-insensitive by default
        };
      default: // Linux and other Unix-like systems
        return {
          maxDirectoryNameLength: 255,
          maxPathLength: 4096,
          invalidCharacters: ["\0"],
          reservedNames: [],
          caseSensitive: true,
        };
    }
  }

  /**
   * Generate hash for collision resolution
   */
  private generateHash(input: string, length: number): string {
    return createHash("sha256")
      .update(input)
      .digest("hex")
      .substring(0, length);
  }

  /**
   * Expand tilde (~) to home directory
   */
  private expandTilde(path: string): string {
    if (path.startsWith("~/") || path === "~") {
      return path.replace(/^~/, homedir());
    }
    return path;
  }
}

/**
 * Default PathEncoder instance
 */
export const pathEncoder = new PathEncoder();
