import { type CallAgentOptions } from "../services/aiService.js";
import * as aiService from "../services/aiService.js";
import { randomUUID } from "crypto";
import type { BtwHistoryTurn } from "../types/btw.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { resolveApiType, supportsVision } from "../utils/modelCapabilities.js";
import { persistToolImages } from "../utils/toolImagePersistence.js";
import { applyToolImageBudget } from "../utils/toolImageIngest.js";
import type { ToolImage } from "../utils/toolImageIngest.js";
import { parseTaskNotificationXml } from "../utils/notificationXml.js";
import {
  estimateContextTokens,
  getAutoCompactThreshold,
  roughTokenCountForMessages,
} from "../utils/tokenCalculation.js";
import { buildContextBreakdown } from "../services/contextBreakdown.js";
import type { ContextBreakdown } from "../types/contextBreakdown.js";
import { USER_MEMORY_FILE } from "../utils/constants.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import {
  pickQuotaHeaders,
  quotaHeadersFromError,
  type QuotaHeaders,
} from "../utils/quotaHeaders.js";
import {
  getTaskReminderTurnCounts,
  maybeInjectTaskReminder,
  TASK_REMINDER_CONFIG,
} from "../utils/taskReminder.js";
import { getChangedFilesReminder } from "../utils/fileChangeReminder.js";
import {
  buildSkillListingAnnouncement,
  collectSkillListingState,
  formatSkillsWithinBudget,
  resolveSkillListingCharBudget,
} from "../utils/skillListing.js";
import {
  buildAgentListingAnnouncement,
  collectAgentListingState,
  formatAgentsWithinBudget,
  resolveAgentListingCharBudget,
} from "../utils/agentListing.js";
import {
  buildAgentMentionReminder,
  parseAgentMentions,
} from "../utils/agentMentions.js";
import {
  buildMcpInstructionsAnnouncement,
  collectAnnouncedServers,
} from "../utils/mcpInstructions.js";
import {
  buildReplCatalogAnnouncement,
  collectReplCatalogState,
} from "../repl/catalogAnnouncement.js";
import {
  disposeReplRuntime,
  drainReplEvents,
  listRunningReplScripts,
} from "../repl/replRuntime.js";
import { renderReplEvent, renderReplStatus } from "../tools/pollTool.js";
// 只依赖 `resultData/` 的纯模块与 `constants/`（零 import 副作用），可以安全地进
// 这条读路径：模型侧 tool_result 的文本由这里现渲，不再由工具预存。
import { renderToolResultData } from "../tools/resultData/index.js";
import { stripToolResultDataForStorage } from "../tools/resultData/strip.js";
import { allocateAgentSlot, replSessionKey } from "../repl/sessionKey.js";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import {
  EDIT_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../constants/tools.js";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  Message,
  TextBlock,
} from "../types/index.js";
import {
  TurnBudgetLedger,
  parseTokenBudgetTarget,
} from "./turnBudgetLedger.js";
import type { ToolManager } from "./toolManager.js";
import type { ToolContext, ReadFileState } from "../tools/types.js";
import type { MessageManager } from "./messageManager.js";
import type { BackgroundTaskManager } from "./backgroundTaskManager.js";
import {
  ChatCompletionMessageFunctionToolCall,
  type ChatCompletionMessageParam,
} from "openai/resources.js";

import type { HookManager } from "./hookManager.js";
import type { ExtendedHookExecutionContext } from "../types/hooks.js";
import type { BackgroundTaskInfo, SessionCronInfo } from "../types/hooks.js";
import type { PermissionManager } from "./permissionManager.js";
import type { McpManager } from "./mcpManager.js";
import type { SubagentManager } from "./subagentManager.js";
import type { CronManager } from "./cronManager.js";
import type { SkillManager } from "./skillManager.js";
import type { LiveConfigManager } from "./liveConfigManager.js";
import type { ModManager } from "./modManager.js";
import {
  MOD_LIMITS,
  type ModPromptSection,
  type ModTokenTotals,
} from "../types/mods.js";
import { toolResponseForModEvent, truncateForModEvent } from "../mods/text.js";
import {
  buildSystemPromptBlocks,
  buildSystemPromptSections,
  formatCompactSummary,
  getCompactPrompt,
  type SystemPromptOptions,
} from "../prompts/index.js";
import {
  buildPlanModeReminder,
  buildPlanModeReEntryReminder,
  buildExitedPlanModeReminder,
  wrapInSystemReminder,
} from "../prompts/planModeReminders.js";
import { Container } from "../utils/container.js";
import { AsyncWorkRegistry } from "../utils/asyncWorkRegistry.js";
import type { WorktreeSession } from "../utils/worktreeSession.js";
import { recoverTruncatedJson } from "../utils/stringUtils.js";
import { ConfigurationService } from "../services/configurationService.js";
import { isLeanPromptEnabled } from "../services/leanPrompt.js";
import type { MessageQueue } from "./messageQueue.js";
import { logger } from "../utils/globalLogger.js";
import {
  logOTelEvent,
  logRequestContentEvents,
  resetContentEventState,
} from "../telemetry/events.js";
import { recordTokenUsage } from "../telemetry/metrics.js";
import { classifyError } from "../telemetry/errorCategory.js";
import type { ErrorCategory } from "../telemetry/errorCategory.js";
import { trackCliOperation } from "../telemetry/activity.js";
import { entrypointOf } from "../telemetry/attributes.js";
import type { HostEntrypoint } from "../constants/telemetry.js";
import type { BackgroundTask } from "../types/processes.js";

/** Result of a fork-path agent loop (compaction or auto-memory extraction). */
interface ForkLoopResult {
  content?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Max turns for the compaction fork: the model should summarize, not act. */
const MAX_FORK_TURNS = 3;

/** Max turns for the auto-memory extraction fork. */
const MAX_AUTO_MEMORY_FORK_TURNS = 5;

/**
 * Max consecutive auto-resumes after `finish_reason === "length"` when the
 * truncated turn produced NO tool calls (aligned with Claude Code's
 * MAX_OUTPUT_TOKENS_RECOVERY_LIMIT). A tool call resets the counter — it is
 * real progress. Exhausting the limit terminates the turn with an error
 * instead of re-planning forever.
 */
const MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3;

/**
 * 侧聊的一段在引擎侧的状态（spec commands/btw-command.md「侧聊分段与上下文冻结」）。
 *
 * 一段侧聊 = 一次 fork：前缀在首次提问那一刻取一次，段内每轮原样复用，主 Agent
 * 之后产出的新消息进不来；关闭该段即丢弃。
 */
interface BtwSegmentState {
  /** 该段首次提问那一刻的主对话前缀（含记忆注入）；段内每轮只读复用。 */
  prefix?: ChatCompletionMessageParam[];
  /** 关闭该段时用它中止在途的那一轮。 */
  controller: AbortController;
}

/** 引擎侧最多同时保留几段侧聊的冻结前缀：整份父对话快照，不能无限攒。 */
const MAX_BTW_SEGMENTS = 8;

/**
 * 历史答案在重放前先净化（对齐 Claude Code 2.1.322 侧聊多轮实现 `Ahn()`）：
 * 模型只把工具调用写成文本、或这一轮压根没成功时，那句"答案"没有任何信息量，
 * 原样喂回后续每一轮只会让模型接着照着编——换成一句省略说明。
 */
const BTW_HISTORY_TOOL_CALLS_OMITTED =
  "(That answer wrote tool calls as text. Nothing was executed, so it is omitted here.)";
const BTW_HISTORY_FAILED_OMITTED =
  "(That answer failed, so it is omitted here.)";

/**
 * The `- ` lines of a listing body, in order. Skips the header and the
 * `- (N more …)` footer — neither names a skill or a subagent, and counting
 * them as entries would shift every later line by one.
 */
function listingLines(body: string): string[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("- ") && !line.startsWith("- ("));
}

function sanitizeBtwHistoryAnswer(answer: string): string {
  const trimmed = answer.trim();
  if (
    /^\(The model tried to call .*instead of answering directly/s.test(trimmed)
  ) {
    return BTW_HISTORY_TOOL_CALLS_OMITTED;
  }
  if (
    trimmed.startsWith("(API error: ") ||
    trimmed === "No response received"
  ) {
    return BTW_HISTORY_FAILED_OMITTED;
  }
  return answer;
}

/**
 * 合并多个取消信号：调用方的（CLI overlay 按 Esc）与这一段的（面板关闭）谁先来
 * 都算数。手工合并而不是 `AbortSignal.any`（仓库的 lib 下没有它的类型），并在
 * 请求结束后由 `dispose` 摘掉监听——追问是长尾场景，逐轮堆监听会一直拽着旧请求。
 */
function linkAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal?: AbortSignal;
  dispose: () => void;
} {
  const live = signals.filter((signal): signal is AbortSignal => !!signal);
  if (live.length <= 1) return { signal: live[0], dispose: () => {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of live) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of live) signal.removeEventListener("abort", abort);
    },
  };
}

// Truncate text to `max` chars and append a "… [+N chars]" marker when exceeded.
// Used for background_tasks description/command fields (≤1000 chars per spec FR-063).
function truncateWithMarker(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `… [+${text.length - max} chars]`;
}

// Add one response's usage into a turn's totals (`turn.complete`, spec
// ecosystem/plugin-mods.md「完成与审批的观察」). `prompt` keeps the cache hits —
// same convention as `$.session.usage().tokens`.
function accumulateTurnUsage(totals: ModTokenTotals, usage: Usage): void {
  totals.prompt += usage.prompt_tokens ?? 0;
  totals.completion += usage.completion_tokens ?? 0;
  totals.cacheRead += usage.cache_read_input_tokens ?? 0;
  totals.cacheCreation += usage.cache_creation_input_tokens ?? 0;
}

// Map a BackgroundTask (from BackgroundTaskManager) to the Stop hook's
// background_tasks array element shape (aligned with Claude Code v2.1.145+).
// Conditional fields are populated based on task type:
//   - shell:    `command`
//   - subagent: `agent_type` (looked up via SubagentManager by subagentId)
//   - workflow: `name` (extracted from "Workflow: <name>" description)
function mapBackgroundTask(
  task: BackgroundTask,
  subagentManager: SubagentManager | undefined,
): BackgroundTaskInfo {
  const base: BackgroundTaskInfo = {
    id: task.id,
    type: task.type,
    status: task.status,
    description: truncateWithMarker(task.description ?? "", 1000),
  };
  if (task.type === "shell") {
    return { ...base, command: truncateWithMarker(task.command ?? "", 1000) };
  }
  if (task.type === "subagent") {
    const instance = subagentManager
      ?.getActiveInstances()
      .find((i) => i.subagentId === task.subagentId);
    return { ...base, agent_type: instance?.subagentType ?? "" };
  }
  // workflow
  const prefix = "Workflow: ";
  const name = task.description?.startsWith(prefix)
    ? task.description.slice(prefix.length)
    : (task.description ?? "");
  return { ...base, name };
}

export interface AIManagerCallbacks {
  onCompactionStateChange?: (isCompacting: boolean) => void;
  /**
   * Streaming content from the compaction fork, as a **delta** of newly
   * produced text (same family as `chunk` on `onAssistantContentUpdated`):
   * consumers append it, and its size is independent of how much has already
   * streamed (spec: ui/stdio-transport.md「流式通知纯增量负载」场景 7).
   * Reasoning deltas fall back to this channel when no reasoning callback is
   * provided. Consumed by the CLI to show the compaction loading tail; the
   * tail is cleared when compaction ends, so nothing re-reads this stream.
   */
  onCompactionContentUpdate?: (content: string) => void;
  /** Streaming reasoning from the compaction fork, as a delta. */
  onCompactionReasoningUpdate?: (content: string) => void;
  onUsageAdded?: (usage: Usage) => void;
  onCwdChange?: (newCwd: string) => void;
  /**
   * Full plan-file content after a successful `Write`/`Edit` of the plan file
   * (spec: 计划文件更新后刷新计划面板). Inherited from AgentCallbacks via the
   * spread in container setup.
   */
  onPlanFileUpdated?: (content: string) => void;
  /**
   * 额度响应头 `x-codechat-quota-*`（成功响应与 `APIError.headers` 两条路径都
   * 取），原样交给宿主；一个头都没有时不触发（spec:
   * docs/specs/desktop/desktop-account.md「额度响应头」）。
   */
  onQuotaHeaders?: (headers: Record<string, string>) => void;
}

export interface AIManagerOptions {
  callbacks?: AIManagerCallbacks;
  workdir: string;
  systemPrompt?: string;
  subagentType?: string; // Optional subagent type for hook context
  /**Whether to use streaming mode for AI responses - defaults to true */
  stream?: boolean;
  /**Optional model override (e.g. for subagents) */
  modelOverride?: string;
  /**Optional max turns limit to prevent runaway recursion (e.g. for auto-memory extraction) */
  maxTurns?: number;
  /**
   * Skip the project `AGENTS.md` (and its `CLAUDE.md` fallback), user memory and
   * the `.wave/rules` unconditional rules for this manager's turns. Used by
   * subagent definitions declaring `omitAgentsMd`, matching Claude Code's
   * `omitClaudeMd`.
   */
  omitAgentsMd?: boolean;
  /**
   * 子代理自己的 id（`classic.SubagentStop` 的 `agent_id`）。父代理不传。
   */
  subagentId?: string;
  /**
   * 子代理日志文件的路径（`classic.SubagentStop` 的 `agent_transcript_path`）。
   * 只有跑在后台、宿主为它开了日志流的子代理才有值，所以用闭包现取。
   */
  subagentTranscriptPath?: () => string | undefined;
  /**
   * 收尾事件 `classic.SubagentStop` 已经派发过。`SubagentManager` 用它让实例释放
   * 时不再补报一次 —— 补报只留给「没走到收尾」的出错 / 中止路径。
   */
  onSubagentStopDispatched?: () => void;
}

export class AIManager {
  public isLoading: boolean = false;
  /**
   * This manager's half of the REPL context key (see `repl/sessionKey.ts`).
   *
   * One agent = one long-lived JavaScript context; a subagent has its own manager
   * and therefore its own slot, so the two cannot see each other's variables even
   * though they share a session.
   */
  private readonly replAgentSlot = allocateAgentSlot();
  private turnGeneration = 0; // Guards against concurrent sendAIMessage turns
  private abortController: AbortController | null = null;
  onLoadingChange?: (loading: boolean) => void;
  private toolAbortController: AbortController | null = null;
  private systemPrompt?: string;
  private subagentType?: string; // Store subagent type for hook context
  /** 子代理自己的 id 与日志路径（`classic.SubagentStop` 的 `agent_id` / `agent_transcript_path`） */
  private subagentId?: string;
  private subagentTranscriptPath?: () => string | undefined;
  /** 收尾事件派发过的通知，见 `AIManagerOptions.onSubagentStopDispatched` */
  private onSubagentStopDispatched?: () => void;
  private stream: boolean; // Streaming mode flag
  private modelOverride?: string;
  private _onCwdChange?: (newCwd: string) => void; // Store callback for CWD changes
  private _onWorkspaceRootChange?: (newRoot: string) => void; // Workspace relocations (worktree enter/exit)
  private originalWorkdir: string;
  /** Pending cwd-recovery notice (set when getCurrentWorkdir() auto-recovers), consumed by tools */
  private pendingCwdRecovery: { from: string; to: string } | null = null;
  private consecutiveCompactionFailures: number = 0;
  /**
   * Set when a Stop / SubagentStop hook blocked the previous turn, so the next
   * Stop hook invocation can be told it is already a continuation
   * (`stop_hook_active` in the hook input, aligned with Claude Code). Reset at
   * the start of every user-visible turn.
   */
  private stopHookActive = false;
  /**
   * 这一轮里 mods 的 `classic.Stop` 已经让这一轮续跑过几次（spec ecosystem/
   * plugin-mods.md「一轮收尾时的非错误反馈」）。到 `stopHookContinuationCap` 就
   * 不再续 —— 插件的 `additionalContext` 写得再贪也不能把用户困在死循环里。
   */
  private modStopContextCount = 0;
  /**
   * `prompt.context` 已经问过的那一场会话（spec「系统提示词与附件」：一条会话
   * 一次）。存的是 session id 而不是布尔值 —— 换会话时不需要额外的重置点。
   */
  private sessionPromptContextFor?: string;
  /**
   * 正在跑的那一轮的 id（spec「收掉一轮」）。`turn.start` 时写入、收尾时清空。
   *
   * 只给 `$.turn.abort({ turnId })` 判「你叫的是不是这一轮」：id 对不上或没有
   * 一轮在跑，一律 reject —— 静默成功会让插件以为自己叫停了。
   */
  private currentTurnId?: string;
  /**
   * `prompt.compose` / `prompt.section` 在这一轮问出来的结果（spec「一轮一次」）。
   *
   * 一轮里工具循环会连着发好几次模型请求，逐请求重问会让带时间戳或计数器的插件
   * 让同一轮各步的系统提示词不同 —— 那正是这套分段要保住的缓存前缀。键里带上
   * 宿主自己那段的签名：一轮里 MCP 拨号会换掉可达工具，基底变了就得重新问，否则
   * 插件拿到的是已经过期的事实。没有 `currentTurnId`（会话压缩的 fork）时不缓存。
   */
  private promptModsCache?: {
    turnId: string;
    signature: string;
    sections: ModPromptSection[];
  };
  private readonly maxTurns?: number;
  /** Start turns without project/user memory injection (`omitAgentsMd` subagents) */
  private readonly omitAgentsMd: boolean;
  /** Tracks file mtime/hash at read time for staleness detection on Edit/Write */
  private readFileState: ReadFileState = new Map();
  /** Override tool_choice for this AI manager (e.g. for structured output) */
  public toolChoiceOverride?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
  /**
   * 侧聊分段状态（spec commands/btw-command.md「侧聊分段与上下文冻结」）。宿主
   * 只带 `segmentId` 过来，冻结的父对话前缀与在途请求的取消信号都留在这里。
   */
  private btwSegments = new Map<string, BtwSegmentState>();

  /** Subagent type, or undefined for the main agent (tool-event hook context) */
  getSubagentType(): string | undefined {
    return this.subagentType;
  }

  // Service overrides
  constructor(
    private container: Container,
    options: AIManagerOptions,
  ) {
    this.systemPrompt = options.systemPrompt;
    this.subagentType = options.subagentType; // Store subagent type
    this.subagentId = options.subagentId;
    this.subagentTranscriptPath = options.subagentTranscriptPath;
    this.onSubagentStopDispatched = options.onSubagentStopDispatched;
    this.stream = options.stream ?? true; // Default to true if not specified
    this.callbacks = options.callbacks ?? {};
    this.modelOverride = options.modelOverride;
    this._onCwdChange = options.callbacks?.onCwdChange; // Initialize onCwdChange
    this.originalWorkdir = options.workdir;
    this.maxTurns = options.maxTurns;
    this.omitAgentsMd = options.omitAgentsMd ?? false;
  }

