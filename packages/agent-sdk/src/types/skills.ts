/**
 * Skill system types and constants
 * Dependencies: Core (Logger)
 */

import type { Logger } from "./core.js";

export interface SkillMetadata {
  name: string;
  description: string;
  type: "personal" | "project";
  skillPath: string;
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
  [key: string]: unknown;
}

export interface SkillCollection {
  type: "personal" | "project";
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
  errors: SkillError[];
}

export interface SkillInvocationContext {
  skillName: string;
}

export interface SkillToolArgs {
  skill_name: string;
}

export interface SkillManagerOptions {
  personalSkillsPath?: string;
  scanTimeout?: number;
  logger?: Logger;
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
  MAX_DESCRIPTION_LENGTH: 1024,
  MIN_DESCRIPTION_LENGTH: 1,
  NAME_PATTERN: /^[a-z0-9-]+$/,
  MAX_METADATA_CACHE: 1000,
  MAX_CONTENT_CACHE: 100,
  SCAN_TIMEOUT: 5000,
  LOAD_TIMEOUT: 2000,
} as const;
