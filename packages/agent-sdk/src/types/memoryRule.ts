/**
 * Metadata extracted from the YAML frontmatter of a memory rule file.
 */
export interface MemoryRuleMetadata {
  /**
   * Glob patterns that determine when this rule is active.
   * If undefined or empty, the rule is always active.
   */
  paths?: string[];
  /**
   * Optional priority override.
   * Higher numbers take precedence if there are conflicting instructions.
   */
  priority?: number;
}

/**
 * Represents a single memory rule discovered from the filesystem.
 */
export interface MemoryRule {
  /** Unique identifier, typically the relative path from the rules root */
  id: string;
  /** The raw content of the markdown file (excluding frontmatter) */
  content: string;
  /** Metadata parsed from YAML frontmatter */
  metadata: MemoryRuleMetadata;
  /** Source of the rule (project-level or user-level) */
  source: "project" | "user";
  /** Absolute path to the file on disk */
  filePath: string;
}