  private get toolManager(): ToolManager {
    return this.container.get<ToolManager>("ToolManager")!;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get memoryService(): import("../services/memory.js").MemoryService {
    return this.container.get<import("../services/memory.js").MemoryService>(
      "MemoryService",
    )!;
  }

  private get taskManager(): import("../services/taskManager.js").TaskManager {
    return this.container.get<import("../services/taskManager.js").TaskManager>(
      "TaskManager",
    )!;
  }

  private get backgroundTaskManager(): BackgroundTaskManager | undefined {
    return this.container.get<BackgroundTaskManager>("BackgroundTaskManager");
  }

  private get asyncWorkRegistry(): AsyncWorkRegistry | undefined {
    return this.container.get<AsyncWorkRegistry>("AsyncWorkRegistry");
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get reversionManager():
    | import("./reversionManager.js").ReversionManager
    | undefined {
    return this.container.get<import("./reversionManager.js").ReversionManager>(
      "ReversionManager",
    );
  }

  private get permissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  private get mcpManager(): McpManager | undefined {
    return this.container.get<McpManager>("McpManager");
  }

  private get planManager():
    | import("./planManager.js").PlanManager
    | undefined {
    return this.container.get<import("./planManager.js").PlanManager>(
      "PlanManager",
    );
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  /**
   * OS env merged with the per-session env snapshot. Falls back to process.env
   * when ConfigurationService is absent or its getMergedEnv is missing (e.g. in
   * unit tests with partial mocks), so hook-context env construction never
   * throws. Use this (not the non-null `configurationService` getter) when
   * building hook context env.
   */
  private get mergedEnv(): Record<string, string> {
    return (
      this.container
        .get<ConfigurationService>("ConfigurationService")
        ?.getMergedEnv?.() ?? (process.env as Record<string, string>)
    );
  }

  // Getter methods for accessing dynamic configuration
  public getGatewayConfig(): GatewayConfig {
    return {
      ...this.configurationService.resolveGatewayConfig(),
      sessionId: this.messageManager.getSessionId(),
    };
  }

  public getModelConfig(): ModelConfig {
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    const parentModelConfig = this.configurationService.resolveModelConfig(
      undefined,
      undefined,
      permissionMode,
    );
    let modelToUse: string | undefined;

    if (this.modelOverride) {
      if (this.modelOverride === "fastModel") {
        modelToUse = parentModelConfig.fastModel;
      } else if (this.modelOverride === "visionModel") {
        modelToUse = parentModelConfig.visionModel;
      } else if (this.modelOverride !== "inherit") {
        modelToUse = this.modelOverride;
      }
    }

    return this.configurationService.resolveModelConfig(
      modelToUse,
      undefined,
      permissionMode,
    );
  }

  public getContextWindow(): number {
    // Pass the resolved model (including fastModel/visionModel/override
    // resolution) so subagents using a different model get that model's
    // per-model contextWindow instead of the main model's value.
    return this.configurationService.resolveContextWindow(
      undefined,
      this.getModelConfig().model,
    );
  }

  public getLanguage(): string {
    return this.configurationService.resolveLanguage();
  }

  /**
   * `/context` 的数据收集（spec `commands/context-command.md`）。
   *
   * 各部分体积都是本地估算（`estimateTokens`），总量优先用上一次响应报出的
   * `total_tokens` —— 与输入框旁那个用量环同源。**不额外发 token 计数请求**
   * （CC 的 `/context` 会为每个分类发一次；我们的文本全在进程内，不必）。
   *
   * 归属判据：system prompt 里含自动记忆（`buildAutoMemoryPrompt` + MEMORY.md
   * 正文），记忆文件指的是每轮 prepend 进请求的那几份（项目 / 用户 /
   * `.wave/rules`）；技能与子代理的清单**内嵌在 Skill / Agent 工具的
   * description 里**（`tool.prompt(promptArgs)`），所以它们计入 System tools，
   * 不单列 —— 单列会与工具 schema 重复计数。
   */
  public async getContextBreakdown(): Promise<ContextBreakdown> {
    const errors: string[] = [];
    const contextWindow = this.getContextWindow();
    const maxOutputTokens = this.configurationService.resolveMaxOutputTokens();
    const autoCompactThreshold = getAutoCompactThreshold(
      contextWindow,
      maxOutputTokens,
    );

    let systemPromptTokens = 0;
    const systemTools: Array<{ name: string; tokens: number }> = [];
    const mcpTools: Array<{
      serverName: string;
      name: string;
      tokens: number;
    }> = [];
    try {
      const { toolsConfig, reachableToolPlugins } = this.resolveFilteredTools();
      // 这一份估算故意不问 mods：`prompt.compose` / `prompt.section` 定义为
      // 「每轮一次」，而 `/context` 是一次诊断读数、不是发请求 —— 让它顺手把插
      // 件问一遍，「一轮一次」就不成立了。报的是宿主自己拼出来的这一份。
      const blocks = buildSystemPromptBlocks(
        buildSystemPromptSections(
          this.systemPrompt,
          reachableToolPlugins,
          await this.resolveSystemPromptOptions(),
        ),
      );
      systemPromptTokens = estimateTokens(
        blocks.map((block) => block.text).join("\n\n"),
      );
      for (const tool of toolsConfig) {
        const name = tool.function.name;
        // JSON 走 2 字/token 的比例：工具 schema 是压紧的一行 JSON。
        const tokens = estimateTokens(JSON.stringify(tool), "json");
        if (name.startsWith("mcp__")) {
          const serverName = name.split("__")[1] || "mcp";
          mcpTools.push({ serverName, name, tokens });
        } else {
          systemTools.push({ name, tokens });
        }
      }
    } catch (error) {
      errors.push(
        `Failed to read system prompt / tool schemas: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const memoryFiles: ContextBreakdown["memoryFiles"] = [];
    try {
      // 记忆文件属于项目级配置，锚在会话起点（`SessionWorkdir`，「不动」的那个），
      // 而不是 `getCurrentWorkdir()`（「会动」的那个，Bash `cd` 就改）——注入侧
      // `getMemoryForInjection()` 读的是 `MessageManager` 的 workdir，它只在切会话
      // 时移动，所以分项必须读同一个目录，否则报出的路径会指向 `cd` 之后的地方。
      const workdir =
        this.container.get<string>("SessionWorkdir") ?? this.originalWorkdir;
      const { prependContent } = this.omitAgentsMd
        ? { prependContent: "" }
        : await this.messageManager.getMemoryForInjection();
      const totalTokens = estimateTokens(prependContent);
      if (totalTokens > 0) {
        const projectTokens = estimateTokens(
          await this.memoryService.readMemoryFile(workdir),
        );
        const userTokens = estimateTokens(
          await this.memoryService.getUserMemoryContent(),
        );
        // 个人档（AGENTS.local.md）：私有于本用户、但属于本仓库。它同样参与
        // 注入，所以必须单列 —— 不列就会被算进下面的「差额 = 规则体积」。
        const localTokens = estimateTokens(
          await this.memoryService.readLocalMemoryFile(workdir),
        );
        if (projectTokens > 0) {
          memoryFiles.push({
            type: "project",
            path: path.join(workdir, "AGENTS.md"),
            tokens: projectTokens,
          });
        }
        if (userTokens > 0) {
          memoryFiles.push({
            type: "user",
            path: USER_MEMORY_FILE,
            tokens: userTokens,
          });
        }
        if (localTokens > 0) {
          memoryFiles.push({
            type: "local",
            path: path.join(workdir, "AGENTS.local.md"),
            tokens: localTokens,
          });
        }
        // 剩下的差额是 `.wave/rules` 里无条件生效的规则；三档记忆之外没有别的
        // 注入来源，所以差额即规则体积。
        const rulesTokens = Math.max(
          0,
          totalTokens - projectTokens - userTokens - localTokens,
        );
        if (rulesTokens > 0) {
          memoryFiles.push({
            type: "rules",
            path: ".wave/rules",
            tokens: rulesTokens,
          });
        }
      }
    } catch (error) {
      errors.push(
        `Failed to read memory files: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // The skill / subagent listings are historical messages, so they are already
    // inside `messagesTokens`. Break them out by re-rendering the exact body the
    // announcement channel sends (same function + same budget), then let
    // `buildContextBreakdown` subtract what was broken out.
    const skills: Array<{ name: string; tokens: number }> = [];
    try {
      const available = this.skillManager?.getAvailableSkills() ?? [];
      const eligible = available.filter(
        (skill) =>
          !skill.disableModelInvocation &&
          (!this.subagentType || skill.context !== "fork"),
      );
      if (eligible.length > 0) {
        const { body } = formatSkillsWithinBudget(
          eligible,
          resolveSkillListingCharBudget(contextWindow),
        );
        // The rendered body is sorted by name (`formatSkillsWithinBudget`), so
        // line N belongs to entry N — no name parsing, which would break on
        // descriptions containing a colon.
        const sorted = [...eligible].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        listingLines(body).forEach((line, index) => {
          const skill = sorted[index];
          if (!skill) return;
          skills.push({ name: skill.name, tokens: estimateTokens(line) });
        });
      }
    } catch (error) {
      errors.push(
        `Failed to read the skill listing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const agents: Array<{ name: string; tokens: number }> = [];
    try {
      const configs = this.subagentManager?.getConfigurations() ?? [];
      // Builtin subagents (Explore / general-purpose / Plan) are not broken out:
      // they ship with the session, and their lines stay counted in `Messages`.
      // Same split as Claude Code's `Custom agents` category.
      const custom = new Set(
        configs.filter((c) => c.scope !== "builtin").map((c) => c.name),
      );
      if (custom.size > 0) {
        const { body } = formatAgentsWithinBudget(
          configs,
          resolveAgentListingCharBudget(contextWindow),
        );
        const sorted = [...configs].sort((a, b) =>
          a.name.localeCompare(b.name),
        );
        listingLines(body).forEach((line, index) => {
          const config = sorted[index];
          if (!config || !custom.has(config.name)) return;
          agents.push({ name: config.name, tokens: estimateTokens(line) });
        });
      }
    } catch (error) {
      errors.push(
        `Failed to read the subagent listing: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return buildContextBreakdown({
      model: this.getModelConfig().model ?? "unknown",
      contextWindow,
      maxOutputTokens,
      autoCompactThreshold,
      systemPromptTokens,
      systemTools,
      mcpTools,
      memoryFiles,
      skills,
      agents,
      messagesTokens: roughTokenCountForMessages(
        this.messageManager.getMessages(),
      ),
      measuredTokens: this.messageManager.getLatestTotalTokens(),
      errors,
    });
  }

  public getAutoMemoryEnabled(): boolean {
    return this.configurationService.resolveAutoMemoryEnabled();
  }

  public getWorktreeBaseRef(): "fresh" | "head" {
    return this.configurationService.resolveWorktreeBaseRef();
  }

  /**
   * What the telemetry layer needs to attribute a record to this turn: the
   * session it belongs to (it can change mid-flight — `/clear` mints a new id),
   * the session's starting directory (only read when repository attributes are
   * enabled) and the entrypoint its creator declared (only read when the
   * entrypoint switch is on).
   */
  private get telemetryContext(): {
    sessionId: string;
    workdir: string;
    entrypoint: HostEntrypoint | undefined;
  } {
    return {
      sessionId: this.messageManager.getSessionId(),
      workdir:
        this.container.get<string>("SessionWorkdir") ?? this.originalWorkdir,
      entrypoint: entrypointOf(this.container),
    };
  }

  public getCurrentWorkdir(): string {
    const workdir =
      this.container.get<string>("CurrentWorkdir") ?? process.cwd();
    if (existsSync(workdir)) {
      return workdir;
    }

    // The stored workdir no longer exists — e.g. the current worktree
    // directory was removed manually with `git worktree remove` outside
    // wave's exit flow. Node spawn() chdirs to `cwd` before spawning, so
    // every tool that spawns a subprocess (Bash, Grep, background tasks)
    // would fail with ENOENT and cripple the session. Recover to the
    // original workdir (main repo) so the session keeps working.
    if (!existsSync(this.originalWorkdir)) {
      // No valid fallback — keep the stale value (sessions started in a
      // directory that was deleted since cannot recover to anything real).
      return workdir;
    }

    this.pendingCwdRecovery = { from: workdir, to: this.originalWorkdir };

    // If the removed directory was this session's worktree, drop the stale
    // worktree session state so ExitWorktree no-ops and EnterWorktree can
    // start a fresh session.
    const worktreeSession = this.getWorktreeSession();
    if (
      worktreeSession &&
      path.resolve(worktreeSession.worktreePath) === path.resolve(workdir)
    ) {
      this.setWorktreeSession(null);
    }

    logger.warn(
      `Working directory ${workdir} no longer exists; recovered session workdir to ${this.originalWorkdir}`,
    );

    this.container.register("CurrentWorkdir", this.originalWorkdir);
    this._onCwdChange?.(this.originalWorkdir);
    return this.originalWorkdir;
  }

  /**
   * Consume a pending cwd-recovery notice (if any). After the session
   * workdir was auto-recovered because the previous directory disappeared,
   * the first tool that calls this surfaces the notice to the model.
   * Returns null when no recovery is pending.
   */
  public consumeCwdRecovery(): { from: string; to: string } | null {
    const recovery = this.pendingCwdRecovery;
    this.pendingCwdRecovery = null;
    return recovery;
  }

  public getOriginalWorkdir(): string {
    return this.originalWorkdir;
  }

  /**
   * Update the working directory mid-session (e.g., when entering/exiting a worktree).
   * Only updates this session's DI container; it does NOT change the process-level
   * process.cwd(), so concurrent sessions in the same stdio process are unaffected.
   * Triggers `_onCwdChange` (wired by Agent to `onWorkdirChange`) so the host is
   * notified of worktree switches. Unlike bash `cd`, this does NOT run CwdChanged
   * hooks (worktree has its own WorktreeCreate/WorktreeRemove hooks).
   */
  public setCurrentWorkdir(newWorkdir: string): void {
    this.container.register("CurrentWorkdir", newWorkdir);
    this._onCwdChange?.(newWorkdir);
  }

  /**
   * The session's workspace root: the directory this conversation works in.
   * Starts at the session's opening directory and only moves when the session
   * relocates (EnterWorktree / ExitWorktree) — a Bash `cd` never touches it.
   * Surfaces that show "the project the user is looking at" (diff panel, file
   * tree root, `@` search) read this; project identity stays on
   * `SessionWorkdir`.
   */
  public getWorkspaceRoot(): string {
    return (
      this.container.get<string>("WorkspaceRoot") ?? this.getCurrentWorkdir()
    );
  }

  /**
   * Relocate the session's workspace (EnterWorktree / ExitWorktree). Separate
   * from `setCurrentWorkdir` because the two move for different reasons: this
   * one means "the conversation now works in another working tree", so it must
   * never be called for a `cd` inside the shell.
   */
  public setWorkspaceRoot(newRoot: string): void {
    this.container.register("WorkspaceRoot", newRoot);
    this._onWorkspaceRootChange?.(newRoot);
  }

  public setOnWorkspaceRootChange(callback: (newRoot: string) => void): void {
    this._onWorkspaceRootChange = callback;
  }

  /**
   * Get this session's worktree session state (null if not in a worktree).
   */
  public getWorktreeSession(): WorktreeSession | null {
    return (
      this.container.get<WorktreeSession | null>("WorktreeSession") ?? null
    );
  }

  /**
   * Set this session's worktree session state.
   */
  public setWorktreeSession(session: WorktreeSession | null): void {
    this.container.register("WorktreeSession", session);
  }

  public setOnCwdChange(callback: (newCwd: string) => void): void {
    this._onCwdChange = callback;
  }

  /**
   * 最后一次调用过后已知的额度头（按字段合并，见 `rememberQuotaHeaders`）。
   * `Agent.getSessionUsage()` 用它填 `$.session.usage().rateLimits`——
   * 宿主收到的 `onQuotaHeaders` 是「这一刻的读数」，而 mod 问的是「现在是多少」，
   * 所以这里必须留一份，不能让回调一闪而过。
   */
  public getLastQuotaHeaders(): QuotaHeaders | undefined {
    return this.lastQuotaHeaders;
  }

  /**
   * 为什么要合并、不是整批覆盖：这批头是**按维度按需发**的（`api-*` 只在判定走
   * API 时发，`weekly-*` / `monthly-*` 只在有生效套餐时发）。整批替换会让一次
   * 「只带 status + api-*」的调用把上一条已知的周/月窗口抹掉，rateLimits 突然变空。
   * 桌面端映射（`desktop/src/main/accountUsage.ts`）对同一个问题也是「头里没给的
   * 字段保留上次值」，这里沿用同一条纪律。
   */
  private rememberQuotaHeaders(headers: QuotaHeaders): void {
    this.lastQuotaHeaders = { ...this.lastQuotaHeaders, ...headers };
  }

  private isCompacting: boolean = false;
  private callbacks: AIManagerCallbacks;
  /** 额度头的最新已知值（见 `rememberQuotaHeaders`）；私有化部署下恒为 undefined。 */
  private lastQuotaHeaders?: QuotaHeaders;

  /**
   * Get filtered tool configuration based on tools list
   */
  private getFilteredToolsConfig() {
    // Get available subagents and skills for dynamic prompts
    const availableSubagents = this.subagentManager?.getConfigurations();
    const availableSkills = this.skillManager
      ?.getAvailableSkills()
      .filter((skill) => !skill.disableModelInvocation);

    return this.toolManager.getToolsConfig({
      availableSubagents,
      availableSkills,
      workdir: this.getCurrentWorkdir(),
      isSubagent: !!this.subagentType,
    });
  }

  /**
   * Add plan mode reminder as a persistent meta message to the message manager.
   * Called before getMessages() so the stored message is included in the API call.
   */
  private maybeAddPlanModeMessage(
    currentMode: PermissionMode | undefined,
  ): void {
    if (!this.permissionManager) return;

    // Handle exit notification (one-time after leaving plan mode)
    if (this.permissionManager.getNeedsPlanModeExitAttachment()) {
      const planFilePath = this.permissionManager.getPlanFilePath();
      const planExists = planFilePath ? existsSync(planFilePath) : false;
      this.messageManager.addUserMessage({
        content: buildExitedPlanModeReminder(planFilePath, planExists),
        isMeta: true,
      });
      this.permissionManager.setNeedsPlanModeExitAttachment(false);
    }

    if (currentMode !== "plan") return;

    const planFilePath = this.permissionManager.getPlanFilePath();
    if (!planFilePath) return;

    const planExists = existsSync(planFilePath);

    // One-time plan entry reminder
    const planMgr = this.planManager;
    if (planMgr?.isPlanEntryReminderPending()) {
      if (this.permissionManager.hasExitedPlanModeInSession() && planExists) {
        // Re-entry: use small reminder
        this.messageManager.addUserMessage({
          content: buildPlanModeReEntryReminder(planFilePath),
          isMeta: true,
        });
      } else {
        // First entry: use full reminder
        this.messageManager.addUserMessage({
          content: buildPlanModeReminder(
            planFilePath,
            planExists,
            !!this.subagentType,
          ),
          isMeta: true,
        });
      }
      planMgr.consumePlanEntryReminder();
    }
  }

  private async maybeGetTaskReminderText(
    declaredToolNames: Set<string>,
  ): Promise<string | null> {
    // Guard: no task tools available. Reachability, not declaration — a deferred
    // tool is absent from `tools[]` yet callable from the sandbox, so reading the
    // declarations alone would silence the reminder for every pooled tool (see
    // `docs/specs/core/repl-tool.md`). The channel is optional, same as the catalog
    // announcement's guard: a host or test double without it means "no sandbox",
    // not "the pool is gone".
    const sandboxToolNames =
      typeof this.toolManager?.getOnDemandToolNames === "function"
        ? (this.toolManager.getOnDemandToolNames() ?? [])
        : [];
    if (
      !declaredToolNames.has(TASK_UPDATE_TOOL_NAME) &&
      !sandboxToolNames.includes(TASK_UPDATE_TOOL_NAME)
    ) {
      return null;
    }

    const internalMessages = this.messageManager.getMessages();
    const turnCounts = getTaskReminderTurnCounts(internalMessages);

    if (
      turnCounts.turnsSinceLastTaskManagement <
        TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE ||
      turnCounts.turnsSinceLastReminder <
        TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
    ) {
      return null;
    }

    const tasks = await this.taskManager.listTasks();
    return maybeInjectTaskReminder(turnCounts, tasks);
  }

  public setIsLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
    this.onLoadingChange?.(isLoading);
    const options =
      this.container.get<import("../types/agent.js").AgentOptions>(
        "AgentOptions",
      );
    options?.callbacks?.onLoadingChange?.(isLoading);
  }

  public abortAIMessage(): void {
    // Bump generation so the in-flight turn's end-of-turn setIsLoading(false)
    // is skipped (generation mismatch), preventing it from racing with this abort.
    this.turnGeneration++;

    // Interrupt AI service
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (error) {
        logger?.error("Failed to abort AI service:", error);
      }
    }

    // Interrupt tool execution
    if (this.toolAbortController) {
      try {
        this.toolAbortController.abort();
      } catch (error) {
        logger?.error("Failed to abort tool execution:", error);
      }
    }

    this.setIsLoading(false);
  }

  /**
   * 收掉某一轮（`$.turn.abort`，spec「收掉一轮」）。
   *
   * 与用户按 Esc 同一条路（`abortAIMessage`）：打断正在跑的请求、停掉还没跑完
   * 的工具，**不动**排队等着的用户消息，也不碰 Bash 命令与斜杠命令（它们不是
   * 这一轮的一部分）。
   *
   * `turnId` 对不上、或者这一刻没有一轮在跑，都抛错 —— 宿主必须让插件看见「我
   * 没叫停」。
   */
  public abortTurn(turnId: string): void {
    const running = this.currentTurnId;
    if (running === undefined) {
      throw new Error(
        `没有正在跑的一轮，$.turn.abort(${turnId}) 无处可收（turnId 来自 turn.start）`,
      );
    }
    if (running !== turnId) {
      throw new Error(
        `$.turn.abort 的 turnId 对不上：给的是 ${turnId}，正在跑的是 ${running}`,
      );
    }
    this.abortAIMessage();
  }

  // Helper method to generate compactParams
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string {
    try {
      const toolPlugin = this.toolManager
        .list()
        .find((plugin) => plugin.name === toolName);
      if (toolPlugin?.formatCompactParams) {
        const context: ToolContext = {
          workdir: this.getCurrentWorkdir(),
          originalWorkdir: this.originalWorkdir,
          taskManager: this.taskManager,
        };
        return toolPlugin.formatCompactParams(toolArgs, context);
      }
    } catch (error) {
      logger?.warn("Failed to generate compactParams", error);
    }
    return "";
  }

  // Private method to update the displayed token statistics from a response.
  // Uses only total_tokens — OpenAI-compatible usage already includes cache
  // hits there, so adding cache fields would double-count and show an
  // inflated context percentage. Same semantics as the auto-compaction
  // threshold (maybeAutoCompactBeforeRequest), keeping display and
  // compaction judgment consistent.
  private updateLatestTotalTokens(usage: Usage | undefined): void {
    if (!usage) return;

    // Update token statistics - display total_tokens (cache fields excluded)
    this.messageManager.setlatestTotalTokens(usage.total_tokens);
  }

  /**
   * Pre-request auto-compaction check (aligned with Claude Code's
   * autoCompactIfNeeded). Runs before every API request is issued: estimates
   * the context that is about to be sent (last response's total_tokens plus
   * character estimates for newer messages) and compacts first once it
   * crosses the auto-compaction threshold — the context window minus the
   * summary output reservation minus a safety buffer, not the window itself.
   * The reservation matters because the compaction call is itself a request
   * whose input plus declared max_tokens must fit the same shared window.
   * Only total_tokens is used — under OpenAI-compatible usage it already
   * includes cache hits, the system prompt, the tool schema and injected
   * memory; adding any of those on top would double-count and fire early.
   * Fork paths (compaction / auto-memory) never reach here: they run in
   * runForkLoop, not sendAIMessage.
   */
  private async maybeAutoCompactBeforeRequest(
    abortController: AbortController,
  ): Promise<boolean> {
    // Circuit breaker: skip compaction after 3 consecutive failures
    if (this.consecutiveCompactionFailures >= 3) {
      logger?.warn(
        `Skipping compaction: ${this.consecutiveCompactionFailures} consecutive failures`,
      );
      return false;
    }

    const messages = this.messageManager.getMessages();
    if (messages.length === 0) return false;

    const contextWindow = this.getContextWindow();
    const maxOutputTokens = this.configurationService.resolveMaxOutputTokens();
    const threshold = getAutoCompactThreshold(contextWindow, maxOutputTokens);
    const estimatedTokens = estimateContextTokens(messages);
    if (estimatedTokens >= threshold) {
      logger?.debug(
        `Estimated request tokens ${estimatedTokens} reached ${threshold}, compacting before request...`,
      );
      await this.compactConversation({
        abortSignal: abortController.signal,
        trigger: "auto",
      });
      return true;
    }
    return false;
  }

  /**
   * Manually compact the conversation history.
   * Called by /compact slash command or auto-compaction trigger.
   */
  public async compactConversation(
    options: {
      customInstructions?: string;
      abortSignal?: AbortSignal;
      /** Who asked: the pre-request threshold (`auto`) or `/compact` (`manual`). */
      trigger?: "auto" | "manual";
    } = {},
  ): Promise<void> {
    const messagesToCompact = this.messageManager.getMessages();
    if (messagesToCompact.length === 0) {
      logger?.debug("No messages to compact");
      return;
    }
    // Reported to the mods once the summary replaces the history (spec
    // ecosystem/plugin-mods.md「轮次内外的事件」).
    const tokensBefore = estimateContextTokens(messagesToCompact);
    const trigger = options.trigger ?? "manual";

    // Circuit breaker: skip if already compacting
    if (this.isCompacting) {
      logger?.warn("Compaction already in progress");
      return;
    }

    // 影子事件 `classic.PreCompact`（spec「影子事件」）：压缩真的开始之前报一次
    // —— 与 `classic.PostCompact` 配对，插件据此在压缩前后各取一次快照（状态带
    // 上「正在压缩…」就是这么来的）。被上面的断路器挡掉的那次不报：什么都没发
    // 生，报一个开始会让等 `PostCompact` 的插件永远悬着。
    if (!this.subagentType) {
      this.getModManager()?.notifyMods("classic.PreCompact", {
        trigger,
        custom_instructions: options.customInstructions ?? null,
      });
    }

    // 压缩绑定发起时的会话：LLM fork 期间用户可能已把 agent 原地切到另一会话
    // （IDE「历史对话」restoreSession / CLI 与插件 `/clear` 都会换 sessionId，
    // 且均不被 isCompacting 阻拦）。写入阶段前必须复核，否则摘要块会追加进
    // 切换后会话的内存列表并持久化进其转录文件（spec message-compact「压缩
    // 期间的会话保护」；PM 缺陷 3478352534577408）。
    const sessionIdAtStart = this.messageManager.getSessionId();

    // 1. Run PreCompact hooks
    let hookInstructions: string | undefined;
    if (this.hookManager) {
      try {
        const preResult = await this.hookManager.executePreCompactHooks(
          this.messageManager.getSessionId(),
          this.messageManager.getTranscriptPath(),
          options.customInstructions,
        );
        hookInstructions = preResult.additionalInstructions;
      } catch (error) {
        logger?.warn(`PreCompact hooks failed: ${(error as Error).message}`);
      }
    }

    // 2. Merge custom instructions
    const mergedInstructions =
      [options.customInstructions, hookInstructions]
        .filter(Boolean)
        .join("\n") || undefined;

    // 3. Save session before compaction
    await this.messageManager.saveSession();

    this.setIsCompacting(true);
    try {
      const modelConfig = this.getModelConfig();
      const recentChatMessages = await convertMessagesForAPI(
        messagesToCompact,
        {
          supportsVision: supportsVision(modelConfig.capabilities),
          reasoningSignatures:
            resolveApiType(modelConfig.capabilities) === "messages",
        },
      );
      const compactPrompt = getCompactPrompt(mergedInstructions);

      // 4. Fork path: fork the conversation with the same system prompt,
      // tools, model, and generation params as the main loop so the forked
      // request prefix matches exactly and the prompt cache is reused.
      //
      // Both compaction channels leave the SDK as deltas — every consumer (CLI,
      // the four hosts, the remote page behind them) appends them, and a frame
      // that re-sent the whole tail would grow with the already-streamed length
      // (spec: ui/stdio-transport.md「流式通知纯增量负载」场景 7). The delta is
      // taken straight from the stream (`onContentDelta` / `onReasoningDelta`),
      // not diffed here: this path never holds the accumulated text anywhere, so
      // there is nothing to diff against.
      //
      // Reasoning joins the same tail: no host implements
      // `onCompactionReasoningUpdate`, so the fork loop's fallback routes
      // reasoning deltas into the content channel, and the tail shows thinking
      // followed by the summary — the shape this indicator has always had.
      const forkResult = await this.runCompactFork(
        recentChatMessages,
        compactPrompt,
        options.abortSignal,
        {
          onContentDelta: this.callbacks?.onCompactionContentUpdate,
          onReasoningDelta: this.callbacks?.onCompactionReasoningUpdate,
        },
      );
      const summaryContent = forkResult.content;
      const compactTokens = forkResult.usage;
      if (!summaryContent) {
        throw new Error(
          "Compaction failed: the model produced no summary output",
        );
      }
      const compactModel = modelConfig.model;

      // 5. Handle usage tracking
      let compactUsage: Usage | undefined;
      if (compactTokens) {
        compactUsage = {
          ...compactTokens,
          model: compactModel,
          operation_type: "compact",
        };
      }

      // 6. Strip the <analysis> scratchpad and extract the <summary> body
      const formattedSummary = formatCompactSummary(summaryContent);

      // 7. Build post-compact context restoration
      const enhancedSummary =
        await this.buildPostCompactContext(formattedSummary);

      // 8. Execute message reconstruction — only if the session is still the
      // one this compaction started for. Abandoning here skips the entire
      // write phase (summary append, post-compact context restore, plan-mode
      // reminder, SessionStart/PostCompact hooks); the spent LLM call is not
      // recovered and the original session simply stays uncompacted.
      if (this.messageManager.getSessionId() !== sessionIdAtStart) {
        logger?.warn(
          `Compaction abandoned: session switched from ${sessionIdAtStart} to ${this.messageManager.getSessionId()} while the summary was being generated`,
        );
        return;
      }
      await this.messageManager.compactMessagesAndUpdateSession(
        enhancedSummary,
        compactUsage,
      );

      // Clear readFileState after compaction (aligned with Claude Code's
      // compact flow): the entries outlive the transcript that justified them.
      // The cached content is the diff baseline for the changed-files reminder,
      // and the entries double as the "already in context" check that suppresses
      // re-injecting nested AGENTS.md — both reference reads that were just
      // folded away, so they would silently lose or misattribute content.
      this.readFileState.clear();

      // Re-add plan mode reminder as persistent meta message after compaction
      const postCompactMode = this.permissionManager?.getCurrentEffectiveMode(
        this.getModelConfig().permissionMode,
      );
      if (postCompactMode === "plan") {
        const planFilePath = this.permissionManager?.getPlanFilePath();
        if (planFilePath) {
          const planExists = existsSync(planFilePath);
          this.messageManager.addUserMessage({
            content: buildPlanModeReminder(
              planFilePath,
              planExists,
              !!this.subagentType,
            ),
            isMeta: true,
          });
        }
      }

      // 9. Track usage
      this.recordTurnOutputTokens(compactUsage);
      if (compactUsage && this.callbacks?.onUsageAdded) {
        this.callbacks.onUsageAdded(compactUsage);
      }

      this.consecutiveCompactionFailures = 0;

      // Tell the mods the history was compacted (spec ecosystem/plugin-mods.md
      // 「轮次内外的事件」). Fires only after the summary actually replaced the
      // messages; the abandoned-write path above (session switched) returns
      // without it.
      if (!this.subagentType) {
        this.getModManager()?.notifyMods("session.compact", {
          trigger,
          tokensBefore,
          // `tokensAfter` 只数新历史的消息文本：压缩刚结束还没有任何实测 usage，
          // 这个数回答的就是「留下的上下文正文有多大」——它天然小于
          // `tokensBefore`（后者还含系统提示词、工具 schema）。`estimateContextTokens`
          // 现在已经按压缩边界取锚点（折表也剥掉了保留轮次的旧 usage），它在这里
          // 会退化成同一个文本估算；仍写成显式的一次估算，免得日后锚点规则再变
          // 时把这个事件字段带偏。
          tokensAfter: roughTokenCountForMessages(
            this.messageManager.getMessages(),
          ),
        });
        // 影子事件 `classic.PostCompact`（spec「影子事件」）：与 `session.compact`
        // 同一时刻（摘要已经替换了历史），载荷是 CC 那一份 —— `trigger` 与压缩后
        // 写回历史的那段摘要正文。
        this.getModManager()?.notifyMods("classic.PostCompact", {
          trigger,
          compact_summary: enhancedSummary,
        });
      }

      // Reset content-event dedupe after compaction: the next request's
      // context is a new shape and should be re-reported.
      resetContentEventState();

      // 10. Log OTEL event
      logOTelEvent(
        "compaction",
        {
          beforeTokens: String(messagesToCompact.length),
          afterTokens: "1",
          model: compactModel,
        },
        {
          sessionId: sessionIdAtStart,
          workdir:
            this.container.get<string>("SessionWorkdir") ??
            this.originalWorkdir,
          entrypoint: entrypointOf(this.container),
        },
      ).catch(() => {});

      // 11. Run SessionStart hooks (existing behavior)
      if (this.hookManager) {
        try {
          const newSessionId = this.messageManager.getSessionId();
          const sessionStartResult =
            await this.hookManager.executeSessionStartHooks(
              "compact",
              newSessionId,
              this.messageManager.getTranscriptPath(),
              this.messageManager,
              this.subagentType,
            );
          if (sessionStartResult.additionalContext) {
            // `prompt.attachment` 的 `session-start` 档（spec「系统提示词与附
            // 件」）：SessionStart 钩子塞进来的附加上下文，插件可改可压。
            const sessionStartText = await this.rewriteAttachment(
              "session-start",
              `SessionStart hook additional context: ${sessionStartResult.additionalContext}`,
            );
            // The head copy was folded into the summary, so the list no longer
            // holds it and this injection lands again (Claude Code behaves the
            // same after auto-compaction).
            if (sessionStartText !== null) {
              this.messageManager.addMetaMessageIfAbsent(
                wrapInSystemReminder(sessionStartText),
              );
            }
          }
          // `initialUserMessage` 不注入：压缩不是会话起点（对话早有第一轮），
          // Claude Code 把这个字段定为非交互 `-p` 模式专用。`additionalContext`
          // 才是压缩后重注的正经用途，保持原样。
        } catch (error) {
          logger?.warn(
            `SessionStart hooks on compact failed: ${(error as Error).message}`,
          );
        }
      }

      // 12. Run PostCompact hooks
      if (this.hookManager) {
        try {
          await this.hookManager.executePostCompactHooks(
            this.messageManager.getSessionId(),
            this.messageManager.getTranscriptPath(),
            formattedSummary,
          );
        } catch (error) {
          logger?.warn(`PostCompact hooks failed: ${(error as Error).message}`);
        }
      }

      logger?.debug(
        `Successfully compacted ${messagesToCompact.length} messages`,
      );
    } catch (compactError) {
      this.consecutiveCompactionFailures++;
      logger?.error(
        `Failed to compact messages (${this.consecutiveCompactionFailures} consecutive): ${compactError instanceof Error ? compactError.message : String(compactError)}`,
      );
      // 会话已被切走时错误块同样不得写进切换后的会话（与上面的写入放弃同口径）
      if (this.messageManager.getSessionId() === sessionIdAtStart) {
        this.messageManager.addNoticeBlock(
          `Failed to compact conversation history: ${compactError instanceof Error ? compactError.message : String(compactError)}. You may encounter context limit issues.`,
          "error",
        );
      }
    } finally {
      this.setIsCompacting(false);
    }
  }

  /**
   * The options `buildSystemPromptSections()` needs for this turn.
   *
   * Split out from {@link buildMainSystemPrompt} because the token estimate in
   * `getContextBreakdown()` needs the same options without asking any mod
   * (that read is a diagnostic, not a request — `prompt.compose` is defined as
   * once per turn).
   */
  private async resolveSystemPromptOptions(): Promise<SystemPromptOptions> {
    let autoMemoryOptions: { directory: string; content: string } | undefined;

    if (this.getAutoMemoryEnabled()) {
      const directory = this.memoryService.getAutoMemoryDirectory(
        this.getCurrentWorkdir(),
      );
      const content = await this.memoryService.getAutoMemoryContent(
        this.getCurrentWorkdir(),
      );
      autoMemoryOptions = { directory, content };
    }

    return {
      workdir: this.getCurrentWorkdir(),
      originalWorkdir: this.getOriginalWorkdir(),
      language: this.getLanguage(),
      isSubagent: !!this.subagentType,
      worktreeSession: this.getWorktreeSession(),
      additionalWorkingDirectories:
        this.permissionManager?.getEffectiveAdditionalDirectories?.() ?? [],
      autoMemory: autoMemoryOptions,
      leanPrompt: isLeanPromptEnabled(this.getCurrentWorkdir()),
    };
  }

  /**
   * Build the system prompt used by the main agent loop. Extracted so the
   * compaction fork can mirror it exactly — the forked request prefix must
   * match the main conversation's for the prompt cache to be reused.
   *
   * This is where `prompt.compose` / `prompt.section` land (spec
   * ecosystem/plugin-mods.md「系统提示词与附件」): the host builds the named
   * sections, mods get `prompt.compose` once per turn to settle the table, then
   * every section goes through `prompt.section` — `null` drops it. Without a
   * ModManager both hooks are skipped and the sections are joined as-is, so a
   * prompt nobody rewrote stays byte-identical.
   */
  private async buildMainSystemPrompt(
    reachableToolPlugins: ReturnType<ToolManager["getTools"]>,
  ) {
    const sections = buildSystemPromptSections(
      this.systemPrompt,
      reachableToolPlugins,
      await this.resolveSystemPromptOptions(),
    );

    const mods = this.getModManager();
    if (!mods) return buildSystemPromptBlocks(sections);

    // 一轮一次（见 `promptModsCache`）：基底没变就复用这一轮已经问过的结果。
    const turnId = this.currentTurnId;
    const signature = sections
      .map((section) => `${section.id}\u0000${section.text}`)
      .join("\u0001");
    const cached = this.promptModsCache;
    if (
      turnId &&
      cached &&
      cached.turnId === turnId &&
      cached.signature === signature
    ) {
      return buildSystemPromptBlocks(cached.sections);
    }

    const composed = await mods.collectPromptSections(sections);
    const applied: ModPromptSection[] = [];
    for (const section of composed) {
      const text = await mods.collectPromptSection(section);
      // `null` means "this section should not appear" — not an empty string in
      // its place (spec 验收场景 2).
      if (text === null) continue;
      applied.push({ id: section.id, text, scope: section.scope });
    }
    if (turnId) this.promptModsCache = { turnId, signature, sections: applied };
    return buildSystemPromptBlocks(applied);
  }

  /**
   * Announce the connected MCP servers' own usage notes in the conversation,
   * once per server. Not part of the system prompt: this content appears when a
   * connection happens, and rewriting the system prompt mid-session would drop
   * the whole cached prefix (see `utils/mcpInstructions.ts`).
   */
  private maybeAnnounceMcpInstructions(): void {
    const mcpManager = this.mcpManager;
    // Optional for the same reason as `getEffectiveAdditionalDirectories` above:
    // hosts and tests register partial McpManager doubles, and a missing
    // usage-notes channel is not a reason to fail the turn. Bailing out matters
    // more here than elsewhere — reading an absent manager as "no servers left"
    // would announce every previously announced server as disconnected.
    if (!mcpManager || typeof mcpManager.getServerInstructions !== "function") {
      return;
    }

    const available = mcpManager.getServerInstructions(
      (toolName) => this.permissionManager?.isToolDenied?.(toolName) === true,
    );
    // Servers that are merely slow are neither available nor gone. Without this
    // third bucket a server still dialing would be announced as departed and
    // announced again moments later when it connects — the very "已下线" the
    // user saw for a server that was only waiting on its notification stream.
    // Same exclusion as Claude Code's `pending` (`0766:115797-115799`).
    const pending =
      typeof mcpManager.getPendingServerNames === "function"
        ? new Set(mcpManager.getPendingServerNames())
        : new Set<string>();
    const announced = collectAnnouncedServers(
      this.messageManager.getMessages(),
    );
    const availableNames = new Set(available.map((server) => server.name));

    const text = buildMcpInstructionsAnnouncement({
      added: available.filter((server) => !announced.has(server.name)),
      removed: Array.from(announced).filter(
        (name) => !availableNames.has(name) && !pending.has(name),
      ),
    });
    if (!text) return;

    this.messageManager.addUserMessage({
      content: wrapInSystemReminder(text),
      isMeta: true,
    });
  }

  /**
   * Announce the on-demand tool pool in the conversation, whenever it differs from
   * the last announcement. Keeping it out of the REPL's description is what makes
   * that declaration a constant: a server connecting would otherwise rewrite
   * `tools[]`, which sits in the cached prefix (see `repl/catalogAnnouncement.ts`).
   *
   * The pool goes out as entries, not as names: the announcement's first tier is a
   * signature block selected by `tier === "core"`, and a bare name cannot carry a
   * schema. Names alone would demote the seven core tools to the name-only tier,
   * i.e. every new session's first script would start with a search.
   */
  private maybeAnnounceReplCatalog(): void {
    const toolManager = this.toolManager;
    // Optional for the same reason as `maybeAnnounceMcpInstructions` above, and it
    // matters just as much here: reading an absent channel as "the pool is gone"
    // would tell the model to stop using every tool an earlier announcement named.
    if (!toolManager || typeof toolManager.getOnDemandPool !== "function")
      return;

    const text = buildReplCatalogAnnouncement(
      collectReplCatalogState(this.messageManager.getMessages()),
      toolManager.getOnDemandPool(),
    );
    if (!text) return;

    this.messageManager.addUserMessage({
      content: wrapInSystemReminder(text),
      isMeta: true,
    });
  }

  /**
   * Deliver the outcomes of background REPL scripts, and say what is still running.
   *
   * A script that outlived its wait window answered `(dispatched #N)`, so its result
   * has no reply to ride on: it waits in the runtime's queue until somebody reads it.
   * Two readers exist and they share the queue, which is what keeps any outcome from
   * arriving twice — `Poll` (the model asks) and this (the next turn arrives first).
   *
   * Both forms are meta messages at the tail, never in the system prompt: the queue
   * changes every time a script settles, and the cached prefix is no place for a
   * value that moves. The status line is a single self-closing element carrying the
   * count — a model that sees `pending` knows a `Poll` has something to answer with.
   */
  private maybeAnnounceReplEvents(): void {
    const settled = drainReplEvents();
    for (const event of settled) {
      this.messageManager.addUserMessage({
        content: wrapInSystemReminder(renderReplEvent(event)),
        isMeta: true,
      });
    }

    if (listRunningReplScripts().length > 0) {
      this.messageManager.addUserMessage({
        content: wrapInSystemReminder(renderReplStatus()),
        isMeta: true,
      });
    }
  }

  /**
   * The key this agent's REPL context is filed under, as of right now.
   *
   * The session half is read fresh: `/clear` and session resume replace it, and a
   * key computed once would then point at a context nobody owns.
   */
  public replContextKey(): string {
    return replSessionKey(
      this.messageManager.getSessionId() ?? "local",
      this.replAgentSlot,
    );
  }

  /**
   * Release this agent's REPL context: its variables, its timers, and any script it
   * left running in the background.
   *
   * Called when the conversation stops existing (`/clear`, a session switch) and
   * when the agent itself goes away (`destroy`, which is also how a subagent's
   * context is dropped). Never on compaction — that rewrites the history, not the
   * runtime — and never on an abort, which is why a context survives an interrupt.
   */
  public releaseReplContext(): void {
    disposeReplRuntime(this.replContextKey());
  }

  /**
   * Announce the available-skill list as a meta message.
   *
   * The list is deliberately not in the `Skill` tool description: the skill set
   * changes mid-session (watcher refresh, plugin reload, subtree discovery) and
   * the description sits in the cached `tools[]` prefix, so inlining it would
   * rewrite that prefix on every change. See `utils/skillListing.ts` for the
   * marker/hash protocol that keeps this from re-announcing every turn.
   */
  private maybeAnnounceSkillListing(): void {
    const skillManager = this.skillManager;
    if (!skillManager) return;

    let skills;
    try {
      skills = skillManager.getAvailableSkills();
    } catch {
      // Not initialized yet: an absent list must not read as "no skills".
      return;
    }

    // Same visibility rules the inline description used to apply: a skill the
    // model may not invoke is not listed, and a fork-context skill is not
    // offered to a subagent (it would need a subagent of its own).
    const eligible = skills.filter(
      (skill) =>
        !skill.disableModelInvocation &&
        (!this.subagentType || skill.context !== "fork"),
    );

    const charBudget = resolveSkillListingCharBudget(this.getContextWindow());

    const text = buildSkillListingAnnouncement(
      collectSkillListingState(this.messageManager.getMessages()),
      eligible,
      charBudget,
    );
    if (!text) return;

    this.messageManager.addUserMessage({
      content: wrapInSystemReminder(text),
      isMeta: true,
    });
  }

  /**
   * Announce the available-subagent list as a meta message.
   *
   * Same reason as the skill listing above, with a trigger that fires more
   * often: the subagent set follows MCP connections, plugin reloads and
   * permission rules, and the `Agent` description it used to live in sits in
   * the cached `tools[]` prefix. See `utils/agentListing.ts` for the
   * marker/hash protocol.
   */
  private async maybeAnnounceAgentListing(): Promise<void> {
    const subagentManager = this.subagentManager;
    if (!subagentManager) return;

    let configs;
    try {
      configs = subagentManager.getConfigurations();
    } catch {
      // Not initialized yet: an absent list must not read as "no subagents".
      return;
    }

    // `agent.offer` (spec「派子代理」): this announcement is the listing moment,
    // the other one being the Agent tool's own dispatch. A plugin hides a type
    // here by answering `{ isOffered: false }`, and the tool refuses to spawn it
    // too — the two moments share one event.
    const modManager = this.getModManager();
    if (modManager) {
      const offered = await Promise.all(
        configs.map((config) =>
          modManager.dispatchAgentOffer({
            agent: config.name,
            description: config.description,
            source: config.scope === "builtin" ? "built-in" : config.scope,
          }),
        ),
      );
      configs = configs.filter((_, index) => offered[index]);
    }

    const charBudget = resolveAgentListingCharBudget(this.getContextWindow());

    const text = buildAgentListingAnnouncement(
      collectAgentListingState(this.messageManager.getMessages()),
      configs,
      charBudget,
    );
    if (!text) return;

    this.messageManager.addUserMessage({
      content: wrapInSystemReminder(text),
      isMeta: true,
    });
  }

  /**
   * Resolve the subtree paths recorded by Read/Write/Edit into skill roots and
   * load whatever they hold.
   *
   * Runs before the listing announcement so a skill discovered in this turn is
   * in the list carried by this turn's request — otherwise it would take one
   * extra round-trip to become visible, and a model that just walked into a
   * subsystem should see that subsystem's skills immediately.
   */
  private async maybeDiscoverNestedSkills(): Promise<void> {
    const skillManager = this.skillManager;
    const consumeTriggers = this.messageManager.consumeSkillDiscoveryTriggers;
    // Both ends of the trigger queue are optional from the turn loop's point of
    // view: a manager double, or a host assembling its own message sink, has no
    // queue to drain. Same rule as the other announcement channels — a feature
    // that is not wired up must not take the turn down.
    if (
      !skillManager ||
      typeof skillManager.discoverNestedSkills !== "function" ||
      typeof consumeTriggers !== "function"
    ) {
      return;
    }
    const filePaths = consumeTriggers.call(this.messageManager);
    if (filePaths.length === 0) return;
    try {
      await skillManager.discoverNestedSkills(filePaths);
    } catch (error) {
      logger?.warn("Failed to discover subtree skills:", error);
    }
  }

  /**
   * Persist "the user named this subagent" as a meta message, next to the task /
   * changed-files reminders and for the same reason: it belongs in the cached
   * prefix, not in a payload rebuilt per model call.
   *
   * The scan that feeds this runs on `turnOffset === 0` of every turn, so a
   * retried turn re-reads the same user message; the identical-text check keeps
   * the reminder from stacking. A failed configuration read degrades to "no
   * subagents available" — the reminder then says the name did not match, which
   * is still better than throwing away the turn.
   *
   * This is the `agent_mention` slot of `prompt.attachment` (spec
   * ecosystem/plugin-mods.md「系统提示词与附件」): a mod can rewrite the
   * reminder or drop it with `{ text: null }`. The name is CC's, underscore
   * included — a plugin filtering on the real type gets nothing otherwise.
   */
  private async injectAgentMentionReminder(
    mentionedAgents: string[],
  ): Promise<void> {
    let availableNames: string[] = [];
    try {
      availableNames = (this.subagentManager?.getConfigurations() ?? []).map(
        (configuration) => configuration.name,
      );
    } catch {
      availableNames = [];
    }

    const text = buildAgentMentionReminder(mentionedAgents, availableNames);
    if (!text) return;

    const attachment = await this.rewriteAttachment("agent_mention", text);
    if (attachment === null) return;

    const wrapped = wrapInSystemReminder(attachment);
    const alreadyInjected = this.messageManager
      .getMessages()
      .some((message) =>
        message.blocks.some(
          (block) => block.type === "text" && block.content === wrapped,
        ),
      );
    if (alreadyInjected) return;

    this.messageManager.addUserMessage({ content: wrapped, isMeta: true });
  }

  /**
   * 拼 `tools[]` 之前先把 `tool.describe` 问定（描述与放置）。
   *
   * 与 CC 的 `resolveToolDescription` 同一个时机：`await` 完再组装，所以插件给
   * 的新描述、新放置**这次请求**就生效，不是下一次。问过就锁住，稳态下每场会话
   * 只多这一次等待。
   *
   * 可选通道：宿主或测试替身没有这个方法，就等于「没有插件要问」。
   * `/context` 的估算刻意不走这里 —— 那是诊断读数，不是发请求。
   */
  private async prepareToolDescriptions(): Promise<void> {
    if (typeof this.toolManager?.prepareToolDescriptions !== "function") return;
    await this.toolManager.prepareToolDescriptions();
  }

  /**
   * The tool set the system prompt is built from, plus the declaration set the
   * request carries. Two different questions, deliberately answered separately:
   *
   * - `toolNames` (declarations, i.e. `tools[]`) answers "what does the model see
   *   declared" and is what the request payload needs.
   * - `reachableToolPlugins` answers "what can this session call" and is what
   *   `# Using your tools` gates its entries on. Reachability, not declaration: a
   *   deferred tool is absent from `tools[]` yet callable from the sandbox, so
   *   gating that section on declarations alone silently drops its guidance line
   *   (e.g. the TaskCreate entry; see `docs/specs/core/repl-tool.md`).
   */
  private resolveFilteredTools() {
    const toolsConfig = this.getFilteredToolsConfig();
    const toolNames = new Set(toolsConfig.map((t) => t.function.name));
    // Same optional-channel rule as the catalog announcement: a host or test
    // double without `getOnDemandToolNames` means "no sandbox", not "pool gone".
    const onDemandToolNames =
      typeof this.toolManager?.getOnDemandToolNames === "function"
        ? (this.toolManager.getOnDemandToolNames() ?? [])
        : [];
    const reachableNames = new Set([...toolNames, ...onDemandToolNames]);
    const reachableToolPlugins = this.toolManager
      .getTools()
      .filter((t) => reachableNames.has(t.name));
    return { toolsConfig, toolNames, reachableToolPlugins };
  }

  /**
   * Fork-path loop: run a bounded agent loop over a copy of the conversation
   * using the same system prompt, tools, model, and generation params as the
   * main loop, so the forked request prefix matches exactly and the prompt
   * cache is reused. A `canUseTool` gate decides whether each tool call
   * executes locally (with a stripped context) or is denied and fed back to
   * the model for another turn. Returns undefined content when the model never
   * produces text; the caller treats that as a failure.
   */
  private async runForkLoop(
    historyMessages: ChatCompletionMessageParam[],
    prompt: string,
    options: {
      maxTurns: number;
      /** Gate deciding which tool calls execute locally. When undefined, every tool call is denied. */
      canUseTool?: (name: string, args: Record<string, unknown>) => boolean;
      /** Message fed back to the model when a tool call is denied. */
      deniedToolMessage?: string;
      /** Surface partial output to the caller (e.g. the compaction loading
       * tail) as it streams in. The fragments are pure deltas. Reasoning chunks
       * go to the reasoning channel when the caller supplies one, otherwise
       * they fall back to the content channel (so a caller listening on one
       * channel still sees a single tail carrying both). */
      onContentDelta?: (delta: string) => void;
      onReasoningDelta?: (delta: string) => void;
    },
    abortSignal?: AbortSignal,
  ): Promise<ForkLoopResult> {
    const modelConfig = this.getModelConfig();
    const gatewayConfig = this.getGatewayConfig();
    const sessionId = this.messageManager.getSessionId();
    const workdir = this.getCurrentWorkdir();

    const forkMessages: ChatCompletionMessageParam[] = [...historyMessages];

    // Mirror the main loop's memory injection so the request prefix matches.
    const { prependContent } =
      await this.messageManager.getMemoryForInjection();
    // `prompt.attachment` 的 `memory` 档（spec「系统提示词与附件」）：AGENTS.md
    // 与用户记忆走的就是这一条，插件可以改也可以压掉。
    const memoryAttachment = await this.rewriteAttachment(
      "memory",
      prependContent,
    );
    if (memoryAttachment?.trim()) {
      forkMessages.unshift({
        role: "user",
        content: wrapInSystemReminder(memoryAttachment),
      });
    }

    forkMessages.push({ role: "user", content: prompt });

    await this.prepareToolDescriptions();
    const { toolsConfig, reachableToolPlugins } = this.resolveFilteredTools();
    const systemPrompt = await this.buildMainSystemPrompt(reachableToolPlugins);

    // Clone the parent session's read state so the fork inherits the read/dedup
    // baseline (aligned with Claude Code's cloneFileStateCache): the fork can
    // Edit a file the parent already read without re-reading it first. The
    // clone is an independent Map with copied entries, so reads/writes inside
    // the fork never leak back into the main session's dedup and staleness
    // tracking.
    const forkReadFileState: ReadFileState = new Map(
      Array.from(this.readFileState, ([path, entry]) => [path, { ...entry }]),
    );

    // Whether this fork speaks the native Messages protocol. Its history is
    // handed over as a flat array instead of being rebuilt from blocks, so the
    // thinking-block signatures have to be carried on the assistant messages
    // this loop appends itself.
    const forkApiType = resolveApiType(modelConfig.capabilities);

    let totalUsage: ForkLoopResult["usage"];
    let content: string | undefined;

    for (let turn = 0; turn < options.maxTurns; turn++) {
      const result = await aiService.callAgent({
        gatewayConfig,
        modelConfig,
        messages: forkMessages,
        sessionId,
        abortSignal,
        workdir,
        tools: toolsConfig,
        systemPrompt,
        maxTokens: this.configurationService.resolveMaxOutputTokens(),
        toolChoice: this.toolChoiceOverride,
        // Stream so a slow reasoning model emits first bytes before the
        // gateway's idle timeout fires (non-streaming waits for the full
        // response, which exceeds the timeout on large contexts).
        stream: true,
        // Surface partial output to the caller (e.g. the compaction loading
        // tail) as it arrives. Deltas are forwarded straight through; reasoning
        // from thinking models rides the reasoning channel when the caller
        // supplies one and otherwise falls back to the content channel (so a
        // reasoning-only caller still sees one tail with both).
        onContentDelta: (delta: string) => {
          if (delta.trim()) {
            options.onContentDelta?.(delta);
          }
        },
        onReasoningDelta: (delta: string) => {
          if (delta.trim()) {
            if (options.onReasoningDelta) {
              options.onReasoningDelta(delta);
            } else {
              options.onContentDelta?.(delta);
            }
          }
        },
      });

      if (result.usage) {
        totalUsage = {
          prompt_tokens:
            (totalUsage?.prompt_tokens ?? 0) + result.usage.prompt_tokens,
          completion_tokens:
            (totalUsage?.completion_tokens ?? 0) +
            result.usage.completion_tokens,
          total_tokens:
            (totalUsage?.total_tokens ?? 0) + result.usage.total_tokens,
        };
      }

      if (result.content?.trim()) {
        content = result.content;
        break;
      }

      if (result.tool_calls && result.tool_calls.length > 0) {
        const functionCalls = result.tool_calls.filter(
          (tc) => tc.type === "function",
        );
        if (functionCalls.length === 0) break;

        forkMessages.push({
          role: "assistant",
          content: result.content ?? null,
          tool_calls: functionCalls,
          // A thinking-enabled tool-use turn must be replayed with its thinking
          // blocks; only the Messages endpoint accepts (and needs) the field.
          ...(forkApiType === "messages" && result.thinking_blocks
            ? { anthropic_thinking: result.thinking_blocks }
            : {}),
        } as ChatCompletionMessageParam);

        for (const toolCall of functionCalls) {
          const name = toolCall.function?.name || "";
          const args = this.parseForkToolArgs(toolCall.function?.arguments);
          let toolContent: string;
          if (options.canUseTool && options.canUseTool(name, args)) {
            toolContent = await this.executeForkTool(
              name,
              args,
              workdir,
              sessionId,
              abortSignal,
              forkReadFileState,
            );
          } else {
            toolContent =
              options.deniedToolMessage ??
              "Tool use is not allowed in this context";
          }
          forkMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolContent,
          });
        }
        continue;
      }

      // Neither text nor tool calls: retrying the identical request is
      // pointless, bail out and let the caller fail.
      break;
    }

    return { content, usage: totalUsage };
  }

  /**
   * Fork-path compaction: deny all tool calls locally (the model is told to
   * summarize, not act) and feed the rejections back for another turn.
   */
  private async runCompactFork(
    historyMessages: ChatCompletionMessageParam[],
    compactPrompt: string,
    abortSignal: AbortSignal | undefined,
    /** Streaming deltas of the fork's output, forwarded as the caller asked. */
    stream: {
      onContentDelta?: (delta: string) => void;
      onReasoningDelta?: (delta: string) => void;
    },
  ): Promise<ForkLoopResult> {
    return this.runForkLoop(
      historyMessages,
      compactPrompt,
      {
        maxTurns: MAX_FORK_TURNS,
        deniedToolMessage: "Tool use is not allowed during compaction",
        ...stream,
      },
      abortSignal,
    );
  }

  /**
   * Auto-memory extraction via the perfect fork: the extraction prompt is run
   * against the same request prefix as the main conversation (same system
   * prompt, tools, model, and message history) so the prompt cache is reused.
   * Gate-approved tools execute locally in a stripped context; everything else
   * is denied. Usage is reported with operation_type "agent" so extraction
   * token costs stay visible in session accounting.
   */
  public async runAutoMemoryFork(
    messages: Message[],
    prompt: string,
    options: {
      canUseTool: (name: string, args: Record<string, unknown>) => boolean;
      deniedToolMessage?: string;
      maxTurns?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<ForkLoopResult> {
    const modelConfig = this.getModelConfig();
    const historyMessages = await convertMessagesForAPI(messages, {
      supportsVision: supportsVision(modelConfig.capabilities),
      reasoningSignatures:
        resolveApiType(modelConfig.capabilities) === "messages",
    });
    // Give the fork a real signal even when the caller has none, so tools
    // (e.g. Bash's foreground path) always receive a well-formed context.
    const signal = abortSignal ?? new AbortController().signal;
    const result = await this.runForkLoop(
      historyMessages,
      prompt,
      {
        maxTurns: options.maxTurns ?? MAX_AUTO_MEMORY_FORK_TURNS,
        canUseTool: options.canUseTool,
        deniedToolMessage: options.deniedToolMessage,
      },
      signal,
    );

    this.recordTurnOutputTokens(result.usage);
    if (result.usage && this.callbacks?.onUsageAdded) {
      this.callbacks.onUsageAdded({
        ...result.usage,
        model: modelConfig.model,
        operation_type: "agent",
      });
    }
    return result;
  }

  /**
   * Parse a fork tool call's JSON arguments, recovering truncated JSON the
   * same way the main loop does. Unparseable arguments fall back to `{}` and
   * are rejected by the gate or the tool's own parameter validation.
   */
  private parseForkToolArgs(
    argsString: string | undefined,
  ): Record<string, unknown> {
    if (!argsString?.trim()) return {};
    try {
      return JSON.parse(argsString) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(recoverTruncatedJson(argsString)) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    }
  }

  /**
   * Execute a single tool call inside a fork with a stripped context: no
   * permission manager (never prompts the user), no message manager (no
   * conditional-rule triggering), no messageId (no file-history snapshots),
   * and no background task manager (commands run in the foreground). Only
   * gate-approved tool names reach this path.
   */
  private async executeForkTool(
    name: string,
    args: Record<string, unknown>,
    workdir: string,
    sessionId: string | undefined,
    abortSignal: AbortSignal | undefined,
    readFileState: ToolContext["readFileState"],
  ): Promise<string> {
    const plugin = this.toolManager.getTools().find((t) => t.name === name);
    if (!plugin) {
      return `Tool '${name}' not found`;
    }
    const context: ToolContext = {
      abortSignal,
      workdir,
      originalWorkdir: this.originalWorkdir,
      sessionId,
      taskManager: this.taskManager,
      readFileState,
      onShortResultUpdate: () => {},
      onCwdChange: () => {},
    };
    try {
      const result = await plugin.execute(args, context);
      if (result.content) return result.content;
      if (result.error) return `Error: ${result.error}`;
      return "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(`Fork tool execution failed for ${name}:`, error);
      return `Tool execution failed: ${message}`;
    }
  }

  /**
   * Fork-path side question ("/btw"): run a single-turn fork of the
   * conversation using the same system prompt, tools, model, and generation
   * params as the main loop, so the forked request prefix matches exactly and
   * the prompt cache is reused. The in-progress assistant message (if any) is
   * stripped so the fork starts from the last completed request prefix. Tools
   * are never executed — the wrapped question instructs the model to answer
   * directly; an attempted tool call is surfaced as an error string.
   *
   * `segmentId` names one段侧聊 (spec commands/btw-command.md「侧聊分段与上下文
   * 冻结」): the parent-conversation prefix is captured once, on that segment's
   * first question, and reused verbatim for the rest of the segment — new main
   * messages produced meanwhile never enter it. `releaseBtwSegment` drops it.
   *
   * `history` carries this segment's earlier turns (「Webview 端继续提问」): they
   * are appended as ordinary user/assistant messages *after* the prefix, so
   * follow-up questions can refer back to earlier answers while the prefix that
   * hits the prompt cache stays byte-identical.
   */
  async runBtwFork(
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
    onReasoning?: (content: string) => void,
    history?: BtwHistoryTurn[],
    segmentId?: string,
  ): Promise<{ content?: string; error?: string }> {
    const modelConfig = this.getModelConfig();
    const gatewayConfig = this.getGatewayConfig();
    const sessionId = this.messageManager.getSessionId();
    const workdir = this.getCurrentWorkdir();

    // 一段侧聊 = 一次 fork：前缀只在首次提问那一刻取，段内每轮原样复用（主 Agent
    // 之后产出的新消息进不来）。没有段标识（CLI 单轮）就每轮现取。
    const segment = segmentId ? this.btwSegmentFor(segmentId) : undefined;
    let prefix = segment?.prefix;
    if (!prefix) {
      prefix = await this.buildBtwForkPrefix();
      if (segment) segment.prefix = prefix;
    }

    // Wrap the question with the side-question instructions (verbatim
    // Claude Code sideQuestion.ts) so the model answers directly. The first
    // turn keeps the original wording byte-for-byte; a follow-up swaps the
    // "one-off" line (which would contradict the history we are about to
    // append) for a note pointing at the earlier turns.
    const isFollowUp = (history?.length ?? 0) > 0;
    const followUpConstraint = isFollowUp
      ? `- This is a follow-up in a side chat: the earlier side questions and their answers appear above as ordinary messages — use them to resolve what "it/that/this" refers to, and do not re-answer what was already answered
- This response is still a single turn - do not call tools or promise any action`
      : `- This is a one-off response - there will be no follow-up turns`;
    const wrappedQuestion = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
${followUpConstraint}
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question}`;

    // 历史轮 + 这一问接在冻结前缀之后：前缀只读（`[...prefix]`），段内每轮只有
    // 尾部增长。历史答案是重放用的，先净化掉没有信息量的那几类。
    const forkMessages: ChatCompletionMessageParam[] = [...prefix];
    for (const turn of history ?? []) {
      forkMessages.push({ role: "user", content: turn.question });
      forkMessages.push({
        role: "assistant",
        content: sanitizeBtwHistoryAnswer(turn.answer),
      });
    }
    forkMessages.push({ role: "user", content: wrappedQuestion });

    // 关闭面板要能中止在途的那一轮：这一段的取消信号与调用方自带的合并。
    const linkedAbort = linkAbortSignals([
      abortSignal,
      segment?.controller.signal,
    ]);

    await this.prepareToolDescriptions();
    const { toolsConfig, reachableToolPlugins } = this.resolveFilteredTools();
    const systemPrompt = await this.buildMainSystemPrompt(reachableToolPlugins);

    try {
      // Surface partial output to the caller (e.g. the /btw overlay's
      // streaming display) as it arrives. Reasoning chunks from thinking
      // models stream through a separate channel when the caller supplies
      // one (webview hosts distinguish thinking from content so the panel
      // can drop thinking text once content starts); otherwise they fall
      // back to the content channel (CLI overlay mixes both).
      const streamToOverlay = (text: string) => {
        if (text.trim()) {
          onContent?.(text);
        }
      };
      const streamReasoning = (text: string) => {
        if (text.trim()) {
          if (onReasoning) {
            onReasoning(text);
          } else {
            onContent?.(text);
          }
        }
      };
      const result = await aiService.callAgent({
        gatewayConfig,
        modelConfig,
        messages: forkMessages,
        sessionId,
        abortSignal: linkedAbort.signal,
        workdir,
        tools: toolsConfig,
        systemPrompt,
        maxTokens: this.configurationService.resolveMaxOutputTokens(),
        toolChoice: this.toolChoiceOverride,
        // Stream so a slow reasoning model emits first bytes before the
        // gateway's idle timeout fires (same rationale as runCompactFork).
        stream: true,
        onContentDelta: streamToOverlay,
        onReasoningDelta: streamReasoning,
      });

      if (result.content?.trim()) {
        return { content: result.content };
      }

      // A thinking model may emit only reasoning content (e.g. the stream
      // is truncated before the final answer); surface that instead of
      // falling through to "No response received".
      if (result.reasoning_content?.trim()) {
        return { content: result.reasoning_content };
      }

      if (result.tool_calls && result.tool_calls.length > 0) {
        const firstFunctionCall = result.tool_calls.find(
          (call) => call.type === "function",
        );
        const toolName = firstFunctionCall?.function?.name ?? "a tool";
        return {
          error: `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`,
        };
      }

      // Neither text nor tool calls.
      return { error: "No response received" };
    } catch (error) {
      // aiService.callAgent converts AbortError into a plain Error, so the
      // abort is detected via the signal itself; rethrow so the UI can
      // silently dismiss instead of showing an error.
      if (linkedAbort.signal?.aborted) {
        throw error;
      }
      return {
        error: `(API error: ${error instanceof Error ? error.message : String(error)})`,
      };
    } finally {
      linkedAbort.dispose();
    }
  }

  /**
   * 侧聊请求的前缀：主对话快照 + 记忆注入，与主对话请求字节级一致（命中 prompt
   * cache）。为了「前缀」这一份东西，一段侧聊只在首次提问时算一次。
   */
  private async buildBtwForkPrefix(): Promise<ChatCompletionMessageParam[]> {
    const modelConfig = this.getModelConfig();
    const rawMessages = this.messageManager.getMessages();

    // Strip the in-progress assistant message (a block still in "streaming"
    // stage) so the fork's request prefix matches the last completed
    // main-loop request and the prompt cache is reused.
    const lastMessage = rawMessages[rawMessages.length - 1];
    const hasInProgressMessage =
      lastMessage?.role === "assistant" &&
      lastMessage.blocks.some(
        (b) => "stage" in b && (b as { stage?: string }).stage === "streaming",
      );

    const forkMessages: ChatCompletionMessageParam[] =
      await convertMessagesForAPI(
        hasInProgressMessage ? rawMessages.slice(0, -1) : rawMessages,
        {
          supportsVision: supportsVision(modelConfig.capabilities),
          reasoningSignatures:
            resolveApiType(modelConfig.capabilities) === "messages",
        },
      );

    // Mirror the main loop's memory injection so the request prefix matches.
    const { prependContent } =
      await this.messageManager.getMemoryForInjection();
    // Same `memory` attachment slot as the main loop (spec「系统提示词与附件」).
    const memoryAttachment = await this.rewriteAttachment(
      "memory",
      prependContent,
    );
    if (memoryAttachment?.trim()) {
      forkMessages.unshift({
        role: "user",
        content: wrapInSystemReminder(memoryAttachment),
      });
    }
    return forkMessages;
  }

  /**
   * 取（必要时新建）一段侧聊的引擎侧状态。超过上限就按插入顺序淘汰最旧的一段：
   * 宿主崩溃、或换段时没发 `releaseBtwSegment`，前缀也不能一直攒着——它是一整份
   * 父对话快照。
   */
  private btwSegmentFor(segmentId: string): BtwSegmentState {
    const existing = this.btwSegments.get(segmentId);
    if (existing) return existing;
    const segment: BtwSegmentState = { controller: new AbortController() };
    this.btwSegments.set(segmentId, segment);
    while (this.btwSegments.size > MAX_BTW_SEGMENTS) {
      const oldest = this.btwSegments.keys().next().value;
      if (oldest === undefined) break;
      this.releaseBtwSegment(oldest);
    }
    return segment;
  }

  /**
   * 丢弃一段侧聊（关闭面板）：释放冻结前缀并中止在途的那一轮（spec
   * commands/btw-command.md「侧聊分段与上下文冻结」场景 6）。关闭之后的迟到回包
   * 由界面按 `requestId` 丢弃，这里只负责别再往下跑。
   */
  releaseBtwSegment(segmentId: string): void {
    const segment = this.btwSegments.get(segmentId);
    if (!segment) return;
    this.btwSegments.delete(segmentId);
    segment.prefix = undefined;
    segment.controller.abort();
  }

  /** 整份丢弃（`/clear`、销毁）：段的意义依附于那场对话，对话没了就都作废。 */
  releaseAllBtwSegments(): void {
    for (const segmentId of [...this.btwSegments.keys()]) {
      this.releaseBtwSegment(segmentId);
    }
  }

  /**
   * Build post-compact context restoration content.
   * Restores file reads, working directory, plan mode, skills, and background tasks.
   */
  private async buildPostCompactContext(summary: string): Promise<string> {
    const POST_COMPACT_TOKEN_BUDGET = 50_000;
    const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
    const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
    const contextParts: string[] = [];

    // 1. File context restoration
    const recentFiles = this.messageManager.getRecentFileReads(
      POST_COMPACT_MAX_FILES_TO_RESTORE,
      POST_COMPACT_MAX_TOKENS_PER_FILE,
    );
    let usedTokens = 0;
    for (const file of recentFiles) {
      const fileTokens = estimateTokens(file.content);
      if (usedTokens + fileTokens > POST_COMPACT_MAX_TOKENS_PER_FILE) continue;
      if (fileTokens > 0) usedTokens += fileTokens;
      contextParts.push(`\n\n## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      if (contextParts.length >= POST_COMPACT_MAX_FILES_TO_RESTORE) break;
      if (usedTokens >= POST_COMPACT_TOKEN_BUDGET) break;
    }

    // 4. Invoked skills context (with token budget, matching Claude Code)
    const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;
    const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
    const invokedSkills = this.messageManager.getInvokedSkills?.(10) ?? [];
    if (invokedSkills.length > 0 && this.skillManager) {
      const invokedSkillParts: string[] = [];
      let skillsUsedTokens = 0;
      for (const invoked of invokedSkills) {
        try {
          const skill = await this.skillManager.loadSkill(invoked.skillName);

          // Re-inject what the model actually saw (already substituted, with the
          // base-directory header). Re-render from the file only when that
          // record is missing — never hand the model a raw SKILL.md, whose
          // `${WAVE_SKILL_DIR}` would be a literal placeholder
          // (spec core/message-compact 场景 4). A re-rendered body goes through
          // `skill.prompt` again so the model sees the same text it saw the
          // first time; the recorded body already did.
          let skillContent = invoked.content?.trim();
          if (!skillContent && skill) {
            skillContent = await this.skillManager.applySkillPrompt(
              skill,
              this.skillManager.renderSkillContent(skill),
            );
          }
          if (!skillContent) continue;

          const maxSkillChars = POST_COMPACT_MAX_TOKENS_PER_SKILL * 4;
          if (skillContent.length > maxSkillChars) {
            skillContent = `${skillContent.slice(0, maxSkillChars)}\n\n...[truncated]...`;
          }

          const skillTokens = estimateTokens(skillContent);
          if (skillsUsedTokens + skillTokens > POST_COMPACT_SKILLS_TOKEN_BUDGET)
            break;
          skillsUsedTokens += skillTokens;

          const description = skill?.description;
          invokedSkillParts.push(
            `\n\n## ${skill?.name ?? invoked.skillName}\n${description ? `*${description}*\n\n` : ""}\`\`\`\n${skillContent}\n\`\`\``,
          );
        } catch {
          // Skip skills that can't be loaded
        }
      }
      if (invokedSkillParts.length > 0) {
        contextParts.push(
          `\n\n[Invoked Skills]\n${invokedSkillParts.join("")}`,
        );
      }
    }

    // 5. Background subagent status (shell tasks excluded, matching Claude Code's createAsyncAgentAttachmentsIfNeeded)
    const agents =
      this.backgroundTaskManager
        ?.getAllTasks()
        .filter((a) => a.type === "subagent") || [];
    if (agents.length > 0) {
      const agentParts: string[] = [];
      for (const a of agents) {
        if (a.status === "killed") {
          agentParts.push(
            `Task "${a.description}" (${a.id}) was stopped by the user.`,
          );
        } else if (a.status === "running") {
          const parts = [
            `Background agent "${a.description}" (${a.id}) is still running.`,
            `Do NOT spawn a duplicate. You will be notified when it completes.`,
          ];
          if (a.outputPath) {
            parts.push(`You can read partial output at ${a.outputPath}.`);
          }
          agentParts.push(parts.join(" "));
        } else {
          // completed or failed
          const parts = [
            `Task ${a.id} (status: ${a.status}) (description: ${a.description}).`,
          ];
          const deltaText = a.status === "failed" ? a.stderr : a.stdout;
          if (deltaText && deltaText.length > 0) {
            const summary =
              deltaText.length > 500
                ? deltaText.slice(0, 500) + "..."
                : deltaText;
            parts.push(`Delta: ${summary}`);
          }
          if (a.outputPath) {
            parts.push(
              `Read the output file to retrieve the result: ${a.outputPath}.`,
            );
          }
          agentParts.push(parts.join(" "));
        }
      }
      if (agentParts.length > 0) {
        contextParts.push(`\n\n[Background Tasks]\n${agentParts.join("\n")}`);
      }
    }

    return (
      summary +
      (contextParts.length > 0
        ? `\n\n[Context Restoration]` + contextParts.join("")
        : "")
    );
  }

  public getIsCompacting(): boolean {
    return this.isCompacting;
  }

  public setIsCompacting(isCompacting: boolean): void {
    if (this.isCompacting !== isCompacting) {
      this.isCompacting = isCompacting;
      this.callbacks.onCompactionStateChange?.(isCompacting);
    }
  }

  private get subagentManager(): SubagentManager | undefined {
    return this.container.get<SubagentManager>("SubagentManager");
  }

  private get cronManager(): CronManager | undefined {
    return this.container.get<CronManager>("CronManager");
  }

  private get skillManager(): SkillManager | undefined {
    return this.container.get<SkillManager>("SkillManager");
  }

  private get liveConfigManager(): LiveConfigManager | undefined {
    return this.container.get<LiveConfigManager>("LiveConfigManager");
  }

  /**
   * The turn's output-token ledger (registered by the agent container setup).
   * Undefined in bare containers (some tests build one by hand), in which case
   * token accounting is simply skipped.
   */
  private get turnBudgetLedger(): TurnBudgetLedger | undefined {
    return this.container.get<TurnBudgetLedger>("TurnBudgetLedger");
  }

  /**
   * Text of the most recent real user prompt. Background-task notifications are
   * user-role messages too — they carry a task_notification block and no text —
   * so they are skipped: a notification-triggered turn must keep reading the
   * user's own instruction (and hence its token target).
   */
  private getLastUserPromptText(): string {
    const messages = this.messageManager.getMessages();
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message.role !== "user") continue;
      const text = message.blocks
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.content)
        .join("\n");
      if (text) return text;
    }
    return "";
  }

