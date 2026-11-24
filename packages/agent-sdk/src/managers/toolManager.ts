import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import {
  reportToolCrash,
  reportToolFailure,
} from "../telemetry/failureEvents.js";
import type { StandardAttributeContext } from "../telemetry/attributes.js";
import type { ModManager } from "./modManager.js";
import { truncateForModEvent } from "../mods/text.js";
import { validateToolInput } from "../tools/inputValidation.js";
import { bashTool } from "../tools/bashTool.js";
import { powershellTool } from "../tools/powershellTool/powershellTool.js";
import { taskStopTool } from "../tools/taskStopTool.js";
import { editTool } from "../tools/editTool.js";
import { writeTool } from "../tools/writeTool.js";
import { exitPlanModeTool } from "../tools/exitPlanMode.js";
import { enterPlanModeTool } from "../tools/enterPlanMode.js";
import { askUserQuestionTool } from "../tools/askUserQuestion.js";
import { cronCreateTool } from "../tools/cronCreateTool.js";
import { cronDeleteTool } from "../tools/cronDeleteTool.js";
import { cronListTool } from "../tools/cronListTool.js";
import { webFetchTool } from "../tools/webFetchTool.js";
import { webSearchTool } from "../tools/webSearchTool.js";
import { sendUserFileTool } from "../tools/sendUserFileTool.js";
import { artifactTool } from "../tools/artifactTool.js";
import { replTool } from "../tools/replTool.js";
import { artifactCommentsTool } from "../tools/artifactCommentsTool.js";
import { pollTool } from "../tools/pollTool.js";
import { isArtifactEnabled } from "../services/artifactAvailability.js";
import { isKnowledgeBaseEnabled } from "../services/knowledgeBaseAvailability.js";
import {
  isWebSearchAvailable,
  isWebSearchEnabledBySettings,
} from "../services/webSearchAvailability.js";
import { isTaskToolsEnabled } from "../services/taskToolsAvailability.js";
import {
  collectShellToolGateInput,
  isPowerShellToolEnabled,
} from "../utils/shell/shellToolGate.js";
import { knowledgeBaseTools } from "../tools/knowledgeBase/index.js";
import {
  getNonDeferrableBuiltins,
  isReplEnabled,
  isReplCoreToolsEnabled,
} from "../services/replAvailability.js";
import { isLeanPromptEnabled } from "../services/leanPrompt.js";
import { buildReplPool, toolExpression } from "../repl/catalog.js";
import type { ReplPoolCandidate, ReplPoolEntry } from "../repl/catalog.js";
import { STRUCTURAL_NON_DEFERRABLE } from "../repl/deferral.js";
import {
  REPL_TOOL_NAME,
  SEND_USER_FILE_TOOL_NAME,
  isShellToolName,
} from "../constants/tools.js";
import type { SessionConsumers } from "../services/sessionConsumers.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { grepTool } from "../tools/grepTool.js";
import { readTool } from "../tools/readTool.js";
import { lspTool } from "../tools/lspTool.js";
import { agentTool } from "../tools/agentTool.js";
import { skillTool } from "../tools/skillTool.js";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../tools/taskManagementTools.js";
import { enterWorktreeTool } from "../tools/enterWorktreeTool.js";
import { exitWorktreeTool } from "../tools/exitWorktreeTool.js";
import { workflowTool } from "../tools/workflowTool.js";
import { McpManager } from "./mcpManager.js";
import type { MessageManager } from "./messageManager.js";
import { PermissionManager } from "./permissionManager.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import type {
  PermissionMode,
  PermissionCallback,
  ILspManager,
} from "../types/index.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";
import { HookBlockedToolError } from "../types/hooks.js";

import { ReversionManager } from "./reversionManager.js";
import * as aiService from "../services/aiService.js";

import { Container } from "../utils/container.js";
import { appendMemoryCapNotice } from "../utils/memoryCapNotices.js";

import { logger } from "../utils/globalLogger.js";
import { shouldRegisterSearchTools } from "../utils/searchToolsRegistration.js";

import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";
import {
  recordLinesChanged,
  recordToolActivity,
} from "../telemetry/metrics.js";
import type { RecordContext } from "../telemetry/metrics.js";
import { entrypointOf } from "../telemetry/attributes.js";
import { detectShellActivity } from "../telemetry/toolActivity.js";
import { trackCliOperation } from "../telemetry/activity.js";

/** `tool.describe` 给这一场会话的那一份答案（spec「给工具、技能、命令写描述」）。 */
interface DescribedTool {
  description: string;
  /**
   * 插件对「平铺还是进 `REPL` 池」的最终裁决；没给就是没意见。它覆盖延迟判定
   * 表的结论，唯一翻不动的是结构豁免（`REPL` 自己）。
   */
  isDeferred?: boolean;
}

export interface ToolManagerOptions {
  container: Container;
  /** Optional list of tool names to enable */
  tools?: string[];
  /**
   * Optional list of tool names to disable. Applied after `tools`: an empty
   * `tools` list means "everything", so a blacklist alone yields "all tools
   * except these".
   */
  disallowedTools?: string[];
  /** Custom tools to register alongside built-in tools */
  customTools?: ToolPlugin[];
}

/**
 * The session a tool call belongs to, for the standard attributes of the
 * records it produces. The tool context is the one place every call passes
 * through, so both the flat and the nested (REPL sandbox) path have it; the
 * entrypoint comes from the container instead — it is a property of the session,
 * not of the call, and the context is rebuilt per call.
 *
 * The directory likewise comes from the container's `SessionWorkdir`, not from
 * `context.workdir`: the context carries the directory the tools run in, which
 * follows the shell after a `cd`, while the repository a record is filed under
 * must stay the one the session was opened in.
 */
function recordContextOf(
  context: {
    sessionId?: string;
    workdir?: string;
  },
  container: Container,
): RecordContext {
  return {
    sessionId: context.sessionId,
    workdir: container.get<string>("SessionWorkdir") ?? context.workdir,
    entrypoint: entrypointOf(container),
  };
}

/**
 * 把 mod 给的 `{ result }` 变成模型读到的工具结果文本（spec「把我们自己的工具
 * 交给模型」：任意 JSON，序列化后交给模型）。
 *
 * 字符串原样给出 —— 插件写 `{ result: "42" }` 想要的大概就是那一行 `42`，再套
 * 一层引号会让模型把它当字段读。序列化失败（含环、BigInt）退化成 `String()`：
 * 结果里有环是插件的 bug，但让整次调用抛错更糟，模型至少能看到点东西。
 */
function renderModToolResult(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return String(value);
  }
}

/**
 * `tool.call` 交上来的 `{ result }` → 一份工具结果。
 *
 * 两条来源共用这一处：mod 的 `next(e)` 真跑出来的就是 `ToolResult`（原样用，
 * 失败标记要留着）；mod 自己造的值是任意 JSON，按插件工具的规矩序列化后当成
 * 一次成功。
 */
function toToolResult(value: unknown): ToolResult {
  if (typeof value === "object" && value !== null) {
    const shape = value as Partial<ToolResult>;
    if (
      typeof shape.success === "boolean" &&
      typeof shape.content === "string"
    ) {
      return value as ToolResult;
    }
  }
  return { success: true, content: renderModToolResult(value) };
}

/**
 * Feed an edit tool's line delta into the `wave.lines.changed` counter.
 *
 * Editing tools report `linesAdded` / `linesRemoved` in `result.data`; every
 * other tool carries neither and contributes nothing. A failed call changed no
 * file, so nothing is recorded.
 */
function recordLinesChangedFromResult(
  result: ToolResult,
  context: { sessionId?: string; workdir?: string },
  container: Container,
): void {
  if (!result.success) return;
  const data = result.data as
    | { linesAdded?: unknown; linesRemoved?: unknown }
    | undefined;
  const added = numberOrUndefined(data?.linesAdded);
  const removed = numberOrUndefined(data?.linesRemoved);
  // Neither counter present == not an editing tool.
  if (added === undefined && removed === undefined) return;
  recordLinesChanged({ added, removed }, recordContextOf(context, container));
}

