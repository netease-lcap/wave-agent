/**
 * Path encoding utility interface
 * Handles cross-platform directory name encoding for working directories
 */

import { ProjectDirectory } from './session-interfaces.js';

/**
 * Path encoder interface for converting working directory paths to filesystem-safe names
 */
export interface IPathEncoder {
  /**
   * Encode a working directory path to a filesystem-safe directory name
   * @param originalPath Original working directory path
   * @param options Encoding configuration options
   * @returns Encoded directory name
   * @throws Error if path cannot be encoded safely
   */
  encode(originalPath: string, options?: PathEncodingOptions): Promise<string>;
  
  /**
   * Decode an encoded directory name back to original path (if mapping exists)
   * @param encodedName Encoded directory name
   * @returns Original path or null if no mapping exists
   */
  decode(encodedName: string): Promise<string | null>;
  
  /**
   * Resolve symbolic links and normalize path before encoding
   * @param path Path that may contain symbolic links
   * @returns Resolved absolute path
   * @throws Error if path cannot be resolved
   */
  resolvePath(path: string): Promise<string>;
  
  /**
   * Create project directory entity from original path
   * @param originalPath Working directory path
   * @param baseSessionDir Base session directory (e.g., ~/.wave/projects)
   * @returns Project directory entity with encoding details
   */
  createProjectDirectory(originalPath: string, baseSessionDir: string): Promise<ProjectDirectory>;
  
  /**
   * Validate that an encoded name is filesystem-safe
   * @param encodedName Encoded directory name to validate
   * @returns true if name is safe for filesystem use
   */
  validateEncodedName(encodedName: string): boolean;
  
  /**
   * Handle encoding collisions by generating unique names
   * @param baseName Base encoded name that has collision
   * @param existingNames Set of existing encoded names
   * @returns Unique encoded name with collision resolution
   */
  resolveCollision(baseName: string, existingNames: Set<string>): string;
}

/**
 * Path encoding configuration options
 */
export interface PathEncodingOptions {
  // Length constraints
  maxLength?: number; // Default: 200 characters
  truncateStrategy?: 'hash' | 'counter' | 'smart'; // Default: 'smart'
  
  // Character replacement
  pathSeparatorReplacement?: string; // Default: '-'
  spaceReplacement?: string; // Default: '_'
  invalidCharReplacement?: string; // Default: '_'
  
  // Case handling
  preserveCase?: boolean; // Default: false (convert to lowercase)
  
  // Collision handling
  collisionStrategy?: 'counter' | 'hash' | 'timestamp'; // Default: 'hash'
  hashLength?: number; // Default: 8 characters
  
  // Platform-specific
  targetPlatform?: 'windows' | 'macos' | 'linux' | 'auto'; // Default: 'auto'
}

/**
 * Path encoder factory interface
 */
export interface IPathEncoderFactory {
  /**
   * Create path encoder instance
   * @param options Encoder configuration
   * @returns Configured path encoder
   */
  create(options?: PathEncodingOptions): IPathEncoder;
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
  readonly errors: PathValidationError[];
  readonly warnings: string[];
  readonly suggestedFix?: string;
}

/**
 * Path validation error types
 */
export interface PathValidationError {
  readonly type: 'INVALID_CHARACTERS' | 'TOO_LONG' | 'RESERVED_NAME' | 'EMPTY_PATH' | 'RELATIVE_PATH';
  readonly message: string;
  readonly position?: number;
  readonly character?: string;
}

/**
 * Encoding strategy interface for different approaches
 */
export interface IEncodingStrategy {
  /**
   * Apply encoding strategy to path
   * @param path Path to encode
   * @param constraints Platform constraints
   * @returns Encoded path
   */
  encode(path: string, constraints: FilesystemConstraints): string;
  
  /**
   * Check if strategy can handle the given path
   * @param path Path to check
   * @returns true if strategy can encode this path
   */
  canHandle(path: string): boolean;
}

/**
 * Built-in encoding strategies
 */
export type EncodingStrategyType = 'conservative' | 'aggressive' | 'unicode-aware' | 'hash-only';

/**
 * Path encoder utilities
 */
export interface IPathEncoderUtils {
  /**
   * Get platform-specific filesystem constraints
   * @param platform Target platform or 'auto' for current
   * @returns Filesystem constraints for platform
   */
  getFilesystemConstraints(platform?: string): FilesystemConstraints;
  
  /**
   * Detect current platform
   * @returns Platform identifier
   */
  detectPlatform(): 'windows' | 'macos' | 'linux';
  
  /**
   * Validate path against platform constraints
   * @param path Path to validate
   * @param constraints Platform constraints
   * @returns Validation result with errors and suggestions
   */
  validatePath(path: string, constraints: FilesystemConstraints): PathValidationResult;
  
  /**
   * Generate hash for collision resolution
   * @param input Input string to hash
   * @param length Desired hash length
   * @returns Hash string
   */
  generateHash(input: string, length: number): string;
  
  /**
   * Expand tilde (~) to home directory
   * @param path Path that may contain tilde
   * @returns Expanded path
   */
  expandTilde(path: string): string;
}