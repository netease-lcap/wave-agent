# TypeScript Type Definitions Contract

**Version**: 1.0.0  
**Module**: agent-sdk/src/types.ts extensions  
**Integration**: Extends existing type system

## Core Skill Types

```typescript
/**
 * Skill metadata for discovery and tool descriptions
 */
export interface SkillMetadata {
  name: string;                    // Unique skill identifier
  description: string;             // Purpose and context for AI
  type: 'personal' | 'project';   // Skill location type
  skillPath: string;               // Absolute path to skill directory
}

/**
 * Full skill definition with content
 */
export interface Skill extends SkillMetadata {
  content: string;                 // Full SKILL.md markdown content
  frontmatter: SkillFrontmatter;   // Parsed YAML metadata
  isValid: boolean;                // Whether skill passed validation
  errors: string[];                // Validation error messages
}

/**
 * YAML frontmatter structure for SKILL.md files
 */
export interface SkillFrontmatter {
  name: string;                    // Must match directory name
  description: string;             // 1-1024 characters
  [key: string]: unknown;          // Allow additional fields for future extension
}

/**
 * Skill collection for organizing by location
 */
export interface SkillCollection {
  type: 'personal' | 'project';    // Collection location type
  basePath: string;                // Root directory path
  skills: Map<string, SkillMetadata>; // Skills indexed by name
  errors: SkillError[];            // Collection-level errors
}

/**
 * Skill-related error information
 */
export interface SkillError {
  skillPath: string;               // Path where error occurred
  message: string;                 // Human-readable error description
}

/**
 * Skill validation result
 */
export interface SkillValidationResult {
  isValid: boolean;                // Overall validation status
  skill?: Skill;                   // Valid skill if successful
  errors: string[];                // Validation error messages
}

/**
 * Skill discovery result
 */
export interface SkillDiscoveryResult {
  personalSkills: Map<string, SkillMetadata>; // Personal skills found
  projectSkills: Map<string, SkillMetadata>;  // Project skills found
  errors: SkillError[];            // Discovery errors
}

/**
 * Skill invocation context
 */
export interface SkillInvocationContext {
  skillName: string;               // Name of skill being invoked
}

/**
 * Skill tool execution arguments
 */
export interface SkillToolArgs {
  skill_name: string;              // Required: name of skill to invoke
}
```

## Manager Interface Types

```typescript
/**
 * Skill manager configuration options
 */
export interface SkillManagerOptions {
  personalSkillsPath?: string;     // Override default ~/.wave/skills/
  maxMetadataCache?: number;       // Maximum skills in metadata cache
  maxContentCache?: number;        // Maximum skills in content cache
  scanTimeout?: number;            // Timeout for directory scans (ms)
  logger?: Logger;                 // Optional logger instance
}

/**
 * Skill manager interface
 */
export interface ISkillManager {
  // Core methods
  initialize(): Promise<void>;
  getAvailableSkills(): SkillMetadata[];
  loadSkill(skillName: string): Promise<Skill | null>;
}
```

## Parser Types

```typescript
/**
 * Dedicated skill file parsing result
 */
export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;   // Parsed YAML frontmatter
  content: string;                 // Full markdown content including frontmatter
  skillMetadata: SkillMetadata;    // Extracted skill metadata
  validationErrors: string[];      // Validation error messages
  isValid: boolean;                // Whether parsing and validation succeeded
}

/**
 * Skill parsing options
 */
export interface SkillParseOptions {
  validateMetadata?: boolean;      // Whether to validate metadata (default: true)
  basePath?: string;               // Base path for relative file resolution
}
```

## Tool System Integration Types

```typescript
/**
 * Tool registration result
 */
export interface SkillToolRegistration {
  success: boolean;                // Whether registration succeeded
  toolName: string;                // Registered tool name
  skillCount: number;              // Number of skills discovered
  errors: string[];                // Registration errors
}
```

## Utility Types

```typescript
/**
 * Path resolution utilities
 */
export interface SkillPathResolver {
  resolvePersonalSkillsPath(): string;      // Resolve ~/.wave/skills/
  resolveProjectSkillsPath(workdir: string): string; // Resolve .wave/skills/
  resolveSkillPath(basePath: string, skillName: string): string;
}

/**
 * Skill name validation
 */
export interface SkillNameValidator {
  isValidName(name: string): boolean;
  validateName(name: string): SkillValidationResult;
  suggestValidName(invalidName: string): string[];
}
```

## Constants and Defaults

```typescript
/**
 * Default configuration values
 */
export const SKILL_DEFAULTS = {
  PERSONAL_SKILLS_DIR: '.wave/skills',     // Relative to home directory
  PROJECT_SKILLS_DIR: '.wave/skills',      // Relative to working directory
  SKILL_FILE_NAME: 'SKILL.md',            // Required skill file name
  MAX_NAME_LENGTH: 64,                     // Maximum skill name length
  MAX_DESCRIPTION_LENGTH: 1024,            // Maximum description length
  MIN_DESCRIPTION_LENGTH: 1,               // Minimum description length
  NAME_PATTERN: /^[a-z0-9-]+$/,           // Valid name pattern
  MAX_METADATA_CACHE: 1000,               // Default metadata cache size
  MAX_CONTENT_CACHE: 100,                  // Default content cache size
  SCAN_TIMEOUT: 5000,                      // Default scan timeout (ms)
  LOAD_TIMEOUT: 2000,                      // Default load timeout (ms)
} as const;
```