/** A line count, or `undefined` when the field is absent / not a number. */
function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Count the commit / PR-MR a shell call created (see `detectShellActivity`).
 * Recognition is of the command the tool was asked to run, so a call that exited
 * non-zero created nothing and records nothing. The gate reads `data.exitCode`,
 * not `success`: since a non-zero exit stopped making the call a failure (spec
 * `core/bash-tools.md`「退出码不是工具成败」), `success` no longer tells created
 * from not-created.
 *
 * "A shell call", not "a Bash call": `git commit` typed into a PowerShell
 * session creates the same commit, and the command line reads the same to
 * `detectShellActivity` whichever shell ran it (both invoke git/gh/glab as
 * external binaries). Gating on the name `Bash` is how those commits used to be
 * dropped, so the gate is the shell-tool set, read from `constants/tools.ts`
 * where a future shell tool is added.
 */
function recordShellActivity(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
  context: { sessionId?: string; workdir?: string },
  container: Container,
): void {
  if (!isShellToolName(name)) return;
  // 两道闸门缺一不可：命令没跑起来（找不到 shell、spawn 失败、被权限拒）只有
  // `success: false` 与 `error`、没有 `data`；而命令跑起来了但退出码非零，是
  // `success: true` 加 `data.exitCode`（spec `core/bash-tools.md`「退出码不是工具成
  // 败」）——它同样什么都没创建。没有 `exitCode` 的档（后台化、被停下前就返回）
  // 照旧计入。
  if (!result.success) return;
  const exitCode = (result.data as { exitCode?: unknown } | undefined)
    ?.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0) return;
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) return;
  recordToolActivity(
    detectShellActivity(command),
    recordContextOf(context, container),
  );
}

/**
 * Tool results already filed as a crash.
 *
 * `execute` files every reported failure (`success: false`) as a WARN
 * `tool_error`; without this marker one thrown tool would produce both an
 * `error` and a `tool_error` for the same failure.
 */
const crashReported = new WeakSet<object>();

/**
 * Tool Manager
 *
 * Manages tool registration and execution with optional permission system integration.
 * Supports both built-in tools and MCP (Model Context Protocol) tools.
 */
class ToolManager {
  private toolsRegistry = new Map<string, ToolPlugin>();
  /**
   * The plugin objects wave itself registered, by identity rather than by name:
   * a custom tool that shadows a built-in name must not inherit its validation
   * (`register()` replaces the registry entry, the object stays behind here).
   */
  private builtInTools = new WeakSet<ToolPlugin>();
  private tools?: string[];
  private disallowedTools?: string[];
  private customTools?: ToolPlugin[];
  private container: Container;
  /**
   * `tool.describe` 的快照（spec「给工具、技能、命令写描述」）。
   *
   * 描述与放置（平铺 / 进 REPL 池）都靠这件事问定，而工具 schema 是同步拼的
   * （`getToolsConfig` 被宿主的请求组装同步调用）：组装**之前** `await`
   * `prepareToolDescriptions()` 把答案问回来铺进两套表，本次请求就用新值 ——
   * `staged` 是「问到的答案」，`pinned` 是「这次发出去的那一份」，同轮生效。
   * 问过就锁住（`describeAsked`），插件不能靠每次回答搅动缓存前缀。
   */
  private describeEpoch?: number;
  private describePinned = new Map<string, DescribedTool>();
  private describeStaged = new Map<string, DescribedTool>();
  /** 这场会话已经问过的工具（含还在飞的）—— 每场会话一个工具只问一次。 */
  private describeAsked = new Set<string>();
  /**
   * 上一次看到的「描述缓存被声明过期」次数
   * （`ModManager.toolDescribeInvalidationCount`）。
   *
   * 插件调 `$.ui.invalidate("tool.describe")` 时我们这边不收到回调 —— 缓存挂在
   * 两个 manager 手里，互相持有会成环 —— 所以每次拼表先比对一次这个数：变了就
   * 说明有插件声明它给的描述过期了，重问一遍。
   */
  private describeInvalidations = 0;
  /** 「想藏但没有池」已经告诫过的工具（同一句 warn 不刷屏）。 */
  private deferredWarned = new Set<string>();

  constructor(options: ToolManagerOptions) {
    this.container = options.container;
    this.tools = options.tools;
    this.disallowedTools = options.disallowedTools;
    this.customTools = options.customTools;
  }

  private get mcpManager(): McpManager {
    return this.container.get<McpManager>("McpManager")!;
  }

  /**
   * 会话消费者状态；没有这个 token 的容器（裸 ToolManager 的测试）不打这个闸。
   */
  private sessionConsumers(): SessionConsumers | undefined {
    return this.container.has("SessionConsumers")
      ? this.container.get<SessionConsumers>("SessionConsumers")
      : undefined;
  }

  /**
   * Register a new tool
   *
   * `options.builtIn` marks a tool whose `config.function.parameters` is wave's
   * own contract, and whose calls are therefore checked against it (see
   * `validateToolInput`). Custom tools registered by SDK users are not checked:
   * their schema is theirs to enforce (spec `core/tool-input-validation.md`).
   */
  public register(tool: ToolPlugin, options?: { builtIn?: boolean }): void {
    this.toolsRegistry.set(tool.name, tool);
    if (options?.builtIn === true) {
      this.builtInTools.add(tool);
    }
  }

  /**
   * 这个名字是否已经被占了（内置、自定义、MCP 都算）。
   *
   * `$.tool.register` 查重用：`list()` 会过滤掉被权限规则禁掉的工具，拿它判重
   * 会让一个「禁用了但还在表里」的名字被重复注册出来，模型那边看到两条同名的。
   */
  public hasTool(name: string): boolean {
    if (this.toolsRegistry.has(name)) return true;
    return this.mcpManager
      .getMcpToolPlugins()
      .some((tool) => tool.name === name);
  }

  /**
   * 把一个工具从注册表里摘掉（插件重载 / 会话结束）。
   *
   * 名字不在表里不算错。只动注册表：已经开始的那次调用拿着 plugin 引用照样跑
   * 完，不被打断。
   */
  public unregister(name: string): void {
    const tool = this.toolsRegistry.get(name);
    if (!tool) return;
    this.toolsRegistry.delete(name);
    this.builtInTools.delete(tool);
  }

