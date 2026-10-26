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

export type Scope = "user" | "project" | "local";

export interface MarketplaceConfig {
  source: MarketplaceSource;
}

/**
 * 沙箱的网络白名单（对齐 Claude Code 的 `sandbox.network`）。
 *
 * 沙箱内的命令默认不能出网：允许域名走宿主上的 HTTP/SOCKS5 代理裁决，
 * 清空代理环境变量直连也出不去（Linux 靠独立网络命名空间、macOS 靠
 * Seatbelt 只放通代理端口）。
 */
export interface SandboxNetworkConfiguration {
  /** 允许访问的域名（后缀匹配，如 `api.github.com`）。空 = 全部拒绝。 */
  allowedDomains?: string[];
  /** 显式拒绝的域名，优先级高于允许列表。 */
  deniedDomains?: string[];
  /** macOS 专用：允许连的 Unix socket 路径。Linux 上无法按路径过滤而被忽略。 */
  allowUnixSockets?: string[];
  /** 允许所有 Unix socket（两端都生效，等于关掉这层限制）。 */
  allowAllUnixSockets?: boolean;
  /** 允许绑定/连接本地端口（本地服务器的场景）。 */
  allowLocalBinding?: boolean;
}

/**
 * 沙箱的文件系统规则（对齐 Claude Code 的 `sandbox.filesystem`）。
 *
 * 写是「默认全拒、只放 allowWrite」，读是「默认全放、按 denyRead 收窄」，
 * `allowRead` 在 `denyRead` 区域内重新开口。路径支持 `~`，相对路径按 settings
 * 文件所在目录解析。
 */
export interface SandboxFilesystemConfiguration {
  /** 额外允许写的工作区外路径（工作区与临时目录始终可写，不必列出）。 */
  allowWrite?: string[];
  /** 在可写范围内再拒绝的路径。 */
  denyWrite?: string[];
  /** 拒绝读取的路径（如 `~/.ssh`）。 */
  denyRead?: string[];
  /** 在 `denyRead` 区域内重新允许读取的路径。 */
  allowRead?: string[];
}

/**
 * Bash 命令的 OS 级沙箱配置（`settings.json` 顶层 `sandbox` 段）。
 *
 * 字段命名与 Claude Code 对齐，便于用户迁移既有配置；未配置时行为与没有沙箱
 * 完全一致（总开关默认关）。仅 macOS 与 Linux（含 WSL2）生效，Windows 上
 * 判定为不支持——与 Claude Code 保持一致。
 */
