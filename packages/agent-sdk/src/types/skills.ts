/**
 * Skill system types and constants
 * Dependencies: Core (Logger)
 */

export interface SkillMetadata {
  name: string;
  description: string;
  type: "personal" | "project" | "builtin";
  /**
   * Path to the skill **directory** (the folder containing SKILL.md), never
   * to SKILL.md itself. Directory-level contract — all consumers rely on it:
   * - `SkillManager.prepareSkillContent` injects this value for
   *   `${WAVE_SKILL_DIR}` / `${CLAUDE_SKILL_DIR}` substitutions and reports it
   *   as the "Base directory for this skill";
   * - `SkillManager.deleteSkill` removes this path with `rm(recursive)`.
   * Callers that need the file itself must `join(skillPath, "SKILL.md")`
   * (misreading this as the file path broke the desktop "Edit" action,
   * bug 3466438649392128).
   */
  skillPath: string;
  allowedTools?: string[];
  context?: "fork";
  agent?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  pluginName?: string;
  pluginRoot?: string;
}

export interface Skill extends SkillMetadata {
  content: string;
  frontmatter: SkillFrontmatter;
  isValid: boolean;
  errors: string[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  "allowed-tools"?: string | string[];
  context?: "fork";
  agent?: string;
  model?: string;
  "disable-model-invocation"?: boolean | string;
  "user-invocable"?: boolean | string;
  [key: string]: unknown;
}

export interface SkillCollection {
  type: "personal" | "project" | "builtin";
  basePath: string;
  skills: Map<string, SkillMetadata>;
  errors: SkillError[];
}

export interface SkillError {
  skillPath: string;
  message: string;
}

export interface SkillValidationResult {
  isValid: boolean;
  skill?: Skill;
  errors: string[];
}

export interface SkillDiscoveryResult {
  personalSkills: Map<string, SkillMetadata>;
  projectSkills: Map<string, SkillMetadata>;
  builtinSkills: Map<string, SkillMetadata>;
  errors: SkillError[];
}

export interface SkillInvocationContext {
  skillName: string;
}

export interface SkillToolArgs {
  skill_name: string;
  args?: string;
}

export interface SkillManagerOptions {
  personalSkillsPath?: string;
  personalClaudeSkillsPath?: string;
  personalAgentsSkillsPath?: string;
  scanTimeout?: number;
  workdir?: string;
  watch?: boolean;
}

export interface ParsedSkillFile {
  frontmatter: SkillFrontmatter;
  content: string;
  skillMetadata: SkillMetadata;
  validationErrors: string[];
  isValid: boolean;
}

export interface SkillParseOptions {
  validateMetadata?: boolean;
  basePath?: string;
}

export const SKILL_DEFAULTS = {
  PERSONAL_SKILLS_DIR: ".wave/skills",
  PROJECT_SKILLS_DIR: ".wave/skills",
  SKILL_FILE_NAME: "SKILL.md",
  MAX_NAME_LENGTH: 64,
  MIN_DESCRIPTION_LENGTH: 1,
  NAME_PATTERN: /^[a-z0-9-]+$/,
  MAX_METADATA_CACHE: 1000,
  MAX_CONTENT_CACHE: 100,
  SCAN_TIMEOUT: 5000,
  LOAD_TIMEOUT: 2000,
} as const;