  /**
   * Initialize built-in tools. Can be called with dependencies for tools that require them.
   *
   * This method can be called multiple times safely. When called without dependencies,
   * it registers basic tools (Bash, Read, Write, Glob, etc.). When called with
   * dependencies, it also registers tools that require managers (Agent, Skill).
   *
   * @param deps Optional dependencies for advanced tools
   * @param deps.subagentManager SubagentManager instance for Agent tool
   * @param deps.skillManager SkillManager instance for Skill tool
   *
   * @example
   * ```typescript
   * // Initialize basic tools only
   * toolManager.initializeBuiltInTools();
   *
   * // Initialize all tools including those requiring dependencies
   * toolManager.initializeBuiltInTools({
   *   subagentManager: mySubagentManager,
   *   skillManager: mySkillManager
   * });
   * ```
   */
  public initializeBuiltInTools(): void {
    // One read of the gate for the whole registry: the Bash tool is listed iff
    // its shell exists, the PowerShell tool iff the gate turns it on. Together
    // these cover the third answer — no Git Bash and PowerShell withheld — where
    // neither shell tool is registered, because a listed tool the model cannot
    // run is worse than a tool it never sees.
    const shellGateInput = collectShellToolGateInput(
      this.container.get<string>("CurrentWorkdir"),
    );
    const hasBash = shellGateInput.hasGitBash;
    const hasPowerShell = isPowerShellToolEnabled(shellGateInput);

    const builtInTools = [
      taskStopTool,
      editTool,
      writeTool,
      exitPlanModeTool,
      enterPlanModeTool,
      askUserQuestionTool,
      readTool,
      lspTool,
      agentTool,
      skillTool,
      cronCreateTool,
      cronDeleteTool,
      cronListTool,
      webFetchTool,
      sendUserFileTool,
      enterWorktreeTool,
      exitWorktreeTool,
      workflowTool,
    ];

    if (hasBash) {
      builtInTools.push(bashTool);
    }

    // Grep / Glob are off by default: search runs through the Bash tool's
    // `grep` / `find` shadows, which are the thing being paid for instead.
    // See `shouldRegisterSearchTools`: naming either one in `--tools` asks for
    // the structured form, and a session with no usable bash gets them
    // regardless — there is no shadow to search with. `--allowedTools` is a
    // permission allow-list and does not affect registration.
    if (shouldRegisterSearchTools(this.tools)) {
      builtInTools.push(globTool, grepTool);
    }

    // PowerShell: present only in a session whose shell it is — no Git Bash on
    // Windows, or `WAVE_USE_POWERSHELL_TOOL` asked for it anyway. The registry
    // and every command router read the same gate (`utils/shell/shellToolGate.ts`),
    // so the tool is never listed without being runnable.
    if (hasPowerShell) {
      builtInTools.push(powershellTool);
    }

    // Artifact is a feature-gated tool: on by default for a logged-in account,
    // opt-in via enableArtifact: true for anyone else, opt-out via false. Its
    // comment half is a second tool (`ArtifactComments`, deferred) that shares
    // every gate with it — two tools, one feature switch.
    if (isArtifactEnabled(this.container.get<string>("CurrentWorkdir"))) {
      builtInTools.push(artifactTool, artifactCommentsTool);
    }

    // The REPL is on by default; `enableRepl: false` turns it off (the retired
    // `enableExec` spelling is accepted too). Registration is decoupled from
    // declaration: getToolsConfig() declares it only while the deferral table
    // yields a non-empty pool, which depends on the runtime tool set.
    //
    // `Poll` is registered with it and gated by the same switch: it exists to read
    // the async lane's queue, so without a REPL there is nothing for it to read.
    if (isReplEnabled(this.container.get<string>("CurrentWorkdir"))) {
      builtInTools.push(replTool, pollTool);
    }

    // Task-list tools: off by default, opted in with WAVE_ENABLE_TASK_TOOLS=1
    // (aligned with Claude Code's per-model default for current models). The
    // system prompt's task line and the task reminder both key off whether
    // these tools are reachable, so they disappear with them.
    if (isTaskToolsEnabled(this.container.get<string>("CurrentWorkdir"))) {
      builtInTools.push(
        taskCreateTool,
        taskGetTool,
        taskUpdateTool,
        taskListTool,
      );
    }

    // Web search has two independent reasons to be absent, and both are read
    // here so a closed one never reaches the model's declaration:
    //
    //  - `enableWebSearch` (configuration — remote managed push → local settings
    //    → default on), read from `SessionWorkdir` like the knowledge-base switch:
    //    which settings file decides must not move because the agent ran a `cd`.
    //  - the server's own 404, remembered for this process
    //    (`services/webSearchAvailability.ts`).
    //
    // They stack: switch on + 404 still hides the tool, and a closed switch costs
    // zero round trips instead of one.
    if (
      isWebSearchEnabledBySettings(
        this.container.get<string>("SessionWorkdir"),
      ) &&
      isWebSearchAvailable()
    ) {
      builtInTools.push(webSearchTool);
    }

    // Enterprise knowledge base: three retrieval function tools, present only
    // when `enableKnowledgeBase` says so (off by default — they pull enterprise
    // documents into every conversation's context). The directory is the
    // container's `SessionWorkdir`, not `CurrentWorkdir`: which settings file
    // decides is a property of the session's opening directory, so a `cd` must
    // not move it.
    if (isKnowledgeBaseEnabled(this.container.get<string>("SessionWorkdir"))) {
      builtInTools.push(...knowledgeBaseTools);
    }

    for (const tool of builtInTools) {
      if (this.shouldEnableTool(tool.name)) {
        this.register(tool, { builtIn: true });
      }
    }

    // Register custom tools
    for (const tool of this.customTools || []) {
      if (this.shouldEnableTool(tool.name)) {
        this.toolsRegistry.set(tool.name, tool);
      }
    }
  }

  /**
   * Re-evaluate feature-gated built-in tools after a live configuration
   * reload. Currently gates the Artifact tools (`Artifact` plus its
   * `ArtifactComments` sibling) on settings.json `enableArtifact`, the REPL tool on `enableRepl` (and, through the deferral
   * judgment, on `enableReplCoreTools`), the three knowledge-base
   * tools on `enableKnowledgeBase`, `WebSearch` on `enableWebSearch` plus the
   * server's own 404 verdict (`services/webSearchAvailability.ts`), the four
   * task-list tools on
   * `env.WAVE_ENABLE_TASK_TOOLS`, and the two shell tools on the shell gate
   * (`env.WAVE_USE_POWERSHELL_TOOL` / whether Git Bash exists). Safe to call
   * multiple times: gated tools are removed from the registry first, then
   * initializeBuiltInTools() re-registers them only if still enabled (so
   * toggling a flag off actually unregisters).
   */
  /**
   * The session's opening directory (`SessionWorkdir`) — the "does not move"
   * one, so a `cd` inside the session never changes which settings file a
   * project-level read is anchored to.
   *
   * Exposed for a gated tool's `execute`: registration already judged this
   * directory, and a call through a stale plugin reference (a REPL script holding
   * it from before the unregister) must make the *same* judgment rather than fall
   * back to `context.workdir`, which is the directory the tools run in.
   */
  public getSessionWorkdir(): string | undefined {
    return this.container.get<string>("SessionWorkdir");
  }

  public reloadFeatureGatedTools(): void {
    this.toolsRegistry.delete(artifactTool.name);
    this.toolsRegistry.delete(replTool.name);
    this.toolsRegistry.delete(artifactCommentsTool.name);
    this.toolsRegistry.delete(pollTool.name);
    this.toolsRegistry.delete(webSearchTool.name);
    // Both shell tools are gate-dependent: enabling PowerShell on a machine
    // without Git Bash, or disabling it on one with Git Bash, changes which of
    // the two is listed — and "neither" is a legal outcome.
    this.toolsRegistry.delete(powershellTool.name);
    this.toolsRegistry.delete(bashTool.name);
    for (const tool of knowledgeBaseTools) {
      this.toolsRegistry.delete(tool.name);
    }
    for (const tool of [
      taskCreateTool,
      taskGetTool,
      taskUpdateTool,
      taskListTool,
    ]) {
      this.toolsRegistry.delete(tool.name);
    }
    this.initializeBuiltInTools();
  }

  /**
   * Check if a tool should be enabled based on tools configuration and permission rules
   */
  private shouldEnableTool(name: string): boolean {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");

    // If tool is explicitly denied by name in permission rules, filter it out
    if (permissionManager?.isToolDenied(name)) {
      return false;
    }

    // Case-insensitive, and only about this one name: the REPL is `REPL` and
    // nothing else, so a `--tools Eval` names no tool at all rather than it.
    const matches = (toolName: string) =>
      toolName.toLowerCase() === name.toLowerCase();

    // A definition-level blacklist wins over the whitelist (both lists naming
    // the same tool means "unavailable").
    if (this.disallowedTools?.some(matches)) {
      return false;
    }

    if (!this.tools) {
      return true;
    }
    return this.tools.some(matches);
  }