  /**
   * Charge one LLM response to the turn's budget ledger. Output-only means
   * `completion_tokens`: `total_tokens` also carries the prompt side (with the
   * cache hits baked into it), so charging it would bill the whole context once
   * per request — see utils/tokenCalculation.ts for the same accounting.
   */
  private recordTurnOutputTokens(usage: Usage | undefined): void {
    if (!usage) return;
    this.turnBudgetLedger?.addOutputTokens(usage.completion_tokens);
  }

  public async sendAIMessage(
    options: {
      recursionDepth?: number;
      model?: string;
      /** Rules for automatic tool approval (e.g., "Bash(git status*)") */
      allowedRules?: string[];
      maxTokens?: number;
    } = {},
  ): Promise<void> {
    const { recursionDepth = 0, allowedRules, maxTokens } = options;
    // `let`：`turn.step` 上的 mod 可以把这次请求换到另一个模型上（CC 的生成器
    // 事件形状），改写落在下面那次请求里。
    let model = options.model;
    let turnOffset = recursionDepth;

    // Pin the settings.json-derived configuration for the whole turn: live
    // reload can land mid-turn and the turn must not see values shift under it
    // (core/agent-config.md scenario 5). Nested turns (subagent turns inside
    // their parent's) share the outer snapshot instead of re-capturing it; the
    // release at the end of the turn mirrors this capture and lives on the
    // single exit path of this function.
    const ownsTurnSnapshot = recursionDepth === 0;
    if (ownsTurnSnapshot) {
      this.liveConfigManager?.onTurnStart();
      // A fresh user turn is never a stop-hook continuation.
      this.stopHookActive = false;
      this.modStopContextCount = 0;
    }

    // Turn boundary for the shared output-token ledger. Only the MAIN agent
    // starts a turn: a subagent turn (including every workflow agent) nests
    // inside its parent's and its tokens count toward the same budget, so it must
    // not re-baseline the ledger (spec multi-agent/workflow.md 场景 5 — the main
    // loop and every workflow of the turn share one `spent()`).
    //
    // The target is re-read from the last user prompt on each turn: that keeps a
    // "+500k"/"use 500k tokens" instruction in force across notification-driven
    // turns (where the spend restarts) while a later message with no target clears
    // it (场景 1/2).
    if (ownsTurnSnapshot && !this.subagentType) {
      this.turnBudgetLedger?.beginTurn(
        parseTokenBudgetTarget(this.getLastUserPromptText()),
      );
    }

    // Reserve this turn synchronously before any async work. Bumping the
    // generation invalidates any in-flight turn's end-of-turn cleanup, and
    // recording myGeneration lets us skip cleanup if a newer turn (or abort)
    // has superseded us. setIsLoading(true) here also closes the "idle but
    // previous turn not finished" race window by marking us busy immediately.
    this.turnGeneration++;
    let myGeneration = this.turnGeneration;
    this.setIsLoading(true);

    // Timed from here so the `turn.complete` mod event (spec ecosystem/plugin-mods.md
    // 「完成与审批的观察」) covers the whole turn, including the Stop-hook and
    // notification restarts below: from the user's side those are still one turn.
    // Same for the token totals — every model request in the turn adds to them, so
    // a turn that restarted still reports one set of numbers.
    // `turnAborted` is recorded where the turn already works out whether it was
    // aborted, and read on the single exit path below.
    const turnStartedAt = Date.now();
    const turnUsage: ModTokenTotals = {
      prompt: 0,
      completion: 0,
      cacheRead: 0,
      cacheCreation: 0,
    };
    let turnAborted = false;
    // 最后一次模型请求的失败原因（成功一次就清空）。决定这一轮收尾发
    // `classic.Stop` 还是 `classic.StopFailure`（spec「影子事件」）。
    let turnError: { kind: ErrorCategory; message: string } | undefined;

    // The MCP servers were registered and their dials already started at
    // `Agent.create()`; all a turn does here is wait for them, for at most 5 s
    // (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 1-5). When the
    // deadline is reached this turn goes out with whatever happened to be
    // connected — the connection keeps running in the background and the next
    // turn's tool config picks it up. A server configured with `alwaysLoad: true`
    // is the one exception: the user asked to start with it, so it is not bounded
    // by that deadline. `undefined` when nothing is in flight: such a turn must
    // not gain an extra yield point over one built before auto-dialing existed.
    //
    // Before waiting: a server that is down but whose backoff window has
    // expired is redialed here, so the next call to it can go through
    // (spec ecosystem/mcp.md「使用前重拨」). Deliberately not awaited — the dial
    // runs in the background (`recoverServers()` marks it background), so
    // reviving a dead server never adds another wait to this turn.
    const mcp = this.mcpManager;
    if (mcp && typeof mcp.recoverServers === "function") {
      void mcp.recoverServers().catch((error: unknown) => {
        logger?.warn("MCP recovery dial failed:", error);
      });
    }
    const mcpDial =
      mcp && typeof mcp.waitForTurnDials === "function"
        ? mcp.waitForTurnDials()?.catch((error: unknown) => {
            logger?.warn("MCP turn dial wait failed:", error);
          })
        : undefined;

    // Tell the mods a turn started (spec ecosystem/plugin-mods.md「轮次内外的事件」).
    // Same scope rule as `turn.complete`: only the main agent's turns own the
    // event. Deliberately outside the restart loop below — a Stop-hook
    // continuation or a notification drain is still the same turn, so the step
    // counter below survives it too.
    //
    // `turnId` 是这一轮的身份：`turn.start` / `turn.step` / `turn.complete` /
    // `classic.MessageDisplay` 四处共用同一个值，也是 `$.turn.abort({ turnId })`
    // 的凭据（spec「收掉一轮」）。子代理的嵌套轮次不对外报这些，但 id 照给 ——
    // 它只在本实例内流转，不会有第二个消费者。
    const turnId = randomUUID();
    if (!this.subagentType) {
      this.currentTurnId = turnId;
      this.getModManager()?.notifyMods("turn.start", { turnId });
    }
    // 这一轮的第几次请求。**不**用 `turnDepth - turnOffset`：那两个量在每次
    // `outer` 重开时都会重置，重开是同一轮里的新请求，mod 看到的步数不该退回 1。
    let turnSteps = 0;

    outer: while (true) {
      let shouldRestart = false;

      // OpenTelemetry: log the user_prompt event for this turn (initial call only)
      if (turnOffset === 0) {
        const messages = this.messageManager.getMessages();
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");
        const userPromptText =
          lastUserMessage?.blocks.find((b) => b.type === "text")?.content || "";

        // Log user_prompt event
        logOTelEvent(
          "user_prompt",
          {
            prompt_length: String(userPromptText.length),
          },
          this.telemetryContext,
        ).catch(() => {}); // Non-blocking
      }

      // Apply allowed rules for the initial call
      if (turnOffset === 0) {
        if (allowedRules && allowedRules.length > 0) {
          this.permissionManager?.addTemporaryRules(allowedRules);
        }
      }

      // Scan the last user message once per turn: `@path` triggers conditional
      // rules, `@agent:<name>` (what the three hosts insert when the user picks a
      // subagent from the `@` dropdown) becomes a delegation reminder — spec
      // `multi-agent/subagent.md`「用户故事：显式子代理调用」.
      if (turnOffset === 0) {
        const messages = this.messageManager.getMessages();
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          const mentionedAgents: string[] = [];
          for (const block of lastMessage.blocks) {
            if (block.type !== "text") continue;
            const content = block.content;
            for (const name of parseAgentMentions(content)) {
              if (!mentionedAgents.includes(name)) mentionedAgents.push(name);
            }
            // A subagent mention is not a path: without the guard this scan
            // would go looking for a file called "agent".
            const fileMentionRegex = /(?:^|\s)@(?!agent:)([\w.\-/]+)/g;
            let match;
            while ((match = fileMentionRegex.exec(content)) !== null) {
              const filePath = match[1];
              this.messageManager.triggerFileRead(filePath);
            }
          }

          if (mentionedAgents.length > 0) {
            await this.injectAgentMentionReminder(mentionedAgents);
          }
        }
      }

      // Only create new AbortControllers for the initial call (turnOffset === 0)
      // For restarts, reuse existing controllers to maintain abort signal
      let abortController: AbortController;
      let toolAbortController: AbortController;

      if (turnOffset === 0) {
        // Create new AbortControllers for initial call
        abortController = new AbortController();
        this.abortController = abortController;

        toolAbortController = new AbortController();
        this.toolAbortController = toolAbortController;

        // Every tool call in a turn wires its own abort listener onto the
        // shared tool signal (see toolAbortController.signal in executeTool),
        // so a fan-out of >=11 parallel calls trips Node's default 10-listener
        // cap and spams MaxListenersExceededWarning. The signal dies with the
        // turn (toolAbortController is cleared in the tool loop), so there is
        // no real leak — raise the cap to silence the noise. Optional chaining
        // keeps this a no-op on Node >=26, which removed the EventTarget
        // warning mechanism (and the setMaxListeners method) entirely.
        const toolSignal = toolAbortController.signal as EventTarget & {
          setMaxListeners?: (n: number) => void;
        };
        const turnSignal = abortController.signal as EventTarget & {
          setMaxListeners?: (n: number) => void;
        };
        toolSignal.setMaxListeners?.(0);
        turnSignal.setMaxListeners?.(0);
      } else {
        // Reuse existing controllers
        abortController = this.abortController!;
        toolAbortController = this.toolAbortController!;
      }

      let turnDepth = turnOffset;

      // Consecutive truncation recoveries within this turn (no tool calls
      // in between). Reset to 0 on tool calls / at each sendAIMessage entry,
      // matching Claude Code's maxOutputTokensRecoveryCount semantics.
      let maxOutputTokensRecoveryCount = 0;

      inner: while (true) {
        try {
          // 这一轮最后为什么结束：跑成功一次请求就清掉，出错就记下来。影子事件
          // `classic.Stop` / `classic.StopFailure` 靠它二选一（spec「影子事件」）。
          turnError = undefined;

          // Save session in each iteration to ensure message persistence
          await this.messageManager.saveSession();

          // Get current permission mode
          const currentMode = this.permissionManager?.getCurrentEffectiveMode(
            this.getModelConfig().permissionMode,
          );

          // Add plan mode reminder as persistent meta message before getting messages
          this.maybeAddPlanModeMessage(currentMode);

          // Process conditional rules triggered by file reads (persist as meta messages)
          const triggeredRules = this.messageManager.processTriggeredRules();
          for (const rule of triggeredRules) {
            this.messageManager.addUserMessage({
              content: `<!-- rule: ${rule.id} -->\n<system-reminder>\nThe following rules from .wave/rules apply to your work. Be sure to adhere to these instructions.\n\n${rule.content}\n</system-reminder>`,
              isMeta: true,
            });
          }

          // Nested memory: a read inside a subtree pulls in that subtree's
          // AGENTS.md (persisted as a meta message, aligned with Claude Code's
          // nested_memory attachment). Runs with the rules above — before the
          // message snapshot below, so the file lands in this request rather
          // than the next one. Optional call: hosts and tests register partial
          // MessageManager doubles, and absence reads as "nothing triggered".
          const nestedMemories =
            (await this.messageManager.collectNestedMemoryFiles?.()) ?? [];
          for (const memory of nestedMemories) {
            // `prompt.attachment`（spec「系统提示词与附件」）：`nested_memory`
            // 是 CC 那一档的真名（下划线），插件按它过滤。返回 `null` 就不注
            // 入这一条。
            const nestedMemoryText = await this.rewriteAttachment(
              "nested_memory",
              `Contents of ${memory.path}:\n\n${memory.content}`,
            );
            if (nestedMemoryText === null) continue;
            this.messageManager.addUserMessage({
              content: wrapInSystemReminder(nestedMemoryText),
              isMeta: true,
            });
            // 影子事件 `classic.InstructionsLoaded`（spec「影子事件」）：这里只
            // 有「沿目录链注入」这一档（`nested_traversal`），开局常驻的那几份
            // 由 Agent 在启动时统一报。子树里的那份按定义属于项目档
            // （`Local` 只认 `AGENTS.local.md` 这个名字，且只在会话根上找）。
            // 被插件压掉的那份没有注入，也就没有「载入了」这件事。
            this.getModManager()?.notifyMods("classic.InstructionsLoaded", {
              file_path: memory.path,
              memory_type: "Project",
              load_reason: "nested_traversal",
            });
          }

          // Session-scoped context from mods (`prompt.context`): one chance per
          // session, and it has to land before the snapshot below to be in the
          // first request.
          await this.injectSessionPromptContext();

          // Subtree skills reached by this turn's file operations, then the
          // skill list itself — both before the snapshot below, so a skill
          // discovered now lands in the request that can already use it.
          await this.maybeDiscoverNestedSkills();
          this.maybeAnnounceSkillListing();
          await this.maybeAnnounceAgentListing();

          // The MCP usage-notes announcement is *not* here: it has to read the
          // server table after `mcpDial` below settles, or the server that just
          // connected is missing from the request that can already call it
          // (`maybeAnnounceMcpInstructions()` is called right after the wait).
          this.maybeAnnounceReplCatalog();
          this.maybeAnnounceReplEvents();

          // Track if assistant message has been created
          let assistantMessageCreated = false;
          /**
           * Id of the assistant message this iteration streams into. Needed to
           * drop that message if the streamed attempt dies mid-body and the
           * request is re-issued non-streaming (spec: 流式响应正文中途断连时
           * 降级为非流式重发).
           */
          let assistantMessageId: string | undefined;
          const ensureAssistantMessage = () => {
            if (!assistantMessageCreated) {
              assistantMessageId = this.messageManager.addAssistantMessage();
              assistantMessageCreated = true;
            }
          };

          logger?.debug("modelConfig in sendAIMessage", this.getModelConfig());

          // Settle the auto-dial wait before the tool config is derived, so this
          // turn's request carries whatever came up within the deadline (or
          // everything, for `alwaysLoad` servers). `mcpDial` is undefined when
          // nothing was in flight — then this is a no-op, not an extra yield
          // point.
          if (mcpDial) await mcpDial;

          // Announce MCP servers' own usage notes (persisted meta message) after
          // the wait, before the snapshot below: a server that connected during
          // this turn explains itself in the request that can already call it,
          // and one that is still dialing is not mistaken for one that left.
          // After compaction, so the announcement is not the content that just
          // got summarized away.
          this.maybeAnnounceMcpInstructions();

          await this.prepareToolDescriptions();
          const { toolsConfig, toolNames, reachableToolPlugins } =
            this.resolveFilteredTools();

          // `let`：`turn.step` 上的 mod 可能把这次请求换到另一个模型上。
          let currentModelConfig = this.getModelConfig();

          // Get memory for message-array injection (not system prompt).
          // `omitAgentsMd` subagents start without it — the same saving Claude
          // Code's built-in Explore/Plan get by omitting CLAUDE.md.
          const { prependContent } = this.omitAgentsMd
            ? { prependContent: "" }
            : await this.messageManager.getMemoryForInjection();

          const mainSystemPrompt =
            await this.buildMainSystemPrompt(reachableToolPlugins);

          // Pre-request auto-compaction estimates the context about to be sent
          // from the last response's usage plus newer messages only. That
          // usage already contains the system prompt, tool schema and injected
          // memory, so they must not be added again (see
          // estimateContextTokens).
          await this.maybeAutoCompactBeforeRequest(abortController);

          // Tell the mods a request is going out (spec ecosystem/plugin-mods.md
          // 「轮次内外的事件」). `turn.start` opened the turn; from here on every
          // request is a step, numbered from 0 within this turn — the pair is
          // what lets a status band show "step 3" without watching messages.
          //
          // CC's step carries the model it is about to ask and is a **generator**
          // event: a mod may `yield* next(e)` and `return { ...e, model }` to send
          // this one request to a different model. That answer has to be in hand
          // before the request is built, so this one waits (unlike `turn.start`).
          const stepModel = currentModelConfig.model?.trim();
          const mods = this.getModManager();
          if (mods && !this.subagentType && stepModel) {
            // 宿主与测试会注册 partial 的 ModManager 替身（与上面
            // `collectNestedMemoryFiles` 同一条纪律）：没有这个方法就等于「没有
            // 插件要改这次请求的模型」，不能因此掐掉整轮。
            const stepped =
              typeof mods.dispatchTurnStep === "function"
                ? await mods.dispatchTurnStep({
                    turnId,
                    index: turnSteps,
                    messageCount: this.messageManager.getMessages().length,
                    model: stepModel,
                  })
                : undefined;
            turnSteps += 1;
            if (stepped && stepped.model !== stepModel) {
              // 换了模型就把整份配置重新解析一遍：apiType、上下文窗口、输出
              // 上限都是按模型名查出来的，只换请求里的名字会让限额按旧模型算。
              currentModelConfig = this.configurationService.resolveModelConfig(
                stepped.model,
                undefined,
                currentModelConfig.permissionMode,
              );
              model = stepped.model;
            }
          }

          // Background-task notifications are drained at the request boundary:
          // a task that finished while this turn's tools were running lands in
          // the request about to be sent, so the model can act on it inside the
          // same turn instead of waiting for the turn to end (spec:
          // core/background-task-notification「注入时机」).
          //
          // `turnDepth > turnOffset` is the whole gate: it says this turn has
          // already made at least one request, i.e. the hop we are in was
          // entered from an in-turn continuation (`continue inner` after tool
          // calls / a truncation retry), so the notification rides a request
          // that was going out anyway and can never extend the turn on its own.
          // On a turn's FIRST request the queue must be left alone: there the
          // notification would be the thing triggering work, which is the
          // turn-end path's job — and draining it early would lose it
          // altogether when that first turn is aborted before its request even
          // lands (agent.abort.test.ts pins this).
          //
          // Abort is checked too: injecting into an aborted turn would
          // resurrect it, and leaving the notification queued keeps it for the
          // next turn.
          if (
            turnDepth > turnOffset &&
            !abortController.signal.aborted &&
            !toolAbortController.signal.aborted
          ) {
            const pendingNotifications =
              this.getMessageQueue()?.drainNotifications() ?? [];
            if (pendingNotifications.length > 0) {
              await this.injectTaskNotifications(pendingNotifications);
            }
          }

          // Refresh messages in case compaction replaced the history.
          const refreshedMessages = await convertMessagesForAPI(
            this.messageManager.getMessages(),
            {
              supportsVision: supportsVision(currentModelConfig.capabilities),
              reasoningSignatures:
                resolveApiType(currentModelConfig.capabilities) === "messages",
            },
          );

          // Call AI service with streaming callbacks if enabled
          const callAgentOptions: CallAgentOptions = {
            gatewayConfig: this.getGatewayConfig(),
            // `currentModelConfig`（而不是再取一次）：`turn.step` 换了模型时这
            // 份配置已经按新名字重解析过，请求与限额必须是同一个模型。
            modelConfig: currentModelConfig,
            messages: refreshedMessages,
            sessionId: this.messageManager.getSessionId(),
            abortSignal: abortController.signal,
            workdir: this.getCurrentWorkdir(), // Pass working directory
            tools: toolsConfig, // Pass filtered tool configuration
            model: model, // Use passed model
            systemPrompt: mainSystemPrompt, // Pass custom system prompt
            maxTokens:
              maxTokens ?? this.configurationService.resolveMaxOutputTokens(), // Pass max tokens override, falling back to the resolved global value
            toolChoice: this.toolChoiceOverride, // Pass tool_choice override
            // Fast-model subagents send disable-thinking params only when
            // explicitly configured (never in the agent loop).
            disableThinkingOptions:
              this.modelOverride === "fastModel"
                ? currentModelConfig.disableThinkingOptions
                : undefined,
          };

          // Prepend: AGENTS.md + user memory + unconditional rules as system-reminder.
          // 这是 `prompt.attachment` 的 `memory` 档（spec「系统提示词与附件」）。
          const memoryAttachment = await this.rewriteAttachment(
            "memory",
            prependContent,
          );
          if (memoryAttachment?.trim()) {
            callAgentOptions.messages.unshift({
              role: "user",
              content: wrapInSystemReminder(memoryAttachment),
            });
          }

          // Task reminder: persist as meta message (conditional rules already persisted above)
          const taskReminderText =
            await this.maybeGetTaskReminderText(toolNames);
          if (taskReminderText) {
            this.messageManager.addUserMessage({
              content: taskReminderText,
              isMeta: true,
            });
          }

          // External file-change reminder (aligned with Claude Code's
          // changed_files attachment): notify the agent about files it read
          // that were since changed on disk by another process — the
          // auto-memory extraction fork, an external editor, another session.
          // Persisted as a meta message like the task reminder, so it stays in
          // the message prefix the auto-memory fork mirrors for cache reuse.
          const changedFilesReminder = await getChangedFilesReminder(
            this.readFileState,
          );
          if (changedFilesReminder) {
            this.messageManager.addUserMessage({
              content: wrapInSystemReminder(changedFilesReminder),
              isMeta: true,
            });
          }

          // Add streaming callbacks only if streaming is enabled
          if (this.stream) {
            callAgentOptions.onContentDelta = (delta: string) => {
              // Agent may have been destroyed mid-stream; ignore in-flight updates.
              if (!this.messageManager) return;
              // Create assistant message on first chunk if not already created
              ensureAssistantMessage();
              this.messageManager.appendCurrentMessageContent(delta);
            };
            callAgentOptions.onToolUpdate = (toolCall) => {
              // Agent may have been destroyed mid-stream; ignore in-flight updates.
              if (!this.messageManager) return;
              // Create assistant message on first tool update if not already created
              ensureAssistantMessage();

              // Use parametersChunk as compact param for better performance
              // No need to extract params or generate compact params during streaming

              // Update tool block with streaming parameters using parametersChunk as compact param
              // `parameters` is only present on start/running/end (authoritative); streaming
              // carries only `parametersChunk`, so don't forward `parameters: undefined`
              // (it would overwrite the accumulated block params in consumers)
              this.messageManager.updateToolBlock({
                id: toolCall.id,
                name: toolCall.name,
                ...(toolCall.parameters !== undefined
                  ? { parameters: toolCall.parameters }
                  : {}),
                parametersChunk: toolCall.parametersChunk,
                stage: toolCall.stage || "streaming", // Default to streaming if stage not provided
              });
            };
            callAgentOptions.onReasoningDelta = (delta: string) => {
              // Agent may have been destroyed mid-stream; ignore in-flight updates.
              if (!this.messageManager) return;
              // Create assistant message on first reasoning update if not already created
              ensureAssistantMessage();
              this.messageManager.appendCurrentMessageReasoning(delta);
            };
          }

          // Content-level events (opt-in): the system prompt and tool schemas,
          // deduped by hash inside — a no-op unless OTEL_LOG_TOOL_CONTENT is on.
          logRequestContentEvents(
            {
              systemPrompt:
                typeof callAgentOptions.systemPrompt === "string"
                  ? callAgentOptions.systemPrompt
                  : undefined,
              toolsSchema: callAgentOptions.tools
                ? JSON.stringify(callAgentOptions.tools)
                : undefined,
            },
            this.telemetryContext,
          ).catch(() => {}); // Non-blocking

          const result = await trackCliOperation(
            "llm",
            this.telemetryContext,
            () => aiService.callAgent(callAgentOptions),
          );

          // 额度响应头（codechat proxy 每次调用都会发，spec:
          // desktop/desktop-account.md「额度响应头」）：原样交给宿主，由它映射成
          // 账户卡片的读数。头是热路径上的免费输出，这里只做前缀筛选。
          const quotaHeaders = pickQuotaHeaders(result.response_headers);
          if (quotaHeaders) {
            // 留一份给 `$.session.usage()`（mod 读的是「现在多少」，不是这一次的
            // 回调），同时照旧交给宿主映射账户卡片。
            this.rememberQuotaHeaders(quotaHeaders);
            this.callbacks?.onQuotaHeaders?.(quotaHeaders);
          }

          // Record the token kinds this response consumed, by model — the
          // fleet-level view of cost.
          recordTokenUsage(
            {
              model: model || this.getModelConfig().model || "",
              inputTokens: result.usage?.prompt_tokens,
              outputTokens: result.usage?.completion_tokens,
              cacheReadTokens: result.usage?.cache_read_input_tokens,
              cacheCreationTokens: result.usage?.cache_creation_input_tokens,
            },
            this.telemetryContext,
          );

          if (result.stream_fallback && assistantMessageCreated) {
            // The streamed attempt died mid-body and the request was re-issued
            // without streaming. Whatever it had already streamed in is void, so
            // drop that message (and tell the hosts) rather than leaving half an
            // answer above the real one; its tool calls were never executed
            // (spec: 流式响应正文中途断连时降级为非流式重发).
            this.messageManager.discardAssistantMessage(assistantMessageId);
            assistantMessageId = undefined;
            assistantMessageCreated = false;
          }

          const createdByStreaming = assistantMessageCreated;

          // For non-streaming mode, create assistant message after callAgent returns
          // Also create if streaming mode but no streaming callbacks were called (e.g., when content comes directly in result)
          if (
            !this.stream ||
            (!assistantMessageCreated &&
              (result.content || result.tool_calls || result.reasoning_content))
          ) {
            assistantMessageId = this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }

          // Log finish reason and response headers if available
          if (result.finish_reason) {
            // Log warning headers when finish reason is length
            if (result.finish_reason === "length") {
              logger?.warn(
                "AI response truncated due to length limit. Response headers:",
                result.response_headers,
              );
            }
          }

          if (
            result.additionalFields &&
            Object.keys(result.additionalFields).length > 0
          ) {
            this.messageManager.mergeAssistantAdditionalFields(
              result.additionalFields,
            );
          }

          // Handle result reasoning content from non-streaming mode
          if (result.reasoning_content && !createdByStreaming) {
            this.messageManager.appendCurrentMessageReasoning(
              result.reasoning_content,
            );
          }

          // Handle result content from non-streaming mode
          if (result.content && !createdByStreaming) {
            this.messageManager.appendCurrentMessageContent(result.content);
          }

          // 影子事件 `classic.MessageDisplay`（spec「影子事件」）：一条 assistant
          // 消息的正文到这里就齐了 —— 一条报一次，`index` 恒 0、`final` 恒真。
          this.notifyMessageDisplay(turnId, assistantMessageId);

          // The Messages endpoint signs each thinking block and verifies those
          // boundaries on replay, so the per-block signatures have to land on the
          // turn's reasoning blocks before the message is persisted (spec
          // core/anthropic-messages-api.md「signature 全链路」). Absent on every
          // other endpoint.
          if (result.thinking_blocks && result.thinking_blocks.length > 0) {
            this.messageManager.attachThinkingSignatures(
              result.thinking_blocks,
            );
          }

          // Handle usage tracking for agent operations
          let usage: Usage | undefined;
          if (result.usage) {
            usage = {
              prompt_tokens: result.usage.prompt_tokens,
              completion_tokens: result.usage.completion_tokens,
              total_tokens: result.usage.total_tokens,
              model: model || this.getModelConfig().model,
              operation_type: "agent",
              // Preserve cache fields if present
              ...(result.usage.cache_read_input_tokens !== undefined && {
                cache_read_input_tokens: result.usage.cache_read_input_tokens,
              }),
              ...(result.usage.cache_creation_input_tokens !== undefined && {
                cache_creation_input_tokens:
                  result.usage.cache_creation_input_tokens,
              }),
            };
          }

          // Set usage on the assistant message if available
          if (usage) {
            // Charge the turn's budget ledger before anything else can fail:
            // the tokens were spent whether or not the message is persisted.
            this.recordTurnOutputTokens(usage);
            // Per-turn totals for `turn.complete` (spec ecosystem/plugin-mods.md
            // 「完成与审批的观察」): every request the turn makes counts, tool
            // loops included.
            accumulateTurnUsage(turnUsage, usage);
            const messages = this.messageManager.getMessages();
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === "assistant") {
              lastMessage.usage = usage;
              this.messageManager.setMessages(messages);
            }

            // Notify Agent to add to usage tracking
            if (this.callbacks?.onUsageAdded) {
              this.callbacks.onUsageAdded(usage);
            }
          }

          // Collect tool calls for processing
          const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
          if (result.tool_calls) {
            for (const toolCall of result.tool_calls) {
              if (toolCall.type === "function") {
                toolCalls.push(toolCall);
              }
            }
          }

          if (toolCalls.length > 0) {
            // Partition tool calls into batches: consecutive concurrency-safe
            // tools run in parallel, non-safe tools (Edit, Write, MCP) run one
            // at a time to prevent read-modify-write races on the same file.
            const batches: {
              calls: ChatCompletionMessageFunctionToolCall[];
              safe: boolean;
            }[] = [];
            for (const call of toolCalls) {
              const toolName = call.function?.name || "";
              const safe = this.toolManager.isConcurrencySafe(toolName);
              const lastBatch = batches[batches.length - 1];
              if (lastBatch && lastBatch.safe && safe) {
                lastBatch.calls.push(call);
              } else {
                batches.push({ calls: [call], safe });
              }
            }

            // Execute batches sequentially; within a safe batch, tools run in parallel
            // 形状照 CC：成功与否看 `tool_response` 在不在（曾经有一个自造的
            // `ok`，按 CC 字段写的插件读不到它）。`tool_response` 是 `data`
            // 本身（CC 的 `0172:9997-10002`），不是文本。
            const batchOutcomes: Array<{
              tool_name: string;
              tool_input: Record<string, unknown>;
              tool_use_id: string;
              tool_response?: unknown;
            }> = [];
            for (const batch of batches) {
              if (
                abortController.signal.aborted ||
                toolAbortController.signal.aborted
              ) {
                break;
              }
              const run = async (
                call: ChatCompletionMessageFunctionToolCall,
              ) => {
                const outcome = await this.executeToolCall(
                  call,
                  abortController,
                  toolAbortController,
                  // The names this very request declared: the same set `tools` above
                  // was built from, handed down the call stack of this one `callAgent`
                  // rather than parked on a member (a subagent or a second turn would
                  // find the wrong one there).
                  toolNames,
                  result.finish_reason,
                );
                batchOutcomes.push({
                  tool_name: call.function?.name || "",
                  tool_input: outcome.toolInput ?? {},
                  tool_use_id: call.id || "",
                  // 失败的调用没有 `tool_response`（CC 的 PostToolBatch 同形：
                  // 它的 schema 里 `tool_response` 是可选的，失败那次只有
                  // `tool_use_id` 在）。
                  ...(outcome.toolResponse === undefined
                    ? {}
                    : { tool_response: outcome.toolResponse }),
                });
              };
              if (batch.calls.length === 1) {
                await run(batch.calls[0]);
              } else {
                await Promise.all(batch.calls.map((call) => run(call)));
              }
            }

            // 影子事件 `classic.PostToolBatch`（spec「影子事件」）：这次模型响应
            // 里的整批工具都跑完之后报一次。「一批」指的是这一批（一次响应），不
            // 是上面为了并发切出来的那些小块。子代理的嵌套轮次不报。
            if (batchOutcomes.length > 0 && !this.subagentType) {
              this.getModManager()?.notifyMods("classic.PostToolBatch", {
                tool_calls: batchOutcomes,
              });
            }
          }

          // Update token statistics for display (compaction decision is
          // pre-request, see maybeAutoCompactBeforeRequest)
          this.updateLatestTotalTokens(result.usage);
          // 拿到一次 usage 就是「量了一次」：`session.measure` 是 mod 刷新用量
          // 类面板/带的唯一节拍，不靠用户去点（spec「用量的变化」）。子代理的
          // 嵌套轮次不报 —— 它用的是自己的 AIManager，mod 只关心主会话这一条。
          if (result.usage && !this.subagentType) {
            this.getModManager()?.notifyMods("session.measure", {
              changed: ["context", "tokens"],
            });
          }

          // Finalize text/reasoning blocks for the final response (no tools)
          this.messageManager.finalizeStreamingBlocks();

          // Check if there are tool operations or response was truncated, if so automatically initiate next AI service call
          if (toolCalls.length > 0 || result.finish_reason === "length") {
            // Check maxTurns limit before continuing
            if (this.maxTurns && turnDepth + 1 >= this.maxTurns) {
              logger?.debug(`Max turns (${this.maxTurns}) reached, stopping.`);
            } else {
              // Record committed snapshots to message history
              if (this.reversionManager) {
                const snapshots =
                  this.reversionManager.getAndClearCommittedSnapshots();
                if (snapshots.length > 0) {
                  this.messageManager.addFileHistoryBlock(snapshots);
                }
              }

              // Check interruption status
              const isCurrentlyAborted =
                abortController.signal.aborted ||
                toolAbortController.signal.aborted;

              // 手动转后台（Ctrl+B）不结束本轮：那条命令继续在后台跑，
              // 模型看到的回执里带着 backgroundTaskId，照常推进下一次调用
              // （与 Claude Code 一致——它唯一的转后台语义就是让前台等待
              // 立即返回）。
              if (!isCurrentlyAborted) {
                // If the response was truncated WITHOUT any tool calls,
                // enforce the consecutive recovery limit (aligned with Claude
                // Code's MAX_OUTPUT_TOKENS_RECOVERY_LIMIT = 3). Re-planning
                // loops that never produce output would otherwise continue
                // until the platform kills the task.
                if (
                  result.finish_reason === "length" &&
                  toolCalls.length === 0 &&
                  maxOutputTokensRecoveryCount >=
                    MAX_OUTPUT_TOKENS_RECOVERY_LIMIT
                ) {
                  this.messageManager.addNoticeBlock(
                    `Response exceeded the output token limit ${MAX_OUTPUT_TOKENS_RECOVERY_LIMIT + 1} consecutive times without producing output or tool calls. Stopped to avoid an infinite loop. Break the remaining work into smaller pieces and try again.`,
                    "error",
                    "turn",
                  );
                  break inner;
                }

                // If response was truncated, add a hidden continuation message
                if (result.finish_reason === "length") {
                  if (toolCalls.length === 0) {
                    // Pure truncation — count toward the recovery limit.
                    maxOutputTokensRecoveryCount++;
                  } else {
                    // Truncated with tool calls — real progress, reset the
                    // consecutive counter.
                    maxOutputTokensRecoveryCount = 0;
                  }
                  this.messageManager.addUserMessage({
                    content:
                      "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
                    isMeta: true,
                  });
                }

                // Yield to the event loop so macrotasks (abort timers,
                // signals) can be processed between turns. Without this,
                // mocked async operations (microtasks) would starve the
                // event loop and abort timers would never fire.
                await new Promise((resolve) => setImmediate(resolve));

                // Re-check abort status after yielding — the signal may
                // have fired during the setImmediate gap.
                if (
                  abortController.signal.aborted ||
                  toolAbortController.signal.aborted
                ) {
                  break inner;
                }

                turnDepth++;
                continue inner;
              }
            }
          }

          // No tool calls (or stop conditions) → inner loop done
          break inner;
        } catch (error) {
          // 错误路径同样带额度头（402 阻断 / 上游 429、5xx），读数照常交给宿主
          // ——「被限流 / 被阻断」这一刻正是用户最需要看到读数的时刻
          // （spec: desktop/desktop-account.md「额度响应头」）。
          const errorQuotaHeaders = quotaHeadersFromError(error);
          if (errorQuotaHeaders) {
            this.rememberQuotaHeaders(errorQuotaHeaders);
            this.callbacks?.onQuotaHeaders?.(errorQuotaHeaders);
          }

          // 用户取消不是故障（spec: enterprise/opentelemetry.md「事件级别与错误的
          // 可监控性」）：中断不记 error 事件，否则每按一次 Esc 都往监控里灌一条
          // ERROR，告警曲线直接失去意义。判据取中断信号本身 —— aiService 会把
          // AbortError 换成普通 Error，按文案判断会随文案改动失效（与上面取子任务
          // 结果时同一个口径）。中断后的界面收尾照旧走下面几步。
          // 控制器可能已被清空（重启 / 递归路径上取到的是 `this.abortController`
          // 的旧值），读不到信号时按未中断处理。
          const turnAborted =
            abortController?.signal.aborted === true ||
            toolAbortController?.signal.aborted === true;
          if (!turnAborted) {
            // 中断不算故障，也不进影子事件：用户按 Esc 收尾的一轮发
            // `classic.Stop`（`turn.complete` 带 `isAborted`），不发 StopFailure。
            turnError = {
              kind: classifyError(error),
              message: error instanceof Error ? error.message : String(error),
            };
            logOTelEvent(
              "error",
              {
                error_type:
                  error instanceof Error ? error.constructor.name : "Unknown",
                // 闭集类别：客户端自抛的错误 error_type 恒为 "Error"，只有类别能
                // 当监控侧的维度用。
                "error.category": classifyError(error),
                message: error instanceof Error ? error.message : String(error),
              },
              this.telemetryContext,
            ).catch(() => {}); // Non-blocking
          }

          // Finalize any streaming text/reasoning blocks so the UI stops ticking
          // its in-progress timer (e.g. when the request is aborted mid-thought).
          this.messageManager.finalizeStreamingBlocks();

          // Finalize any tool blocks stuck in start/streaming/running so the UI
          // stops showing the yellow "running" spinner (e.g. abort mid-tool-stream).
          this.messageManager.finalizeAbortedToolBlocks(
            error instanceof Error ? error.message : undefined,
          );

          // 用户中断不是故障，不带 `scope`：宿主用 `"turn"` 判「任务出错」，而中断的
          // notice 晚于 `abortMessage()` 同步派发的下一条排队消息，带上会记到下一轮。
          const noticeText =
            error instanceof Error ? error.message : "Unknown error occurred";
          if (turnAborted) {
            this.messageManager.addNoticeBlock(noticeText, "error");
          } else {
            this.messageManager.addNoticeBlock(noticeText, "error", "turn");
          }

          // Exit inner loop on error
          break inner;
        }
      }

