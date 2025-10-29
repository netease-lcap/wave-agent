import type { ChildProcess } from "child_process";

/**
 * Logger interface definition
 * Compatible with OpenAI package Logger interface
 */
export interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
}

export type MessageBlock =
  | TextBlock
  | ErrorBlock
  | ToolBlock
  | ImageBlock
  | DiffBlock
  | CommandOutputBlock
  | CompressBlock
  | MemoryBlock
  | CustomCommandBlock;

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ErrorBlock {
  type: "error";
  content: string;
}

export interface ToolBlock {
  type: "tool";
  parameters?: string;
  result?: string;
  shortResult?: string; // Add shortResult field
  images?: Array<{
    // Add image data support
    data: string; // Base64 encoded image data
    mediaType?: string; // Media type of the image
  }>;
  id?: string;
  name?: string;
  isRunning?: boolean; // Mark if tool is actually executing
  success?: boolean;
  error?: string | Error;
  compactParams?: string; // Compact parameter display
}

export interface ImageBlock {
  type: "image";
  imageUrls?: string[];
}

export interface DiffBlock {
  type: "diff";
  path: string;
  diffResult: Array<{
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
}

export interface CommandOutputBlock {
  type: "command_output";
  command: string;
  output: string;
  isRunning: boolean;
  exitCode: number | null;
}

export interface CompressBlock {
  type: "compress";
  content: string;
}

export interface MemoryBlock {
  type: "memory";
  content: string;
  isSuccess: boolean;
  memoryType?: "project" | "user"; // Memory type
  storagePath?: string; // Storage path text
}

export interface CustomCommandBlock {
  type: "custom_command";
  commandName: string;
  content: string; // Complete command content, used when passing to AI
  originalInput?: string; // Original user input, used for UI display (e.g., "/fix-issue 123 high")
}

export interface AIRequest {
  content: string;
  files: unknown[];
}

export interface AIResponse {
  content: string;
  status: "success" | "error";
  error?: string;
}

// MCP related types
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  config: McpServerConfig;
  status: "disconnected" | "connected" | "connecting" | "error";
  tools?: McpTool[];
  toolCount?: number;
  capabilities?: string[];
  lastConnected?: number;
  error?: string;
}

// Background bash shell related types
export interface BackgroundShell {
  id: string;
  process: ChildProcess;
  command: string;
  startTime: number;
  status: "running" | "completed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
}

// Slash Command related types
export interface SlashCommand {
  id: string;
  name: string;
  description: string;
  handler: (args?: string) => Promise<void> | void;
}

export interface CustomSlashCommandConfig {
  allowedTools?: string[];
  model?: string;
  description?: string;
}

export interface CustomSlashCommand {
  id: string;
  name: string;
  description?: string; // Add description field
  filePath: string;
  content: string;
  config?: CustomSlashCommandConfig;
}

// Skill related types
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

// Configuration types for Agent Constructor Configuration feature
export interface GatewayConfig {
  apiKey: string;
  baseURL: string;
}

export interface ModelConfig {
  agentModel: string;
  fastModel: string;
}

export interface ConfigurationResolver {
  /**
   * Resolves gateway configuration from constructor args and environment
   * @param apiKey - API key from constructor (optional)
   * @param baseURL - Base URL from constructor (optional)
   * @returns Resolved gateway configuration
   * @throws Error if required configuration is missing after fallbacks
   */
  resolveGatewayConfig(apiKey?: string, baseURL?: string): GatewayConfig;

  /**
   * Resolves model configuration with fallbacks
   * @param agentModel - Agent model from constructor (optional)
   * @param fastModel - Fast model from constructor (optional)
   * @returns Resolved model configuration with defaults
   */
  resolveModelConfig(agentModel?: string, fastModel?: string): ModelConfig;

  /**
   * Resolves token limit with fallbacks
   * @param constructorLimit - Token limit from constructor (optional)
   * @returns Resolved token limit
   */
  resolveTokenLimit(constructorLimit?: number): number;
}

export interface ConfigurationValidator {
  /**
   * Validates gateway configuration
   * @param config - Configuration to validate
   * @throws Error with descriptive message if invalid
   */
  validateGatewayConfig(config: GatewayConfig): void;

  /**
   * Validates token limit value
   * @param tokenLimit - Token limit to validate
   * @throws Error if invalid
   */
  validateTokenLimit(tokenLimit: number): void;
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly provided?: unknown,
  ) {
    super(message);
    this.name = "ConfigurationError";
  }
}

// Standard error messages
export const CONFIG_ERRORS = {
  MISSING_API_KEY:
    "Gateway configuration requires apiKey. Provide via constructor or AIGW_TOKEN environment variable.",
  MISSING_BASE_URL:
    "Gateway configuration requires baseURL. Provide via constructor or AIGW_URL environment variable.",
  INVALID_TOKEN_LIMIT: "Token limit must be a positive integer.",
  EMPTY_API_KEY: "API key cannot be empty string.",
  EMPTY_BASE_URL: "Base URL cannot be empty string.",
} as const;