  /**
   * The auto-memory directory for this session, or undefined when the feature
   * is off. Consumers (Read) treat "unset" as "not a memory file".
   */
  private resolveAutoMemoryDir(workdir: string): string | undefined {
    if (!this.container.has("MemoryService")) return undefined;
    const configuration = this.container.has("ConfigurationService")
      ? this.container.get<
          import("../services/configurationService.js").ConfigurationService
        >("ConfigurationService")
      : undefined;
    if (!configuration?.resolveAutoMemoryEnabled?.()) return undefined;
    return this.container
      .get<import("../services/memory.js").MemoryService>("MemoryService")
      ?.getAutoMemoryDirectory?.(workdir);
  }

  /**
   * Execute a tool by name with the provided arguments and context
   *
   * Enhances the context with permission-related fields before execution:
   * - permissionMode: The current permission mode (default or bypassPermissions)
   * - canUseToolCallback: Custom permission callback if provided
   * - permissionManager: The PermissionManager instance for permission checks
   *
   * @param name - Name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @param context - Execution context for the tool
   * @returns Promise resolving to the tool execution result
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    // One tool execution is one CLI-active operation for its session. Nested
    // and parallel calls collapse into a single interval — the set the activity
    // tracker keeps is what makes concurrent work count once, not per call.
    // 计时给 `classic.PostToolUse` 的 `duration_ms`：从进工具到它返回。
    const startedAt = Date.now();
    const result = await trackCliOperation(
      "tool",
      recordContextOf(context, this.container),
      () => this.executeTool(name, args, context, startedAt),
    );
    // 影子事件 `classic.PostToolUse` / `classic.PostToolUseFailure`（spec「影子
    // 事件」）：一次调用返回之后。放在这个壳里而不是内置工具那条路上 —— MCP 工
    // 具走的是另一个漏斗，社区插件不该因为工具来源不同而收不到。
    this.notifyModToolOutcome(name, args, result, {
      // `tool_use_id` 就是模型消息里那次调用的 id（工具上下文里现成带着）：
      // 插件拿它去 `$.ui.notice` 能落在对应的那一行。
      toolUseId: context.toolCallId ?? "",
      durationMs: Date.now() - startedAt,
    });
    // A failure the tool *reported* (`success: false`) is ordinary operation:
    // wrong arguments, a rejected permission, a command that never started. It
    // goes out as WARN `tool_error`, never as `error` (spec:
    // `enterprise/opentelemetry.md`「可感知失败的覆盖」). Results already filed
    // as a crash are skipped — same failure, one record. A shell command that
    // exited non-zero is not one of these: since spec `core/bash-tools.md`
    // 「退出码不是工具成败」 it reports `success: true`, so it is not a
    // `tool_error` either — the code is in `data.exitCode`.
    if (!result.success && !crashReported.has(result)) {
      const telemetry = this.failureTelemetry(context);
      if (telemetry) {
        void reportToolFailure({
          sessionId: telemetry.sessionId,
          toolName: name,
          isMcp: this.mcpManager.isMcpTool(name),
          message: result.error || result.content || "Tool reported failure",
          context: telemetry.context,
        });
      }
    }
    return result;
  }

  /**
   * 影子事件 `classic.PostToolUse` / `classic.PostToolUseFailure`（spec「影子
   * 事件」）：一次工具调用**返回之后**报一次，成功算前者、失败或被拒算后者。
   *
   * 只读、不阻塞：返回值忽略，`tool_response` 按 `$.ui.log` 的同一份字符限额
   * 截断（一个 Bash 的完整输出不该整份塞进每个插件的钩子里）。
   */
  private notifyModToolOutcome(
    name: string,
    args: Record<string, unknown>,
    result: ToolResult,
    call: { toolUseId: string; durationMs: number },
  ): void {
    const modManager = this.container.has("ModManager")
      ? this.container.get<ModManager>("ModManager")
      : undefined;
    if (!modManager) return;
    // `permission_mode` 不在这里给：公共字段由 `ModManager.notifyMods` 统一补。
    const base = {
      tool_name: name,
      tool_input: args,
      tool_use_id: call.toolUseId,
      duration_ms: call.durationMs,
    };
    if (result.success) {
      modManager.notifyMods("classic.PostToolUse", {
        ...base,
        tool_response: truncateForModEvent(result.content ?? ""),
      });
      return;
    }
    modManager.notifyMods("classic.PostToolUseFailure", {
      ...base,
      error: result.error ?? result.content ?? "",
    });
  }

  /**
   * Telemetry attribution for a failure in this tool call.
   * The session id comes from the call context, not the container: a nested
   * agent or the REPL sandbox runs a tool under its own session, and the event
   * has to point at whichever session actually made the call.
   */
  private failureTelemetry(
    context: ToolContext,
  ): { sessionId: string; context: StandardAttributeContext } | undefined {
    const sessionId =
      context.sessionId ??
      this.container
        .get<{ getSessionId(): string }>("MessageManager")
        ?.getSessionId();
    if (!sessionId) return undefined;
    const workdir =
      context.originalWorkdir ??
      this.container.get<string>("SessionWorkdir") ??
      context.workdir;
    return {
      sessionId,
      context: { sessionId, workdir, entrypoint: entrypointOf(this.container) },
    };
  }

  /**
   * File a tool that could not run at all. The result is marked so `execute`
   * does not also file it as a reported failure.
   */
  private reportCrash(
    name: string,
    error: unknown,
    result: ToolResult,
    context: ToolContext,
  ): void {
    crashReported.add(result);
    const telemetry = this.failureTelemetry(context);
    if (!telemetry) return;
    void reportToolCrash({
      error,
      sessionId: telemetry.sessionId,
      toolName: name,
      isMcp: this.mcpManager.isMcpTool(name),
      context: telemetry.context,
    });
  }

  /**
   * The result a call gets when it names a tool this request never declared, or
   * `undefined` when the call is fine (including "not a model call at all").
   *
   * Why this exists: `tools[]` is not the registry. A pooled tool leaves the flat
   * declaration and stays callable from the sandbox, and a model that calls it flat
   * would otherwise really run it — the announcement says "inside the REPL" and the
   * call quietly succeeds, which is the difference between a suggestion and a rule
   * (spec `core/repl-tool.md`「开关把核心文件与 shell 工具也收进 REPL」场景 5).
   *
   * The registry is consulted for the wording only. A name that is not declared
   * cannot run whether or not it is registered, so "is this a real tool" decides
   * between "it is in the pool, call it from a script" and "there is no such tool
   * here" — and nowhere between "reject" and "allow".
   *
   * `context.declaredToolNames === undefined` means the call did not come from a
   * model's `tool_use` (see `ToolContext`): no set, no check. That is what keeps a
   * REPL script's `tools.Bash(...)` working — `replRuntime` drops the set when it
   * builds a script's context, since a script reaches the pool rather than
   * `tools[]`.
   */
  private undeclaredToolResult(
    name: string,
    context: ToolContext,
  ): ToolResult | undefined {
    const declared = context.declaredToolNames;
    if (!declared || declared.has(name)) return undefined;

    const pooled =
      this.isReplDeclared() &&
      this.getReplPool().some((entry) => entry.name === name);
    // Both sentences are the model's next move rather than a diagnosis of ours:
    // the pooled one is a call it can copy verbatim (`toolExpression` is the same
    // renderer the announcement uses), the other is Claude Code's own
    // "continue with the tools you have".
    const message = pooled
      ? `No such tool available: ${name}. It is not declared as a flat tool — it lives in the ` +
        `${REPL_TOOL_NAME} pool, so call it from a script instead: await ${toolExpression(name)}({...}) ` +
        `(describeTool("${name}") returns its input schema).`
      : `No such tool available: ${name}. It is not among the tools available in this request — ` +
        `continue with the tools you have.`;
    logger?.debug("Tool call rejected: name not declared in this request", {
      toolName: name,
      pooled,
    });
    return { success: false, content: message, error: message };
  }