      // Finally-equivalent (runs once per outer iteration):
      // Only execute cleanup and hooks for the initial call
      if (turnOffset === 0) {
        // Save session in each iteration to ensure message persistence
        await this.messageManager.saveSession();

        // Clear temporary rules
        this.permissionManager?.clearTemporaryRules();

        // Clear abort controllers (only if we still own them — a concurrent
        // turn may have already registered its own controller, and clearing
        // it would orphan that turn and make it uninterruptible)
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        if (this.toolAbortController === toolAbortController) {
          this.toolAbortController = null;
        }

        // Execute Stop/SubagentStop hooks only if the operation was not aborted
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;
        turnAborted = isCurrentlyAborted;

        const messageQueue = this.getMessageQueue();

        if (!isCurrentlyAborted) {
          // Record committed snapshots to message history for the final turn
          if (this.reversionManager) {
            const snapshots =
              this.reversionManager.getAndClearCommittedSnapshots();
            if (snapshots.length > 0) {
              this.messageManager.addFileHistoryBlock(snapshots);
            }
          }

          // Execute Stop hooks
          const shouldContinue = await this.executeStopHooks();

          // If Stop/SubagentStop hooks indicate we should continue (due to blocking errors),
          // restart the AI conversation cycle
          if (shouldContinue) {
            // A user message queued while this turn ran wins over the hook's
            // restart: end the turn instead, so the queue dispatches it.
            //
            // Claude Code behaves the same way — a blocked stop ends the turn
            // and the queued message becomes the next one. Without this, a hook
            // that never lets the turn end (a loop hook that keeps re-prompting
            // until its own condition is met) starves the queue forever: the
            // user's /cancel can never run, and Escape then throws the queued
            // message away.
            const queuedUserMessage = messageQueue
              ?.getQueue()
              .some((queued) => queued.type !== "notification");

            if (queuedUserMessage) {
              logger?.info(
                `${this.subagentType ? "SubagentStop" : "Stop"} hooks asked to continue, but a user message is queued — ending the turn so it runs first`,
              );
            } else {
              logger?.info(
                `${this.subagentType ? "SubagentStop" : "Stop"} hooks indicate issues need fixing, continuing conversation...`,
              );

              // Restart the conversation to let AI fix the issues
              shouldRestart = true;
              turnOffset = 0;
            }
          }
        }

        // Inject pending notifications from background tasks (after Stop hooks,
        // aligned with Claude Code which fires Stop hooks unconditionally).
        // Skip injection when this turn was aborted: folding a pending
        // notification in would restart the loop and resurrect the aborted
        // turn — if a concurrent sendMessage is already running (e.g. the
        // queue's "send now" button), it would spawn a second, orphaned,
        // uninterruptible agent loop. The notification stays queued for the
        // next turn.
        if (
          messageQueue &&
          messageQueue.hasNotifications() &&
          !isCurrentlyAborted
        ) {
          await this.injectTaskNotifications(messageQueue.drainNotifications());
          // Re-assert loading state before restarting: if this turn was
          // aborted, abortAIMessage already reset loading to false, and the
          // restart below continues the conversation — the UI must show
          // streaming again (cursor, stop button, ESC handling).
          this.setIsLoading(true);
          // Adopt the current (possibly abort-bumped) generation so this
          // continued turn's end-of-turn cleanup is not skipped as superseded.
          myGeneration = this.turnGeneration;
          // Restart outer loop to process the notifications
          shouldRestart = true;
          turnOffset = 0;
        }

        // 一轮真的要收尾之前，最后问一遍 mods：`classic.Stop` / `classic.SubagentStop`
        // 是仅有的两条带返回通道的影子事件（spec ecosystem/plugin-mods.md「一轮收尾
        // 时的非错误反馈」）。插件要说的话（`additionalContext`）会作为一条 meta 消息
        // 回到对话里（子代理那条回到**子代理自己的**对话）、这一轮继续跑；因此它在这
        // 里（`turn.complete` 之前）发 —— 只有拿到返回值才知道这一轮算不算收尾，有反
        // 馈时 `turn.complete` 留给真正收尾的那一次报（`turnUsage` / `turnStartedAt`
        // 跨续跑累计，报的仍是整段）。
        if (!shouldRestart) {
          const mods = this.getModManager();
          const hookLabel = this.subagentType
            ? "classic.SubagentStop"
            : "classic.Stop";
          const lastAnswer = this.lastAssistantText();
          // 这次收尾是不是已经处在一次续跑里（与 settings 钩子共用同一个状态）。
          const stopHookActive =
            this.stopHookActive || this.modStopContextCount > 0;
          let stopContexts: string[] = [];
          // 因错误结束的一轮不发这条通道（主代理发的是 `classic.StopFailure`，子代理
          // 由实例释放时的补报兜底）。
          if (mods && !turnError) {
            if (this.subagentType) {
              const transcriptPath = this.subagentTranscriptPath?.();
              stopContexts = await mods.collectSubagentStopContext({
                // 子代理的 id 由 `SubagentManager` 在构造时给；父代理一个子代理都不
                // 管，所以真正派发时它一定在。
                agent_id: this.subagentId ?? "",
                agent_type: this.subagentType,
                stop_hook_active: stopHookActive,
                // 已经有答案就交出去（`last_assistant_message`，CC 同名字段）：插件
                // 不必自己去读转录解 JSONL。中断的一轮可能没有答案，省略。
                ...(lastAnswer ? { last_assistant_message: lastAnswer } : {}),
                ...(transcriptPath
                  ? { agent_transcript_path: transcriptPath }
                  : {}),
              });
              // 收尾事件已经报过：实例释放时不再补一次（补报只给出错 / 中止路径）。
              this.onSubagentStopDispatched?.();
            } else {
              const backgroundTasks = (
                this.backgroundTaskManager?.getAllTasks() ?? []
              )
                .filter((task) => task.status === "running")
                .map((task) => mapBackgroundTask(task, this.subagentManager));
              stopContexts = await mods.collectStopContext({
                background_tasks: backgroundTasks,
                stop_hook_active: stopHookActive,
                ...(lastAnswer ? { last_assistant_message: lastAnswer } : {}),
              });
            }
          }
          if (stopContexts.length > 0) {
            // 中断的一轮、以及已有一条用户消息在排队的收尾都不续跑（照 CC 的
            // 口径：中断就是中断，排队的消息下一轮先跑，否则它会一直饿着）。
            const queuedUserMessage = messageQueue
              ?.getQueue()
              .some((queued) => queued.type !== "notification");
            if (turnAborted || queuedUserMessage) {
              logger?.info(
                `${hookLabel} 要求继续，但${turnAborted ? "这一轮被中断" : "队列里有用户消息"} — 照常收尾`,
              );
            } else if (
              this.modStopContextCount >= MOD_LIMITS.stopHookContinuationCap
            ) {
              logger?.warn(
                `${hookLabel} 已经让这一轮续跑 ${this.modStopContextCount} 次，达到上限 — 丢弃这次的 additionalContext`,
              );
            } else {
              this.modStopContextCount++;
              this.injectStopHookContext(stopContexts);
              // 与后台任务通知同一条重启路径：界面必须重新进入「生成中」。
              this.setIsLoading(true);
              myGeneration = this.turnGeneration;
              shouldRestart = true;
              turnOffset = 0;
            }
          }
        }
      }