export interface SandboxConfiguration {
  /** 总开关。缺省 false：不沙箱、零行为差异。 */
  enabled?: boolean;
  /**
   * 沙箱不可用（平台不支持、依赖缺失）时是否让命令直接失败。
   * 缺省 false：降级为不沙箱执行并给出警告。
   */
  failIfUnavailable?: boolean;
  /**
   * 沙箱内的 Bash 是否跳过用户确认。缺省 false：沙箱只加边界，不改变弹窗行为。
   * 打开后仍尊重显式的拒绝规则（整条命令与每个子命令）。
   */
  autoAllowBashIfSandboxed?: boolean;
  /**
   * 是否允许模型通过 `dangerouslyDisableSandbox` 请求不沙箱执行。
   * 缺省 true；设为 false 时该参数被完全忽略，命令必须沙箱执行。
   */
  allowUnsandboxedCommands?: boolean;
  /** 不做沙箱的命令模式（如 `npm run test:*`），按 `&&` 拆开的子命令逐个匹配。 */
  excludedCommands?: string[];
  network?: SandboxNetworkConfiguration;
  filesystem?: SandboxFilesystemConfiguration;
  /** 按命令模式忽略的违规（不写进工具结果）。 */
  ignoreViolations?: Record<string, string[]>;
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
  /** Persisted model selection (written by the model picker's `setModel`) */
  model?: string;
  /**
   * Model used for lightweight tasks (subagent summaries, WebFetch content
   * processing, inline completion). Takes precedence over the
   * `WAVE_FAST_MODEL` env variable, like `model` does over `WAVE_MODEL`.
   */
  fastModel?: string;
  /** Model-specific configuration overrides */
  models?: Record<string, Partial<ModelConfig>>;
  /**
   * Model used for inline code completion. Unset falls back to the fast model,
   * so a project can enable completion without picking a second model.
   */
  completionModel?: string;
  /** Whether inline code completion is enabled. Unset follows the default (enabled). */
  completionEnabled?: boolean;
  /**
   * Whether the next-edit suggestion is enabled (spec ui/next-edit-suggestion.md).
   * Unset follows the default (**disabled**): it rewrites code the user already
   * wrote, so it stays opt-in.
   */
  nextEditEnabled?: boolean;
  /** Scoped marketplace declarations */
  marketplaces?: Record<string, MarketplaceConfig>;
  /**
   * Command whose stdout is a JSON object of OTLP export headers, re-run on a
   * refresh interval so a rotating credential never has to be written into
   * config or shipped in a build (aligned with Claude Code's `otelHeadersHelper`
   * — same name, same top-level position).
   *
   * A top-level key rather than an `env` entry for the same reason Claude Code
   * keeps it out of `env`: this one names a command that runs on this machine,
   * so it must not travel with the ordinary telemetry variables. Only the user
   * layer (`~/.wave/settings.json`) or the server-managed layer may set it — a
   * checked-out repo must not be able to name a command that runs here (see
   * `loadMergedWaveConfig`).
   */
  otelHeadersHelper?: string;
  /** Worktree configuration */
  worktree?: {
    /** Base ref for new worktrees: "fresh" (origin/<default-branch>, default) | "head" (local HEAD) */
    baseRef?: "fresh" | "head";
  };
  /** Whether the Artifact tool is enabled. Unset follows the code default constant (ARTIFACT_DEFAULT_ENABLED). */
  enableArtifact?: boolean;
  /** Whether the Exec tool is enabled. Unset follows the code default constant (EXEC_DEFAULT_ENABLED). */
  enableExec?: boolean;
  /**
   * Whether the three enterprise knowledge-base tools (`kb_search` /
   * `kb_get_doc` / `kb_suggest`) are registered. Unset follows the code default
   * constant (KNOWLEDGE_BASE_TOOLS_DEFAULT_ENABLED = off).
   *
   * Off by default because they widen what every conversation can see: any
   * document the enterprise has ingested can be pulled into the model's context.
   * A non-boolean value reads as "off" (see knowledgeBaseAvailability.ts).
   */
  enableKnowledgeBase?: boolean;
  /**
   * Whether this machine may serve its sessions to a paired phone over the
   * remote-control relay. Unset follows the code default constant
   * (REMOTE_CONTROL_DEFAULT_ENABLED).
   *
   * Judged by the host process (the CLI / daemon that owns the sessions), not
   * by the agent. Enabled only makes the process *able* to serve: the outbound
   * connection to the relay — and hence making pending tool approvals reachable
   * from off the machine — still needs an explicit `wave remote-control on` /
   * GUI action, so the default is on while the exposure stays opt-in.
   */
  enableRemoteControl?: boolean;
  /**
   * Whether to send the lean (condensed) prompt set: the static system prompt
   * collapses to the identity line plus the harness notes, and every built-in
   * tool that declares `leanPrompt` sends that text instead of its full
   * description. Text only — the tool set, parameter schemas, permission
   * decisions and every runtime behaviour stay identical.
   * Unset follows the code default constant (LEAN_PROMPT_DEFAULT_ENABLED).
   */
  leanPrompt?: boolean;
  /**
   * Built-in tool names that must stay declared flat instead of being loaded on
   * demand (the "do not defer" override, aligned with Claude Code's
   * `non_deferrable_builtins`). Unioned with the structural floor
   * (`STRUCTURAL_NON_DEFERRABLE`) before the deferral judgment runs.
   *
   * Exists so a tool that turns out to be needed every turn can be pulled back out
   * of the pool by configuration or by a remote push, without a release.
   */
  nonDeferrableBuiltins?: string[];
  /**
   * Session transcript retention in days (aligned with Claude Code's
   * cleanupPeriodDays). Session jsonl files in ~/.wave/projects older than
   * this many days are cleaned up in the background at startup.
   * Default: 30. 0 disables cleanup entirely.
   */
  cleanupPeriodDays?: number;
  /**
   * OS 级 Bash 沙箱（文件系统 + 网络）。未配置时与没有沙箱完全一致。
   *
   * 判定可用性只取决于平台与本地依赖（macOS `sandbox-exec` / Linux
   * `bwrap`+`socat`+`rg`），Windows 恒为不支持。
   */
  sandbox?: SandboxConfiguration;
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
  /** Wave 服务端地址（settings.json 的 `env.WAVE_SERVER_URL`，如 https://…）。 */
  serverUrl?: string;
  /**
   * 行内补全使用的模型（settings.json 顶层 `completionModel`）。未设置时回退
   * 快速模型（spec ui/code-completion 故事 4）。
   */
  completionModel?: string;
  /** 是否启用行内补全（settings.json 顶层 `completionEnabled`，缺省为开）。 */
  completionEnabled?: boolean;
  /**
   * 是否启用下一步编辑建议（settings.json 顶层 `nextEditEnabled`，缺省为**关**）。
   * 与补全不同，它会改写用户已经写下的代码，因此先关闭、由用户显式开启
   * （spec ui/next-edit-suggestion.md 故事 6）。
   */
  nextEditEnabled?: boolean;
}

/** 用户偏好键（设置页控件）。 */
export type UserPreferenceKey = keyof UserPreferenceSettings;

/**
 * 生效值的来源层。只归因**进程级可达**的层（Remote 组织下发 / 用户级文件 /
 * 机器环境变量 / SDK 默认）：`project` / `local` 需要 workdir，而
 * `getUserSettings` 是刻意的无会话全局 RPC；`override` / `options` 是会话级
 * 语义，不在这条链路上（见 spec core/agent-config.md 边界说明「用户偏好的层与来源」）。
 */
export type UserPreferenceSource = "remote" | "user" | "env" | "default";

/**
 * `getUserSettings` / `updateUserSettings` 的回包：**生效**用户偏好——键缺失
 * 表示该偏好没有任何提供者（设置页据此显示「未设置」态）——外加每个键的来源层
 * （`preferenceSources`，设置页对来源为 `remote` 的键显示生效值 + 置灰 +
 * 「由组织配置管理」）。
 */
export interface UserPreferenceSettingsView extends UserPreferenceSettings {
  /** 每个键恒有来源（缺省即 `default`）。 */
  preferenceSources?: Partial<Record<UserPreferenceKey, UserPreferenceSource>>;
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