  /**
   * The body of {@link execute}: resolve the effective permission mode and the
   * per-session wiring, then run the tool.
   */
  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
    startedAt: number,
  ): Promise<ToolResult> {
    // First gate, ahead of permission and of the hooks: the name has to be one
    // this request declared. Claude Code makes the same judgment on every
    // `tool_use` (spec `core/repl-tool.md`「开关把核心文件与 shell 工具也收进 REPL」
    // 场景 5).
    const undeclared = this.undeclaredToolResult(name, context);
    if (undeclared) return undeclared;

    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    // Resolve effective permission mode (CLI override > configuration > default)
    const effectivePermissionMode = permissionManager
      ? permissionManager.getCurrentEffectiveMode(permissionMode)
      : permissionMode || "default";

    // Enhance context with permission-related fields
    const canUseToolCallback = this.container.has("CanUseToolCallback")
      ? this.container.get<PermissionCallback>("CanUseToolCallback")
      : undefined;

    const enhancedContext: ToolContext = {
      ...context,
      permissionMode: effectivePermissionMode,
      canUseToolCallback,
      permissionManager,
      toolManager: this,
      taskManager:
        this.container.get<import("../services/taskManager.js").TaskManager>(
          "TaskManager",
        )!,
      reversionManager:
        this.container.get<ReversionManager>("ReversionManager")!,
      backgroundTaskManager: this.container.get<
        import("./backgroundTaskManager.js").BackgroundTaskManager
      >("BackgroundTaskManager")!,
      foregroundTaskManager: this.container.get<
        import("../types/processes.js").IForegroundTaskManager
      >("ForegroundTaskManager")!,
      shellProcessReaper: this.container.has("ShellProcessReaper")
        ? this.container.get<
            import("./shellProcessReaper.js").ShellProcessReaper
          >("ShellProcessReaper")
        : undefined,
      mcpManager: this.mcpManager,
      lspManager: this.container.get<ILspManager>("LspManager")!,
      subagentManager: this.container.has("SubagentManager")
        ? this.container.get<SubagentManager>("SubagentManager")
        : undefined,
      skillManager: this.container.has("SkillManager")
        ? this.container.get<SkillManager>("SkillManager")
        : undefined,
      cronManager: this.container.has("CronManager")
        ? this.container.get<import("./cronManager.js").CronManager>(
            "CronManager",
          )
        : undefined,
      aiManager: this.container.has("AIManager")
        ? this.container.get<import("./aiManager.js").AIManager>("AIManager")
        : undefined,
      aiService: aiService,
      messageManager:
        this.container.get<import("./messageManager.js").MessageManager>(
          "MessageManager",
        )!,
      hookManager: this.container.has("HookManager")
        ? this.container.get<import("./hookManager.js").HookManager>(
            "HookManager",
          )
        : undefined,
      workflowManager: this.container.has("WorkflowManager")
        ? this.container.get<import("./workflowManager.js").WorkflowManager>(
            "WorkflowManager",
          )
        : undefined,
      modManager: this.container.has("ModManager")
        ? this.container.get<ModManager>("ModManager")
        : undefined,
      modAgentDepth: this.container.get<number>("ModAgentDepth") ?? 0,
      sandboxManager: this.container.has("SandboxManager")
        ? this.container.get<
            import("../sandbox/SandboxManager.js").SandboxManager
          >("SandboxManager")
        : undefined,
      sessionEnv: this.container.has("ConfigurationService")
        ? this.container
            .get<
              import("../services/configurationService.js").ConfigurationService
            >("ConfigurationService")
            ?.getMergedEnv?.()
        : undefined,
      autoMemoryDir: this.resolveAutoMemoryDir(context.workdir),
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
    };

    logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!permissionManager,
    });

    // 插件 MODS 的形状照 Claude Code 的 `ToolCallEnvelope`：工具名、调用 id、
    // 参数对象，外加把参数在顶层铺一份（社区插件读 `e.command`，不读
    // `e.input.command`）。两个事件共用同一份（spec「拦下一次工具调用」
    // 「在工具真正跑之前插一脚」）。
    const modManager = this.container.has("ModManager")
      ? this.container.get<ModManager>("ModManager")
      : undefined;
    const modToolEvent = {
      ...args,
      tool: name,
      tool_use_id: context.toolCallId ?? "",
      input: args,
    };

    // Check if it's an MCP tool first. Tool-event hooks for MCP live in
    // `McpManager.executeMcpTool` — the one funnel every MCP call goes through,
    // flat or nested — so they are not run a second time here.
    if (this.mcpManager.isMcpTool(name)) {
      // `tool.call` 对真 MCP 工具同样要过一遍：mod 工具（名字也带 `mcp__`）
      // 能被拦、真 MCP 不能，是同名工具两套语义（spec「拦下一次工具调用」说的
      // 是「一次工具调用执行之前」，没有挑工具从哪来）。
      //
      // `next(e)` 走到链尾就是**真的执行**这次 MCP 调用（CC 的形状）：
      // `executeMcpToolByRegistry` 只跑 MCP 自己的 `execute`，不会把这条链再
      // 跑一遍，所以这里传执行体是安全的。
      const runMcpTool = async (): Promise<ToolResult> => {
        try {
          return await this.mcpManager.executeMcpToolByRegistry(
            name,
            args,
            enhancedContext,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          // A hook block is a refusal, not a tool failure: keep its wording in
          // the result so a flat call shows the model what a nested one sees.
          if (error instanceof HookBlockedToolError) {
            return { success: false, content: message, error: message };
          }
          const failure: ToolResult = {
            success: false,
            content: "",
            error: message,
          };
          this.reportCrash(name, error, failure, context);
          return failure;
        }
      };
      let mcpResult: ToolResult | undefined;
      const mcpDecision = await modManager?.dispatchToolCall(modToolEvent, {
        run: async () => {
          mcpResult ??= await runMcpTool();
          return mcpResult;
        },
      });
      if (mcpDecision?.deny !== undefined) {
        logger?.debug("Tool call denied by plugin mod", { toolName: name });
        return {
          success: false,
          content: mcpDecision.deny,
          error: mcpDecision.deny,
        };
      }
      if (mcpDecision && "result" in mcpDecision) {
        return toToolResult(mcpDecision.result);
      }
      return mcpResult ?? (await runMcpTool());
    }

    // Check built-in tools. PreToolUse / PostToolUse belong here rather than in
    // the tool-call loop: this is the one funnel built-ins are reached through,
    // so a call made from inside the REPL sandbox runs the same hooks a flat
    // call does.
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      // Arguments are checked against the schema the tool declares *before* the
      // hooks and before the tool runs: a call whose parameters are wrong is
      // neither a permission question nor something a hook should see. The
      // failure is returned as an ordinary error result, so the model can read
      // the reason and retry (spec `core/tool-input-validation.md`).
      if (this.builtInTools.has(plugin)) {
        const invalid = validateToolInput(
          name,
          plugin.config?.function?.parameters,
          args,
        );
        if (invalid !== null) {
          logger?.debug(
            "Tool call rejected: arguments do not match the schema",
            {
              toolName: name,
            },
          );
          return { success: false, content: invalid, error: invalid };
        }
      }

      const hookManager = enhancedContext.hookManager;
      /**
       * `settings.json` 的 PreToolUse 只跑一次。
       *
       * 它在 `tool.call` 的 `next(e)` 里面也要过：mod 的执行请求不算「已经
       * 批准过」，否则 `next()` 就成了绕过用户拒绝的后门。两条路（mod 调了
       * `next`、没人调）共用同一份结果，不会问两次。
       */
      let preToolUseGate: Promise<string | null> | undefined;
      const checkPreToolUse = (): Promise<string | null> => {
        // `null` 是 `executePreToolUseHooks` 的「放行」，没有 hookManager 时
        // 同样放行。
        preToolUseGate ??= hookManager
          ? hookManager.executePreToolUseHooks(name, args, enhancedContext)
          : Promise.resolve(null);
        return preToolUseGate;
      };

      let result: ToolResult | undefined;
      /** 真正跑一次工具（`tool.call` 的 `next(e)` 与「没人注册」两条路共用）。 */
      const runTool = async (): Promise<ToolResult> => {
        if (result) return result;
        try {
          result = await plugin.execute(args, enhancedContext);
          recordLinesChangedFromResult(result, context, this.container);
          recordShellActivity(name, args, result, context, this.container);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          logger?.error("Tool execution failed", {
            toolName: name,
            error: message,
          });
          result = { success: false, content: "", error: message };
          this.reportCrash(name, error, result, context);
        }
        return result;
      };
      /** `tool.call` 的 `next(e)` 走到链尾时的那一步：先过审批闸，再执行。 */
      let blockedByPreToolUse = false;
      const runThroughPreToolUse = async (): Promise<ToolResult> => {
        const blocked = await checkPreToolUse();
        if (blocked) {
          blockedByPreToolUse = true;
          return {
            success: false,
            content: blocked,
            error: blocked,
          };
        }
        return runTool();
      };

      // `tool.call`：执行**之前**问一遍插件，被拦下就不跑（spec「拦下一次工具
      // 调用」）。拦下不是审批失败，模型收到这段文本作为工具错误结果。
      //
      // `next(e)` 走到链尾 = 真的执行（CC 的形状），所以执行体传下去；插件自己
      // 注册的工具没有宿主侧执行体，那条路上不传。
      const modOwnsTool = modManager?.ownsTool(name) ?? false;
      const modDecision = await modManager?.dispatchToolCall(modToolEvent, {
        run: modOwnsTool ? undefined : runThroughPreToolUse,
      });
      if (modDecision?.deny !== undefined) {
        logger?.debug("Tool call denied by plugin mod", { toolName: name });
        return {
          success: false,
          content: modDecision.deny,
          error: modDecision.deny,
        };
      }
      // `{ result }`：可能是 `next()` 真跑出来的，也可能是 mod 自己造的那份
      // （CC 同口径）。有了结果就不再执行第二遍。
      if (modDecision && "result" in modDecision) {
        result = toToolResult(modDecision.result);
      }
      if (modManager && modOwnsTool) {
        // 插件带来的工具与 MCP 工具走同一条审批路（spec「把我们自己的工具交给
        // 模型」）：名字带 `mcp__` 前缀，`isRestrictedTool()` 认它，所以这里要
        // 真的问一次 —— 否则「用户看得见、能拒」只是句空话。内置工具各自在自己
        // 的 `execute` 里问，这条路没有 `execute`，只能在这里问。
        if (permissionManager) {
          const permissionContext = permissionManager.createContext(
            name,
            effectivePermissionMode,
            canUseToolCallback,
            args,
            context.toolCallId,
          );
          const permission =
            await permissionManager.checkPermission(permissionContext);
          if (permission.behavior === "deny") {
            const message = `${name} 的调用被拒绝：${
              permission.message ?? "没有给出原因"
            }`;
            return { success: false, content: message, error: message };
          }
        }
        // 插件自己注册的工具没有宿主侧执行体，结果只能由它给 —— 但 `settings.json`
        // 的 PreToolUse / PostToolUse 照样要跑：用户按 `mcp__.*` 写的拒绝与审计
        // 对 mod 工具与真 MCP 工具是同一份承诺（spec「把我们自己的工具交给模型」
        // 的「与 MCP 工具同一条审批路」）。
        const modHookManager = enhancedContext.hookManager;
        const blockedByHook = await modHookManager?.executePreToolUseHooks(
          name,
          args,
          enhancedContext,
        );
        if (blockedByHook) {
          return {
            success: false,
            content: blockedByHook,
            error: blockedByHook,
          };
        }
        // 拿到 `{ result }` 就直接交回模型：这条路上没有宿主侧执行体，结果只能
        // 由插件给。
        const modOutcome: ToolResult =
          modDecision && "result" in modDecision
            ? {
                success: true,
                content: renderModToolResult(modDecision.result),
              }
            : // 没人接：`tool.register` 交上去的工具，调用时却没有一条
              // `tool.call` 认领。按 `{ result: null }` 答，并在插件日志里说明
              // —— 静默给一个空成功会让作者以为自己的钩子跑过了。
              { success: true, content: "null" };
        if (!modDecision || !("result" in modDecision)) {
          logger?.warn("No mod answered a registered tool call", {
            toolName: name,
          });
        }
        await modHookManager?.executePostToolUseHooks(
          name,
          args,
          modOutcome,
          enhancedContext,
          {
            // PostToolUse 的 `tool_use_id` / `duration_ms`（CC 的
            // `0172:9983-9984`）：id 是模型消息里那次调用的 id，耗时从进工具
            // 算到此刻 —— 与 `classic.PostToolUse` 的 `duration_ms` 同一条口径
            // （含内部的权限判定；CC 那个数不含权限提示时长，我们没有分开的钟）。
            toolUseId: enhancedContext.toolCallId,
            durationMs: Date.now() - startedAt,
          },
        );
        return modOutcome;
      }

      // 没人调过 `next()` 的那条路：闸门在这里过（mod 调过的话 `result` 已经
      // 有了，闸门也已经问过一次）。
      if (result === undefined) {
        const blocked = await checkPreToolUse();
        if (blocked) {
          return { success: false, content: blocked, error: blocked };
        }
      }
      const outcome = result ?? (await runTool());

      // PostToolUse hooks run for a failed call too — the tool was attempted,
      // and PostToolUse cannot block anything at this point. A call stopped by
      // PreToolUse was never attempted, so it stays out of PostToolUse (the
      // same rule as the path that never went through `tool.call`'s `next`).
      if (!blockedByPreToolUse) {
        await hookManager?.executePostToolUseHooks(
          name,
          args,
          outcome,
          enhancedContext,
          {
            toolUseId: enhancedContext.toolCallId,
            durationMs: Date.now() - startedAt,
          },
        );
      }

      // A memory write that left the file over its cap is worth saying out loud
      // in the result: unlike the load-time warning, this reaches the model
      // while it still has the file in hand.
      await appendMemoryCapNotice(
        name,
        args,
        outcome,
        enhancedContext.workdir,
        enhancedContext.autoMemoryDir,
      );

      return outcome;
    }

    logger?.warn("Tool not found", { toolName: name });
    // A tool that does not exist is a registration/config fault, not the model
    // getting something wrong — it belongs in the ERROR series.
    const missing: ToolResult = {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
    this.reportCrash(name, new Error(missing.error), missing, context);
    return missing;
  }

  list(): ToolPlugin[] {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const builtInTools = Array.from(this.toolsRegistry.values()).filter(
      (tool) => !permissionManager?.isToolDenied(tool.name),
    );
    const mcpTools = this.mcpManager
      .getMcpToolPlugins()
      .filter((tool) => !permissionManager?.isToolDenied(tool.name));
    return [...builtInTools, ...mcpTools];
  }

  /**
   * Whether the REPL exists for this session: registered and not denied by a
   * permission rule. Exactly when the sandbox channel does — an undeclared REPL
   * cannot be called, so declaring the deferred tools only inside it would hide
   * them for good.
   *
   * Denial is asked by the one name the tool has (`REPL`): it has no alias, so
   * there is no second spelling a rule could use to deny the sandbox carrier.
   */
  private isReplDeclared(): boolean {
    if (!this.toolsRegistry.has(REPL_TOOL_NAME)) return false;
    const permissionManager = this.getPermissionManager();
    return !permissionManager?.isToolDenied(REPL_TOOL_NAME);
  }

  /**
   * Every tool a deferral decision has to be made about — built-ins and MCP alike,
   * in declaration order.
   *
   * Permission filtering happens here rather than inside `buildReplPool`, because
   * "which tools may this session call" is a manager question, and the pool's hard
   * constraint is that it never exceeds that set: a tool reachable from the sandbox
   * but hidden from the agent would make `REPL` a permission-escalation channel.
   *
   * `REPL` is a candidate like any other. The structural non-deferrable list keeps
   * it out of the pool by name, so there is no special case here — and a tool that
   * is in the pool is never declared flat (see `getToolsConfig`), so the two places
   * agree by construction rather than by parallel bookkeeping.
   */
  private deferralCandidates(): ReplPoolCandidate[] {
    const permissionManager = this.getPermissionManager();
    const candidates: ReplPoolCandidate[] = [];

    for (const tool of this.toolsRegistry.values()) {
      if (permissionManager?.isToolDenied(tool.name)) continue;
      candidates.push({
        name: tool.name,
        description: tool.config.function.description,
        searchHint: tool.searchHint,
        // A built-in declares the shape of its own `data`; the sandbox renders it
        // as the pooled signature's return type. Absent means `unknown`.
        outputSchema: tool.outputSchema,
        defer: tool.defer,
        alwaysLoad: tool.alwaysLoad,
        inputSchema: tool.config.function.parameters as
          | Record<string, unknown>
          | undefined,
      });
    }

    const outputSchemas = this.mcpManager.getMcpToolOutputSchemas();
    for (const tool of this.mcpManager.getMcpToolPlugins()) {
      if (permissionManager?.isToolDenied(tool.name)) continue;
      candidates.push({
        name: tool.name,
        description: tool.config.function.description,
        // MCP tools need not set `defer`: the judgment table defers them
        // unconditionally. `alwaysLoad` is the server's own opt-out from that.
        alwaysLoad: tool.alwaysLoad,
        isMcp: true,
        inputSchema: tool.config.function.parameters as
          | Record<string, unknown>
          | undefined,
        outputSchema: outputSchemas.get(tool.name),
      });
    }

    return candidates;
  }

  /**
   * The tools the sandbox may reach: the deferred subset of `deferralCandidates`,
   * minus the names the non-deferrable list exempts.
   *
   * Computed per call, never cached. The pool is a function of the registry, the MCP
   * connections and the settings, all of which move at runtime, and a cached copy
   * would be a second source of truth for what the sandbox can reach.
   *
   * `enableReplCoreTools` is read here, at the one call that builds the pool, so
   * the flat declarations, the announcement and the sandbox all get the same
   * answer for "is `Read` pooled" (spec core/repl-tool.md「开关把核心文件与 shell
   * 工具也收进 REPL」).
   */
  public getReplPool(): ReplPoolEntry[] {
    const workdir = this.container.get<string>("CurrentWorkdir");
    return buildReplPool(
      this.deferralCandidates(),
      getNonDeferrableBuiltins(workdir),
      isReplCoreToolsEnabled(workdir),
      // 插件在 `tool.describe` 里给过裁决就用它（spec「给工具、技能、命令写描述」）。
      (name) => this.placementOverride(name),
    );
  }

  /**
   * The pool the announcement renders, or `undefined` when the channel is closed.
   *
   * Entries rather than names: the announcement's first tier is a signature block,
   * and a tier is only reachable through the entry (`tier === "core"`, copied from
   * the deferral judgment by `buildReplPool`). Handing it names would silently
   * demote every core tool to the name-only tier.
   */
  public getOnDemandPool(): ReplPoolEntry[] | undefined {
    if (!this.isReplDeclared()) return undefined;
    return this.getReplPool();
  }

  /**
   * The deferred tool names, or `undefined` when the channel is closed — the input
   * callers that only need reachability read (`aiManager`'s task reminder and the
   * system prompt's tool gating). The announcement uses `getOnDemandPool` instead,
   * because a name cannot carry a signature.
   */
  public getOnDemandToolNames(): string[] | undefined {
    return this.getOnDemandPool()?.map((entry) => entry.name);
  }

  getToolsConfig(options?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }): ChatCompletionFunctionTool[] {
    const permissionManager = this.getPermissionManager();
    const leanPromptEnabled = isLeanPromptEnabled(options?.workdir);
    // 描述的快照在这一句里翻页：新一轮 → 上一轮问到的答案成为本轮发出的那份。
    this.rollDescribeEpoch();

    // A tool in the pool is declared only inside the sandbox, never flat as well:
    // the two must not coexist, or the model would see the same tool twice while
    // the announcement claimed to be the only way in. Both halves are derived from
    // this one pool, and the pool is exactly what the agent could already call
    // directly, so deferring it cannot widen access. That includes the seven core
    // tools while `enableReplCoreTools` is on: they are in the pool, so they leave
    // `tools[]` by this same rule rather than by a second list.
    //
    // The pool is non-empty whenever the REPL exists (the deferred built-ins are
    // always there), so the REPL is declared for as long as the feature is on. That
    // is the point: `tools[]` no longer moves when an MCP server comes or goes,
    // which is what keeps the cached prefix stable.
    const pool = this.isReplDeclared() ? this.getReplPool() : [];
    const pooled = new Set(pool.map((entry) => entry.name));
    const execDeclared = pool.length > 0;

    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
      .filter((tool) => {
        if (tool.name === REPL_TOOL_NAME) return execDeclared;
        if (pooled.has(tool.name)) return false;
        // If tool is explicitly denied by name in permission rules, filter it out
        if (permissionManager?.isToolDenied(tool.name)) {
          return false;
        }
        // 交付文件只在"有人能把卡片渲染出来"时声明（spec
        // `core/session-consumers.md`）：终端只能打字，`wave -p` 连界面都没有。
        // 注册表里始终留着它——历史转录里的调用还要能重放，撤注册会让那些调用
        // 变成 `Tool not found`。
        if (
          tool.name === SEND_USER_FILE_TOOL_NAME &&
          !this.sessionConsumers()?.hasRenderable()
        ) {
          return false;
        }
        return true;
      })
      .map((tool) => {
        // Create a copy of the tool config to avoid modifying the original
        const config = {
          ...tool.config,
          function: {
            ...tool.config.function,
          },
        };
        // What the session can actually reach, so a description never points at
        // a tool this registry does not hold (`Grep` / `Glob` are opt-in).
        const promptArgs = {
          ...options,
          availableTools: Array.from(this.toolsRegistry.keys()),
        };
        // Lean mode sends the tool's condensed variant when it declares one; a
        // tool without one keeps its full description, so lean never yields an
        // empty description. Only text changes — schemas, the tool set and
        // permission decisions are untouched.
        const lean = leanPromptEnabled ? tool.leanPrompt : undefined;
        if (lean !== undefined) {
          config.function.description =
            typeof lean === "function" ? lean(promptArgs) : lean;
        } else if (tool.prompt) {
          config.function.description = tool.prompt(promptArgs);
        }
        // 第二判定源没有份的那半：插件可以换掉模型读到的这段说明文字（spec
        // 「给工具、技能、命令写描述」）。换的只是文本，schema 与工具集不动。
        config.function.description = this.describeTool(
          tool.name,
          config.function.description,
        );
        return config;
      });
    // Every MCP tool is deferred, so this is empty while `REPL` exists; it is the
    // only path that declares an MCP tool at all when `REPL` is off or denied.
    const mcpToolsConfig = this.mcpManager
      .getMcpToolsConfig()
      .filter((tool) => {
        if (pooled.has(tool.function.name)) return false;
        if (permissionManager?.isToolDenied(tool.function.name)) {
          return false;
        }
        return true;
      });
    return [...builtInToolsConfig, ...mcpToolsConfig];
  }

  /**
   * 进入新一轮时把 `staged` 铺成 `pinned`（兜底）。
   *
   * 正常路径是请求组装前 `prepareToolDescriptions()` 自己铺一次，同轮生效；这里
   * 只为那些绕过预热的同步调用方（例如 `/context` 的估算、直接 `getToolsConfig`
   * 的测试）保持同一份口径。没有 MessageManager 的容器恒为 0，也就是「整场一轮」。
   *
   * `describeAsked` **不清** —— 描述是会话级缓存（每个工具每场会话问一次），清了
   * 就等于每轮重问，插件的时间戳/计数器会把提示词缓存一直打断。要重问只有两条
   * 路：换一场会话，或者插件在答案里说 `breakPromptCache: true`。
   */
  private rollDescribeEpoch(): void {
    const epoch = this.container.has("MessageManager")
      ? (this.container
          .get<MessageManager>("MessageManager")
          ?.countUserTurns() ?? 0)
      : 0;
    if (epoch === this.describeEpoch) return;
    this.describeEpoch = epoch;
    this.describePinned = new Map(this.describeStaged);
  }

  /**
   * 让会话级的描述缓存过期：下一次拼工具表时每个工具都重问一遍
   * （`$.ui.invalidate("tool.describe")`，spec「给工具、技能、命令写描述」）。
   *
   * 只清 `describeAsked`，**不**清 `describeStaged` / `describePinned`：后两者的
   * 区别是「手上最新的答案」与「本轮已经发出去的那一份」，而
   * `rollDescribeEpoch` 是整份**替换**（`pinned = new Map(staged)`）—— 清空
   * staged 会让下一轮**所有**工具的描述一起退回宿主给的原文，而不只是声明过期
   * 的那几个。旧答案留着由重问来的新值覆盖，与 `breakPromptCache: true` 的处理
   * 完全一致（那一条同样只 delete `describeAsked`）。
   */
  clearDescribeCache(): void {
    this.describeAsked.clear();
  }

  /**
   * 一个工具要发给模型的描述：这一轮 pin 的快照里有就用它，没有的用宿主自己的。
   *
   * 问答案不在这里：`prepareToolDescriptions` 在组装请求之前 `await` 一遍（同轮
   * 生效，见 spec「给工具、技能、命令写描述」），这里只读结果，保持同步 ——
   * `getToolsConfig` 是同步 API，工具名列表还有别的调用方。
   */
  private describeTool(
    name: string,
    base: string | undefined,
  ): string | undefined {
    return this.describePinned.get(name)?.description ?? base;
  }

  /**
   * 把这场会话每一个候选（平铺的、池里的、MCP 的、mod 自己注册的）的描述与
   * 放置问定，然后立刻铺进 `describePinned` —— 与 CC 的 `resolveToolDescription`
   * 同一条时机：`await` 完再组装，这次请求就用新值，不是下一次。
   *
   * 问过就锁住（`describeAsked`）：每轮重问会让插件的时间戳/计数器不断改写缓存
   * 前缀。要重问只有 `breakPromptCache: true` 与
   * `$.ui.invalidate("tool.describe")` 两条路。
   */
  async prepareToolDescriptions(): Promise<void> {
    const modManager = this.container.has("ModManager")
      ? this.container.get<ModManager>("ModManager")
      : undefined;
    if (
      !modManager ||
      typeof modManager.collectToolDescription !== "function"
    ) {
      return;
    }
    // 插件声明过描述过期（`$.ui.invalidate("tool.describe")`）：把「问过没」清
    // 掉，下面就会把每个工具重问一遍。比的是计数而不是「装没装过回调」，因为
    // 声明可能发生在第一次拼工具表之前（mod 在 `session.start` 里就会这么干）。
    if (typeof modManager.toolDescribeInvalidationCount === "function") {
      const invalidations = modManager.toolDescribeInvalidationCount();
      if (invalidations !== this.describeInvalidations) {
        this.describeInvalidations = invalidations;
        this.clearDescribeCache();
      }
    }
    await Promise.all(
      this.deferralCandidates().map((candidate) =>
        this.askToolDescription(
          modManager,
          candidate.name,
          candidate.description,
        ),
      ),
    );
    // 同轮生效：这一份就是本轮所有请求要用的。
    this.describePinned = new Map(this.describeStaged);
    this.warnPlacementWithoutPool();
  }

  private async askToolDescription(
    modManager: ModManager,
    name: string,
    base: string | undefined,
  ): Promise<void> {
    if (this.describeAsked.has(name)) return;
    this.describeAsked.add(name);
    try {
      const described = await modManager.collectToolDescription({
        name,
        description: base ?? "",
      });
      // `breakPromptCache: true` 是插件说「这份答案别存」：把「问过了」撤掉，
      // 下一次请求再问一遍；答案本身也不进本轮的快照。
      if (described.breakPromptCache === true) {
        this.describeAsked.delete(name);
        return;
      }
      const isDeferred =
        typeof described.isDeferred === "boolean"
          ? described.isDeferred
          : undefined;
      this.describeStaged.set(name, {
        description: described.description,
        ...(isDeferred === undefined ? {} : { isDeferred }),
      });
    } catch (error) {
      // `tool.describe` 自己 fail-open，这里只是兜住一个不该发生的拒绝：描述
      // 写不进去就继续用宿主那一份，不能把请求拖垮。
      logger?.warn("tool.describe failed", { toolName: name, error });
    }
  }

  /**
   * 插件对放置的裁决；没意见就给 `undefined`（判定表说了算）。
   *
   * 两条护栏：结构豁免（`REPL` 是池的载体，进池等于脚本调脚本）翻不动；没有
   * 池（`enableRepl: false`、或 REPL 被权限禁掉）时 `true` 无处可去，只能保持
   * 平铺 —— 不能因为一句「藏起来」就把工具下架。
   */
  private placementOverride(name: string): boolean | undefined {
    if (STRUCTURAL_NON_DEFERRABLE.includes(name)) return undefined;
    const isDeferred = this.describePinned.get(name)?.isDeferred;
    if (isDeferred === undefined) return undefined;
    if (isDeferred && !this.isReplDeclared()) return undefined;
    return isDeferred;
  }

  /** 插件想把工具藏起来、但这场会话没有池：保持平铺，每个工具只说一次。 */
  private warnPlacementWithoutPool(): void {
    if (this.isReplDeclared()) return;
    for (const [name, described] of this.describePinned) {
      if (described.isDeferred !== true || this.deferredWarned.has(name)) {
        continue;
      }
      if (STRUCTURAL_NON_DEFERRABLE.includes(name)) continue;
      this.deferredWarned.add(name);
      logger?.warn(
        `[Wave] tool.describe 要求把 ${name} 设为延迟，但这个会话没有 REPL 池，保持平铺`,
      );
    }
  }

  /**
   * Get the list of registered tool plugins
   */
  public getTools(): ToolPlugin[] {
    return Array.from(this.toolsRegistry.values());
  }

  /**
   * Check whether a tool is safe to execute in parallel with other tools.
   * Built-in tools default to safe (parallel); Edit and Write opt out.
   * MCP tools are conservatively non-safe (can't inspect side effects).
   */
  public isConcurrencySafe(name: string): boolean {
    // MCP tools are conservatively non-safe
    if (this.mcpManager.isMcpTool(name)) {
      return false;
    }
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      return plugin.isConcurrencySafe ?? true;
    }
    // Unknown tools are conservatively non-safe
    return false;
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    if (permissionManager) {
      return permissionManager.getCurrentEffectiveMode(permissionMode);
    }
    return permissionMode || "default";
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.container.register("PermissionMode", mode);
  }

  /**
   * Request a full permission mode transition (planManager + UI callback).
   * Used by tools like EnterPlanMode in bypass mode where the canUseTool
   * callback (which normally handles the transition) is not invoked.
   * In normal mode, the callback already handles the transition.
   */
  public requestPermissionModeChange(mode: PermissionMode): void {
    if (this.container.has("PermissionModeTransition")) {
      const transition = this.container.get<(mode: PermissionMode) => void>(
        "PermissionModeTransition",
      );
      if (transition) {
        transition(mode);
        return;
      }
    }
    this.setPermissionMode(mode);
  }

  /**
   * Get the permission manager
   */
  public getPermissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  /**
   * Get the task manager
   */
  public getTaskManager():
    | import("../services/taskManager.js").TaskManager
    | undefined {
    return this.container.get<import("../services/taskManager.js").TaskManager>(
      "TaskManager",
    );
  }
}

// Export tool registry class and types
export { ToolManager };