      if (!shouldRestart) {
        // Release loading state only after ALL cleanup is done (session save,
        // Stop hooks, notification injection). Generation check ensures a
        // superseded (aborted or newer) turn doesn't clobber the current
        // loading state.
        if (myGeneration === this.turnGeneration) {
          this.setIsLoading(false);
        }
        if (ownsTurnSnapshot) {
          this.liveConfigManager?.onTurnEnd();
        }
        // Tell the mods the conversation is done (spec ecosystem/plugin-mods.md
        // 「完成与审批的观察」). Read-only and fire-and-forget: a mod reporting to
        // its own server must not hold up the idle state we just released. Only
        // the main agent's turns own this event — a subagent's nested turn is
        // not what the user sees as "the answer finished", and `turnOffset !== 0`
        // leftovers are recursion, not turn ends.
        if (turnOffset === 0 && !this.subagentType) {
          const mods = this.getModManager();
          mods?.notifyMods("turn.complete", {
            turnId,
            isAborted: turnAborted,
            durationMs: Date.now() - turnStartedAt,
            answer: this.lastAssistantText() ?? "",
            usage: turnUsage,
          });
          // 影子事件（spec「影子事件」）：因错误结束的一轮补发 `StopFailure`
          // （`classic.Stop` 已经在上面、收尾判断之前发过了 —— 它要拿返回值，见
          // 那段注释）。
          if (turnError) {
            mods?.notifyMods("classic.StopFailure", { error: turnError });
          }
          // 这一轮已经收尾：之后的 `$.turn.abort` 该拿到「没有一轮在跑」，而不是
          // 悄悄收掉下一轮。
          this.currentTurnId = undefined;
        }
        break outer;
      }
    }
  }

  /**
   * Shared MessageQueue, when the container has one. Subagents own a separate
   * queue (createInstance registers one per subagent), so resolving it through
   * the container keeps each agent draining only its own notifications.
   */
  private getMessageQueue(): MessageQueue | undefined {
    return this.container.has("MessageQueue")
      ? this.container.get<MessageQueue>("MessageQueue")
      : undefined;
  }

  /**
   * ModManager, resolved through the container like the message queue: the token
   * belongs to the main agent's container (a subagent reaches it through its
   * child container). A missing one is not an error — the turn reports to nobody.
   */
  private getModManager(): ModManager | undefined {
    return this.container.has("ModManager")
      ? this.container.get<ModManager>("ModManager")
      : undefined;
  }

  /**
   * 派发 `prompt.attachment`：宿主自己要往对话里加一条消息之前（spec
   * ecosystem/plugin-mods.md「系统提示词与附件」）。
   *
   * 返回 `null` 表示这条不要 —— 这是插件唯一能压掉一条宿主消息的通道。交给插
   * 件的是**没包 `system-reminder` 的正文**：那层标签是宿主与模型之间的约定，
   * 插件改的是内容，包壳留在宿主这边（`wrapInSystemReminder`）。
   */
  private async rewriteAttachment(
    type: string,
    text: string,
  ): Promise<string | null> {
    const mods = this.getModManager();
    if (!mods) return text;
    return mods.rewritePromptAttachment({ type, text });
  }

  /**
   * 派发 `prompt.context`：这场会话的上下文块，**一条会话一次**（spec「系统提
   * 示词与附件」）。
   *
   * 落在第一轮的消息快照之前，所以第一个请求就带上了它；用 session id 记住问
   * 过哪一场 —— `/clear`、恢复会话、压缩都会换 session id，换了就等于新的一场，
   * 不需要另外的重置点。与 `prompt.submit` 的 `{ context }` 不是一回事：那条每
   * 轮都能塞、只作用于本轮。
   */
  private async injectSessionPromptContext(): Promise<void> {
    const mods = this.getModManager();
    if (!mods) return;

    const sessionId = this.messageManager.getSessionId();
    if (this.sessionPromptContextFor === sessionId) return;
    // 先记后问：钩子抛错时不能变成「每个请求都重问一遍」。
    this.sessionPromptContextFor = sessionId;

    const blocks = await mods.collectSessionContextBlocks();
    for (const block of blocks) {
      if (!block.text.trim()) continue;
      this.messageManager.addUserMessage({
        content: wrapInSystemReminder(block.text),
        isMeta: true,
      });
    }
  }

  /**
   * The last assistant message's text, trimmed — `undefined` when there is none.
   *
   * Two readers: the Stop hook context (so a hook can inspect the final response
   * without reading the transcript) and the `turn.complete` mod event's `answer`
   * (spec ecosystem/plugin-mods.md「完成与审批的观察」).
   */
  private lastAssistantText(): string | undefined {
    const lastAssistant = [...this.messageManager.getMessages()]
      .reverse()
      .find((m) => m.role === "assistant");
    if (!lastAssistant) return undefined;
    return (
      lastAssistant.blocks
        .filter((b) => b.type === "text")
        .map((b) => b.content)
        .join("\n")
        .trim() || undefined
    );
  }

  /**
   * 影子事件 `classic.MessageDisplay`（spec「影子事件」）：一条 assistant 消息
   * 的正文定型时报一次。
   *
   * 我们不分 flush：CC 每攒够几行派发一次、`index` 递增、`final` 只在最后一次
   * 为真；这里一条消息只给一次全文，所以 `index` 恒 `0`、`final` 恒 `true`、
   * `delta` 就是完整正文（按限额截断）。没有正文的消息（只带工具调用的那种）不
   * 报 —— 报一个空 `delta` 只会让透明类插件画一行空白。
   */
  private notifyMessageDisplay(
    turnId: string,
    messageId: string | undefined,
  ): void {
    if (this.subagentType || messageId === undefined) return;
    const mods = this.getModManager();
    if (!mods) return;
    const message = this.messageManager
      .getMessages()
      .find((item) => item.id === messageId);
    const text = (message?.blocks ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n")
      .trim();
    if (text.length === 0) return;
    mods.notifyMods("classic.MessageDisplay", {
      turn_id: turnId,
      message_id: messageId,
      index: 0,
      final: true,
      delta: truncateForModEvent(text),
    });
  }

  /**
   * Write background-task notifications into the message history as hidden
   * (isMeta) user messages, returning how many landed.
   *
   * All three injection points go through here: the request boundary mid-turn,
   * the end-of-turn drain, and the idle wake-up in Agent.processQueuedMessage.
   * Callers pass already-drained XML, so injection *is* the consumption step —
   * the same notification can never be injected twice.
   *
   * 这是 `prompt.attachment` 的 `background-task` 档（spec「系统提示词与附
   * 件」）：插件拿到的是那条通知的原文（XML），可以改也可以
   * 用 `{ text: null }` 压掉 —— 压掉即当它没来过，不会重投。
   */
  public async injectTaskNotifications(
    xmls: readonly string[],
  ): Promise<number> {
    let injected = 0;
    for (const xml of xmls) {
      const attachment = await this.rewriteAttachment("background-task", xml);
      if (attachment === null) continue;
      const block = parseTaskNotificationXml(attachment);
      if (!block) continue;
      this.messageManager.addNotificationMessage({
        taskId: block.taskId,
        taskType: block.taskType,
        status: block.status,
        summary: block.summary,
        outputFile: block.outputFile,
        result: block.result,
        usage: block.usage,
      });
      injected++;
    }
    return injected;
  }

  /**
   * 把 mods 在 `classic.Stop` 里塞回来的 `additionalContext` 写进对话（spec
   * ecosystem/plugin-mods.md「一轮收尾时的非错误反馈」）。
   *
   * 与后台任务通知同一种形态：`isMeta` 的用户消息 —— 模型会读到它，界面不当成
   * 用户说的话。开头那一句是给模型看的，说明这不是用户、也不是错误，免得它去
   * 「道歉并重新开始」。
   */
  private injectStopHookContext(contexts: readonly string[]): void {
    const content = [
      "插件在这一轮收尾时提醒（不是用户说的话，也不是错误）：",
      ...contexts.map((text) => `- ${text}`),
    ].join("\n");
    this.messageManager.addUserMessage({ content, isMeta: true });
  }

  /**
   * Execute Stop or SubagentStop hooks when AI response cycle completes
   * Uses "SubagentStop" hook name when triggered by a subagent, otherwise uses "Stop"
   * @returns Promise<boolean> - true if should continue conversation, false if should stop
   */
  private async executeStopHooks(): Promise<boolean> {
    if (!this.hookManager) return false;

    try {
      // Use "SubagentStop" hook name when triggered by a subagent, otherwise use "Stop"
      const hookName = this.subagentType ? "SubagentStop" : "Stop";

      // For main-agent Stop events, snapshot running background tasks and
      // session cron jobs so the hook can decide whether to block stopping.
      // SubagentStop does not include these fields (per spec FR-065).
      const backgroundTasks: BackgroundTaskInfo[] | undefined =
        hookName === "Stop"
          ? (this.backgroundTaskManager?.getAllTasks() ?? [])
              .filter((t) => t.status === "running")
              .map((t) => mapBackgroundTask(t, this.subagentManager))
          : undefined;

      const sessionCrons: SessionCronInfo[] | undefined =
        hookName === "Stop"
          ? (this.cronManager?.listJobs() ?? []).map((j) => ({
              id: j.id,
              schedule: j.cron,
              recurring: j.recurring,
              prompt: j.prompt,
            }))
          : undefined;

      // Extract text content from the last assistant message so hooks can
      // inspect the final response without reading the transcript file.
      const lastAssistantText = this.lastAssistantText();

      const context: ExtendedHookExecutionContext = {
        event: hookName,
        projectDir: this.getCurrentWorkdir(),
        timestamp: new Date(),
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getCurrentWorkdir(),
        subagentType: this.subagentType, // Include subagent type in hook context
        backgroundTasks, // Stop-only: running background tasks snapshot
        sessionCrons, // Stop-only: session cron jobs snapshot
        lastAssistantMessage: lastAssistantText, // Stop/SubagentStop: last assistant message text
        stopHookActive: this.stopHookActive, // Stop/SubagentStop: already continued by a stop hook
        permissionMode: this.getModelConfig().permissionMode,
        // Stop hooks don't need toolName, toolInput, toolResponse, or userPrompt
        env: Object.fromEntries(
          Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(hookName, context);

      // Process hook results to handle exit codes and appropriate responses
      let shouldContinue = false;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          hookName,
          results,
          this.messageManager,
        );

        // If hook processing indicates we should block (exit code 2, or
        // `{"decision":"block"}` on stdout), continue the conversation.
        if (processResult.shouldBlock) {
          logger?.info(
            `${hookName} hook blocked stopping with error:`,
            processResult.errorMessage,
          );
          shouldContinue = true;
        }
        // Remember across turns whether this continuation came from a stop
        // hook, so the next Stop sees `stop_hook_active: true` (Claude Code's
        // circuit breaker for hooks that block unconditionally).
        this.stopHookActive = processResult.shouldBlock;
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} ${hookName} hook(s):`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      // Trigger auto-memory extraction if enabled and this is the main agent
      if (!this.subagentType) {
        const autoMemoryService =
          this.container.get<
            import("../services/autoMemoryService.js").AutoMemoryService
          >("AutoMemoryService");
        if (autoMemoryService) {
          // Trigger extraction, but don't block the return.
          // onTurnEnd itself returns quickly after forking.
          autoMemoryService.onTurnEnd(this.getCurrentWorkdir()).catch((err) => {
            logger?.error("Auto-memory extraction trigger failed:", err);
          });
        }
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error(
        `${this.subagentType ? "SubagentStop" : "Stop"} hook execution failed:`,
        error,
      );
      return false;
    }
  }

  /**
   * Execute a single tool call: arg parsing, block emission, PreToolUse hooks,
   * tool execution, PostToolUse hooks, and error handling.
   *
   * Returns what `classic.PostToolBatch` reports per call: whether it ran at all
   * is no longer the whole answer — the batch payload carries `tool_input` and
   * `tool_response` (spec「影子事件」), so the parsed args and the result text
   * come back from here instead of being re-derived in the caller.
   */
  private async executeToolCall(
    functionToolCall: ChatCompletionMessageFunctionToolCall,
    abortController: AbortController,
    toolAbortController: AbortController,
    /**
     * The tool names this request declared (`tools[]`). A `tool_use` outside it is
     * answered with an error instead of being executed — see
     * `ToolManager.undeclaredToolResult`.
     */
    declaredToolNames: ReadonlySet<string>,
    finishReason?: string | null,
  ): Promise<{
    ok: boolean;
    toolInput?: Record<string, unknown>;
    toolResponse?: unknown;
  }> {
    const toolId = functionToolCall.id || "";

    // Check if already interrupted, skip tool execution if so
    if (abortController.signal.aborted || toolAbortController.signal.aborted) {
      return { ok: false };
    }

    const toolName = functionToolCall.function?.name || "";
    // Safely parse tool parameters, handle tools without parameters
    let toolArgs: Record<string, unknown> = {};
    let jsonRecovered = false;
    const argsString = functionToolCall.function?.arguments?.trim();

    if (!argsString || argsString === "") {
      // Tool without parameters, use empty object
      toolArgs = {};
    } else {
      let recoveredArgs = argsString;
      try {
        toolArgs = JSON.parse(argsString);
      } catch {
        // Attempt to recover truncated JSON (e.g., missing closing braces)
        recoveredArgs = recoverTruncatedJson(argsString);
        try {
          toolArgs = JSON.parse(recoveredArgs);
          jsonRecovered = true;
          logger.warn(`Recovered truncated JSON for tool "${toolName}"`);
        } catch (parseError) {
          let errorMessage = `Failed to parse tool arguments`;
          if (finishReason === "length") {
            errorMessage += " (output truncated, please reduce your output)";
          }
          logger?.error(errorMessage, parseError);
          this.messageManager.updateToolBlock({
            id: toolId,
            parameters: argsString,
            result: errorMessage,
            success: false,
            error: errorMessage,
            stage: "end",
            name: toolName,
            compactParams: "",
            timestamp: Date.now(),
          });
          return { ok: false };
        }
      }
    }

    const compactParams = this.generateCompactParams(toolName, toolArgs);

    // Emit start stage for non-streaming tool calls
    if (!this.stream) {
      this.messageManager.updateToolBlock({
        id: toolId,
        stage: "start",
        name: toolName,
        compactParams,
        parameters: argsString,
      });
    }

    // Emit running stage (tool execution about to start)
    this.messageManager.updateToolBlock({
      id: toolId,
      stage: "running",
      name: toolName,
      compactParams,
      parameters: argsString,
      parametersChunk: "",
    });

    try {
      // Create tool execution context
      const context: ToolContext = {
        abortSignal: toolAbortController.signal,
        backgroundTaskManager: this.backgroundTaskManager,
        workdir: this.getCurrentWorkdir(),
        originalWorkdir: this.originalWorkdir,
        messageId: this.messageManager.getMessages().slice(-1)[0]?.id,
        sessionId: this.messageManager.getSessionId(),
        replSessionKey: this.replContextKey(),
        toolCallId: toolId,
        // What the model was allowed to name, carried by the call itself: the
        // rejection happens in the tool funnel, where every model call lands, and
        // nowhere else (a REPL script's second hop drops this — see `ToolContext`).
        declaredToolNames,
        taskManager: this.taskManager,
        readFileState: this.readFileState,
        onShortResultUpdate: (shortResult: string) => {
          this.messageManager.updateToolBlock({
            id: toolId,
            shortResult,
            stage: "running",
            compactParams,
            name: toolName,
          });
        },
        onCwdChange: async (newCwd: string) => {
          const oldCwd = this.getCurrentWorkdir();
          this.container.register("CurrentWorkdir", newCwd);
          this._onCwdChange?.(newCwd);
          if (this.hookManager) {
            const sessionId = this.messageManager.getSessionId();
            const transcriptPath = this.messageManager.getTranscriptPath();
            const env = Object.fromEntries(
              Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
            ) as Record<string, string>;
            await this.hookManager.executeCwdChangedHooks(
              oldCwd,
              newCwd,
              sessionId,
              transcriptPath,
              env,
            );
          }
        },
      };

      // Execute tool
      const toolResult = await this.toolManager.execute(
        functionToolCall.function?.name || "",
        toolArgs,
        context,
      );

      // MCP tools can return images (e.g. Figma screenshots) as in-memory
      // base64. When this agent's model cannot see them, persist each image to
      // a temp file so the non-vision path in convertMessagesForAPI can attach
      // `[Image source: <path>]` metadata and the main model can delegate
      // recognition to the vision subagent. Vision-capable models keep the
      // inline base64 — no disk writes.
      let toolImages: ToolImage[] | undefined = toolResult.images;
      if (
        toolImages &&
        toolImages.length > 0 &&
        !supportsVision(this.getModelConfig().capabilities)
      ) {
        toolImages = persistToolImages(toolImages);
      }

      // Budget the images *here* rather than only on the way out (spec
      // ui/image-pasting.md「工具产图与 Read 图片在入口就降到预算内」): the block
      // stores the shrunk bytes, so the request body, the host's message cache
      // and the renderer all hold one small copy instead of the original
      // base64. See utils/toolImageIngest.ts.
      if (toolImages && toolImages.length > 0) {
        toolImages = await applyToolImageBudget(toolImages);
      }

      // 模型这次读到的 tool_result 文本（issue #3055 阶段 2）：`data` 是结构化真相，
      // 文本由 `tools/resultData/` 的渲染器从它现场生成；渲不出这段文本时才退回工具
      // 当场的 `content`（表外工具、以及 `Read` 的图片 / pdf / 二进制这些没有文本形态
      // 的结果），content 也空且带 error 时仍给一句 `Error: …`。
      const renderedText = renderToolResultData(toolName, toolResult.data);
      let toolResultContent =
        renderedText ??
        (toolResult.content ||
          (toolResult.error ? `Error: ${toolResult.error}` : ""));
      if (jsonRecovered) {
        toolResultContent +=
          "\n\nTool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls.";
      }

      // 落盘口径（issue #3055 阶段 2 · 双写）：**两份都写**。
      //
      // - `result` 是模型这次真正读到的那段文本，原样留下。它也是唯一能兜住
      //   `jsonRecovered` 的分支（那半句截断提示是 aiManager 事后追加的，`data`
      //   里没有），以及表外工具（MCP、插件工具没有渲染器）的唯一文本来源；
      // - `data` 是结构化的骨架，交给宿主卡片与脚本。正文已经在 `result` 里了，
      //   所以落盘前按工具剥掉大块载荷（`tools/resultData/strip.ts`，对齐 CC 的
      //   `stripForStorage`）——只剥这份副本，`toolResult.data` 原件保持完整，
      //   上面那句 `renderedText` 与 mod 事件的 `toolResponse` 都是在原件上取的。
      //
      // `data === undefined` 时不写这个键：`updateToolBlock` 把 `undefined` 当
      // 「这次不改这一格」，老形态工具（只给 `content`）留下的 `data` 不该被清空。

      // Update message state - tool execution completed
      this.messageManager.updateToolBlock({
        id: toolId,
        parameters: argsString,
        ...(toolResult.data === undefined
          ? {}
          : { data: stripToolResultDataForStorage(toolName, toolResult.data) }),
        result: toolResultContent,
        success: toolResult.success,
        error: toolResult.error,
        stage: "end",
        name: toolName,
        compactParams,
        shortResult: toolResult.shortResult,
        backgroundTaskId: toolResult.backgroundTaskId,
        backgroundedByUser: toolResult.backgroundedByUser,
        assistantAutoBackgrounded: toolResult.assistantAutoBackgrounded,
        nestedToolCalls: toolResult.nestedToolCalls,
        startLineNumber: toolResult.startLineNumber,
        images: toolImages,
        timestamp: Date.now(),
      });

      // 工具调用结束（成功或失败都算）：把 mod 贴在这次调用下面的 notice 撤掉
      // （spec「工具行下面的一行」）。位置就是「结果块定型之后」——
      // `classic.PostToolUse` 与 PostToolUse 钩子都在 `toolManager.execute()` 里
      // 就报完了（toolManager 那边 `notifyModToolOutcome` 与钩子都在 execute 返回
      // 之前），所以那一刻贴的行到这里也算「工具已经结束」，一并收掉；插件不必在
      // `turn.complete` 里自己清理。
      this.getModManager()?.clearToolNotices(toolId);

      // Plan panel refresh (spec: 计划文件更新后刷新计划面板): a successful
      // Write/Edit of the plan file broadcasts the new content so hosts can
      // update an already-open plan panel without waiting for ExitPlanMode.
      await this.notifyPlanFileUpdate(toolName, toolArgs, toolResult.success);
      return {
        ok: toolResult.success,
        toolInput: toolArgs,
        // 成功的调用带 `data` 本身（CC 的 PostToolBatch 同形，`tool_response`
        // 是可选的，失败那次只有 `tool_use_id` 在）。体积由
        // `toolResponseForModEvent` 兜住：对象的 JSON 长度超过那份字符限额时
        // 退回截断文本，别把一整份结果递进每个插件。
        ...(toolResult.success
          ? {
              toolResponse: toolResponseForModEvent(
                toolResult.data,
                toolResultContent,
              ),
            }
          : {}),
      };
    } catch (toolError) {
      const errorMessage =
        toolError instanceof Error ? toolError.message : String(toolError);

      this.messageManager.updateToolBlock({
        id: toolId,
        parameters: JSON.stringify(toolArgs, null, 2),
        result: `Tool execution failed: ${errorMessage}`,
        success: false,
        error: errorMessage,
        stage: "end",
        name: toolName,
        compactParams,
        timestamp: Date.now(),
      });
      // 同一条收口也走异常路径：mod 可能在这个工具里已经贴过一行，工具抛了不该
      // 把它留在块下面（spec「工具行下面的一行」：成功与失败都算结束）。
      this.getModManager()?.clearToolNotices(toolId);
      return { ok: false, toolInput: toolArgs };
    }
  }

  /**
   * Plan panel refresh (spec: 计划文件更新后刷新计划面板).
   *
   * When a successful `Write`/`Edit` targets the current plan file, read it and
   * emit the full content so hosts can update an already-open plan panel. The
   * path comparison mirrors the plan-mode allow branch in PermissionManager so
   * "the write that was allowed" and "the write that refreshes the panel" stay
   * the same set. The path is only set while plan mode is active, so post-exit
   * writes can't reach the panels.
   */
  private async notifyPlanFileUpdate(
    toolName: string,
    toolArgs: Record<string, unknown>,
    success: boolean,
  ): Promise<void> {
    if (!success) return;
    if (toolName !== WRITE_TOOL_NAME && toolName !== EDIT_TOOL_NAME) return;

    const targetPath = toolArgs.file_path;
    if (typeof targetPath !== "string" || targetPath.trim() === "") return;

    const planFilePath = this.container
      .get<PermissionManager>("PermissionManager")
      ?.getPlanFilePath();
    if (!planFilePath) return;
    if (path.resolve(targetPath) !== path.resolve(planFilePath)) return;

    try {
      const content = await readFile(planFilePath, "utf8");
      this.callbacks?.onPlanFileUpdated?.(content);
    } catch (error) {
      logger?.warn(
        `Failed to read plan file for panel refresh: ${planFilePath}`,
        error,
      );
    }
  }
}
