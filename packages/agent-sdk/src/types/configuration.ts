/**
 * Configuration Management Types
 *
 * Types for centralized configuration loading and validation services.
 * These support the refactored configuration architecture that separates
 * configuration management from hook execution.
 */

import type { HookEvent, HookEventConfig } from "./hooks.js";
import type { PermissionMode } from "./permissions.js";
import type { ModelConfig } from "./config.js";
import type { MarketplaceSource } from "./marketplace.js";
import type { TelemetryConfig } from "./telemetry.js";

export type Scope = "user" | "project" | "local";

export interface MarketplaceConfig {
  source: MarketplaceSource;
  autoUpdate?: boolean;
}

/**
 * Root configuration structure for all Wave Agent settings including hooks and environment variables
 */
export interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>; // Environment variables key-value pairs
  /** New field for persistent permissions */
  permissions?: {
    allow?: string[];
    deny?: string[];
    /**
     * Default permission mode for restricted tools. Settings key aligns with
     * Claude Code's `permissions.defaultMode`; the runtime permission context
     * and CLI `--permission-mode` keep the "permission mode" naming.
     */
    defaultMode?: PermissionMode;
    /**
     * List of directories that are considered part of the Safe Zone.
     * File operations within these directories can be auto-accepted.
     */
    additionalDirectories?: string[];
  };
  /** New field for scoped plugin management */
  enabledPlugins?: Record<string, boolean>;
  /** Preferred language for agent communication */
  language?: string;
  /** Whether auto-memory is enabled */
  autoMemoryEnabled?: boolean;
  /** Frequency of auto-memory extraction turns */
  autoMemoryFrequency?: number;
  /** Persisted model selection (from /model command) */
  model?: string;
  /** Model-specific configuration overrides */
  models?: Record<string, Partial<ModelConfig>>;
  /** Scoped marketplace declarations */
  marketplaces?: Record<string, MarketplaceConfig>;
  /** OpenTelemetry monitoring configuration */
  monitoring?: {
    telemetry?: Partial<TelemetryConfig>;
  };
  /** Worktree configuration */
  worktree?: {
    /** Base ref for new worktrees: "fresh" (origin/<default-branch>, default) | "head" (local HEAD) */
    baseRef?: "fresh" | "head";
  };
  /** Whether the Artifact tool is enabled. Unset follows the code default constant (ARTIFACT_DEFAULT_ENABLED). */
  enableArtifact?: boolean;
  /**
   * Session transcript retention in days (aligned with Claude Code's
   * cleanupPeriodDays). Session jsonl files in ~/.wave/projects older than
   * this many days are cleaned up in the background at startup.
   * Default: 30. 0 disables cleanup entirely.
   */
  cleanupPeriodDays?: number;
}

/**
 * 设置页读写的用户偏好子集（落点 = 用户级 `~/.wave/settings.json`；读写实现见
 * `utils/userSettings.ts`）。三端（VSCE / JetBrains / desktop）设置页与 CLI 的
 * `getUserSettings` / `updateUserSettings` RPC 共用这一形状；`contextLength` 单位
 * 为 K（落盘换算为 `env.WAVE_MAX_INPUT_TOKENS`）。
 */
export interface UserPreferenceSettings {
  /** AI 回复语言（settings.json 顶层 `language`，如 zh-CN / en-US）。 */
  language?: string;
  /** 上下文长度，单位 K（如 200 = 200K）。 */
  contextLength?: number;
  /** 是否开启自动记忆提取。 */
  autoMemoryEnabled?: boolean;
  /** 自动记忆提取的轮次频率（1–100）。 */
  autoMemoryFrequency?: number;
}

/**
 * Legacy alias for backward compatibility - will be deprecated
 */
export interface HookConfiguration extends WaveConfiguration {
  hooks: Partial<Record<HookEvent, HookEventConfig[]>>;
}

/**
 * Partial hook configuration for loading/merging scenarios
 */
export type PartialHookConfiguration = Partial<
  Record<HookEvent, HookEventConfig[]>
>;

/**
 * Direct hook configuration record (for test convenience)
 */
export type HookConfigurationRecord = Record<HookEvent, HookEventConfig[]>;

/**
 * Result of configuration loading operations with detailed status information
 */
export interface ConfigurationLoadResult {
  /** The loaded configuration, or null if loading failed */
  configuration: WaveConfiguration | null;
  /** Whether the loading operation was successful */
  success: boolean;
  /** Error message if loading failed */
  error?: string;
  /** Path of the successfully loaded file */
  sourcePath?: string;
  /** Non-critical warnings during loading */
  warnings: string[];
}

/**
 * Result of configuration validation operations
 */
export interface ValidationResult {
  /** Whether the configuration is valid */
  isValid: boolean;
  /** Critical errors that prevent configuration use */
  errors: string[];
  /** Non-critical warnings about the configuration */
  warnings: string[];
}

/**
 * Configuration file paths organized by category
 */
export interface ConfigurationPaths {
  /** User-specific configuration file paths in priority order */
  userPaths: string[];
  /** Project-specific configuration file paths in priority order */
  projectPaths: string[];
  /** Builtin configuration file paths */
  builtinPaths: string[];
  /** All configuration paths combined */
  allPaths: string[];
  /** Only the paths that actually exist on the filesystem */
  existingPaths: string[];
}

/**
 * Options for configuring the ConfigurationService
 */
export interface ConfigurationServiceOptions {
  /** Working directory for resolving project configurations */
  workdir: string;
  /** Optional logger for configuration operations */
  logger?: Logger;
  /** Whether to enable validation during loading (default: true) */
  enableValidation?: boolean;
}

/**
 * Minimal logger interface for configuration services
 */
interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
}

export interface RemoteSettingsResponse {
  uuid: string;
  checksum: string;
  settings: WaveConfiguration;
}

export interface RemoteSettingsCache {
  uuid: string;
  checksum: string;
  settings: WaveConfiguration;
  fetchedAt: string;
}

export interface RemoteSettingsFetchResult {
  success: boolean;
  settings?: WaveConfiguration | null;
  checksum?: string;
  error?: string;
  notConfigured?: boolean;
}
