import { type CallAgentOptions } from "../services/aiService.js";
import * as aiService from "../services/aiService.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { microcompactMessages } from "../utils/microcompact.js";
import { parseTaskNotificationXml } from "../utils/notificationXml.js";
import { calculateComprehensiveTotalTokens } from "../utils/tokenCalculation.js";
import * as fs from "node:fs/promises";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  Message,
} from "../types/index.js";
import type { ToolManager } from "./toolManager.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import type { MessageManager } from "./messageManager.js";
import type { BackgroundTaskManager } from "./backgroundTaskManager.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import type { HookManager } from "./hookManager.js";
import type { ExtendedHookExecutionContext } from "../types/hooks.js";
import type { PermissionManager } from "./permissionManager.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";
import { buildSystemPrompt } from "../prompts/index.js";
import { Container } from "../utils/container.js";
import { recoverTruncatedJson } from "../utils/stringUtils.js";
import { ConfigurationService } from "../services/configurationService.js";
import type { NotificationQueue } from "./notificationQueue.js";

import { logger } from "../utils/globalLogger.js";

export interface AIManagerCallbacks {
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onUsageAdded?: (usage: Usage) => void;
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
}

export class AIManager {
  public isLoading: boolean = false;
  private abortController: AbortController | null = null;
  onLoadingChange?: (loading: boolean) => void;
  private toolAbortController: AbortController | null = null;
  private systemPrompt?: string;
  private subagentType?: string; // Store subagent type for hook context
  private stream: boolean; // Streaming mode flag
  private modelOverride?: string;
  private consecutiveCompactionFailures: number = 0;
  private readonly maxTurns?: number;
  /** Tracks which deferred tools have been discovered via ToolSearch */
  private discoveredTools = new Set<string>();

  // Service overrides
  constructor(
    private container: Container,
    options: AIManagerOptions,
  ) {
    this.systemPrompt = options.systemPrompt;
    this.subagentType = options.subagentType; // Store subagent type
    this.stream = options.stream ?? true; // Default to true if not specified
    this.callbacks = options.callbacks ?? {};
    this.modelOverride = options.modelOverride;
    this.maxTurns = options.maxTurns;
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

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  // Getter methods for accessing dynamic configuration
  public getGatewayConfig(): GatewayConfig {
    return this.configurationService.resolveGatewayConfig();
  }

  public getModelConfig(): ModelConfig {
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    const parentModelConfig = this.configurationService.resolveModelConfig(
      undefined,
      undefined,
      undefined,
      permissionMode,
    );
    let modelToUse: string | undefined;

    if (this.modelOverride) {
      if (this.modelOverride === "fastModel") {
        modelToUse = parentModelConfig.fastModel;
      } else if (this.modelOverride !== "inherit") {
        modelToUse = this.modelOverride;
      }
    }

    return this.configurationService.resolveModelConfig(
      modelToUse,
      undefined,
      undefined,
      permissionMode,
    );
  }

  public getMaxInputTokens(): number {
    return this.configurationService.resolveMaxInputTokens();
  }

  public getLanguage(): string | undefined {
    return this.configurationService.resolveLanguage();
  }

  public getAutoMemoryEnabled(): boolean {
    return this.configurationService.resolveAutoMemoryEnabled();
  }

  public getWorkdir(): string {
    return this.container.get<string>("Workdir") ?? process.cwd();
  }

  /**
   * Update the working directory mid-session (e.g., when entering/exiting a worktree).
   * Also updates process.chdir() so bash commands use the new directory.
   */
  public setWorkdir(newWorkdir: string): void {
    this.container.register("Workdir", newWorkdir);
    process.chdir(newWorkdir);
  }

  private isCompacting: boolean = false;
  private callbacks: AIManagerCallbacks;

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
      workdir: this.getWorkdir(),
      isSubagent: !!this.subagentType,
      discoveredTools: this.discoveredTools,
    });
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
          workdir: this.getWorkdir(),
          taskManager: this.taskManager,
        };
        return toolPlugin.formatCompactParams(toolArgs, context);
      }
    } catch (error) {
      logger?.warn("Failed to generate compactParams", error);
    }
    return "";
  }

  // Private method to handle token statistics and message compaction
  private async handleTokenUsageAndCompaction(
    usage: Usage | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (!usage) return;

    // Update token statistics - display comprehensive token usage including cache tokens
    const comprehensiveTotalTokens = calculateComprehensiveTotalTokens(usage);
    this.messageManager.setlatestTotalTokens(comprehensiveTotalTokens);

    // Check if token limit exceeded - use injected configuration
    if (
      usage.total_tokens +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) >
      this.getMaxInputTokens()
    ) {
      logger?.debug(
        `Token usage exceeded ${this.getMaxInputTokens()}, compacting messages...`,
      );

      // Check if messages need compaction
      const messagesToCompact = this.messageManager.getMessages();

      // If there are messages to compact, perform compaction
      if (messagesToCompact.length > 0) {
        // Circuit breaker: skip compaction after 3 consecutive failures
        if (this.consecutiveCompactionFailures >= 3) {
          logger?.warn(
            `Skipping compaction: ${this.consecutiveCompactionFailures} consecutive failures`,
          );
          return;
        }

        const recentChatMessages = convertMessagesForAPI(messagesToCompact);

        // Save session before compaction to preserve original messages
        await this.messageManager.saveSession();

        this.setIsCompacting(true);
        try {
          const compactResult = await aiService.compactMessages({
            gatewayConfig: this.getGatewayConfig(),
            modelConfig: this.getModelConfig(),
            messages: recentChatMessages,
            abortSignal: abortController.signal,
            model: this.getModelConfig().fastModel,
          });

          // Handle usage tracking for compaction operations
          let compactUsage: Usage | undefined;
          if (compactResult.usage) {
            compactUsage = {
              prompt_tokens: compactResult.usage.prompt_tokens,
              completion_tokens: compactResult.usage.completion_tokens,
              total_tokens: compactResult.usage.total_tokens,
              model: this.getModelConfig().fastModel,
              operation_type: "compact",
            };
          }

          // Build post-compact context restoration
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
            const fileTokens = Math.ceil(file.content.length / 4);
            if (usedTokens + fileTokens > POST_COMPACT_MAX_TOKENS_PER_FILE)
              continue;
            if (fileTokens > 0) usedTokens += fileTokens;
            contextParts.push(
              `\n\n## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``,
            );
            if (contextParts.length >= POST_COMPACT_MAX_FILES_TO_RESTORE) break;
            if (usedTokens >= POST_COMPACT_TOKEN_BUDGET) break;
          }

          // 2. Working directory
          contextParts.push(
            `\n\n[Working Directory]\nCurrent working directory: ${this.getWorkdir()}`,
          );

          // 3. Plan mode context
          const currentMode = this.permissionManager?.getCurrentEffectiveMode(
            this.getModelConfig().permissionMode,
          );
          if (currentMode === "plan") {
            const planFilePath = this.permissionManager?.getPlanFilePath();
            if (planFilePath) {
              let planExists = false;
              try {
                await fs.access(planFilePath);
                planExists = true;
              } catch {
                // Plan file doesn't exist yet
              }
              contextParts.push(
                `\n\n[Plan Mode]\nYou are in plan mode. Plan file: ${planFilePath} (exists: ${planExists})`,
              );
            }
          }

          // 4. Invoked skills context (with token budget, matching Claude Code)
          const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;
          const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
          const invokedSkillNames =
            this.messageManager.getInvokedSkillNames(10);
          if (invokedSkillNames.length > 0 && this.skillManager) {
            const invokedSkillParts: string[] = [];
            let skillsUsedTokens = 0;
            for (const skillName of invokedSkillNames) {
              try {
                const skill = await this.skillManager.loadSkill(skillName);
                if (!skill) continue;

                // Extract content after frontmatter (matching prepareSkillContent pattern)
                const contentMatch = skill.content.match(
                  /^---\n[\s\S]*?\n---\n([\s\S]*)$/,
                );
                let skillContent = contentMatch
                  ? contentMatch[1].trim()
                  : skill.content;

                // Per-skill token budget enforcement (~4 chars per token)
                const maxSkillChars = POST_COMPACT_MAX_TOKENS_PER_SKILL * 4;
                if (skillContent.length > maxSkillChars) {
                  skillContent =
                    skillContent.slice(0, maxSkillChars) +
                    "\n\n...[truncated]...";
                }

                const skillTokens = Math.ceil(skillContent.length / 4);
                if (
                  skillsUsedTokens + skillTokens >
                  POST_COMPACT_SKILLS_TOKEN_BUDGET
                )
                  break;
                skillsUsedTokens += skillTokens;

                invokedSkillParts.push(
                  `\n\n## ${skill.name}\n${skill.description ? `*${skill.description}*\n\n` : ""}\`\`\`\n${skillContent}\n\`\`\``,
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
              contextParts.push(
                `\n\n[Background Tasks]\n${agentParts.join("\n")}`,
              );
            }
          }

          // Merge context restoration into summary
          const enhancedSummary =
            compactResult.content +
            (contextParts.length > 0
              ? `\n\n[Context Restoration]` + contextParts.join("")
              : "");

          // Execute message reconstruction and sessionId update after compaction
          this.messageManager.compactMessagesAndUpdateSession(
            enhancedSummary,
            compactUsage,
          );

          // Notify Agent to add to usage tracking
          if (compactUsage && this.callbacks?.onUsageAdded) {
            this.callbacks.onUsageAdded(compactUsage);
          }

          logger?.debug(
            `Successfully compacted ${messagesToCompact.length} messages and updated session`,
          );
          this.consecutiveCompactionFailures = 0;
        } catch (compactError) {
          this.consecutiveCompactionFailures++;
          logger?.error(
            `Failed to compact messages (${this.consecutiveCompactionFailures} consecutive):`,
            compactError,
          );
          this.messageManager.addErrorBlock(
            `Failed to compact conversation history: ${compactError instanceof Error ? compactError.message : String(compactError)}. You may encounter context limit issues.`,
          );
        } finally {
          this.setIsCompacting(false);
        }
      }
    }
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

  private get skillManager(): SkillManager | undefined {
    return this.container.get<SkillManager>("SkillManager");
  }

  /**
   * Build plan mode instruction message as a <system-reminder> wrapped string.
   * Matches Claude Code's wrapMessagesInSystemReminder pattern.
   */
  private buildPlanModeMessage(options: {
    planFilePath: string;
    planExists: boolean;
    isSubagent: boolean;
  }): string {
    const { planFilePath, planExists, isSubagent } = options;
    const planFileInfo = planExists
      ? `A plan file already exists at ${planFilePath}. You can read it and make incremental edits using the Edit tool.`
      : `No plan file exists yet. You should create your plan at ${planFilePath} using the Write tool.`;

    if (isSubagent) {
      return `<system-reminder>Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits, run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${planFileInfo}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.
Answer the user's query comprehensively, using the AskUserQuestion tool if you need to ask the user clarifying questions.</system-reminder>`;
    }

    return `<system-reminder>Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${planFileInfo}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the Agent tool with subagent_type=explore.

1. Focus on understanding the user's request and the code associated with their request. Actively search for existing functions, utilities, and patterns that can be reused — avoid proposing new code when suitable implementations already exist.

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
   - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
   - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
   - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
   - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigating testing patterns

### Phase 2: Design
Goal: Design an implementation approach.

Launch agent(s) with subagent_type=plan to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 3 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)
- **Multiple agents**: Use up to 3 agents for complex tasks that benefit from different perspectives

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use AskUserQuestion to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Begin with a **Context** section: explain why this change is being made — the problem or need it addresses, what prompted it, and the intended outcome
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Reference existing functions and utilities you found that should be reused, with their file paths
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call ExitPlanMode
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call ExitPlanMode to indicate to the user that you are done planning.
This is critical - your turn should only end with either using the AskUserQuestion tool OR calling ExitPlanMode. Do not stop unless it's for these 2 reasons

**Important:** Use AskUserQuestion ONLY to clarify requirements or choose between approaches. Use ExitPlanMode to request plan approval. Do NOT ask about plan approval in any other way - no text questions, no AskUserQuestion. Phrases like "Is this plan okay?", "Should I proceed?", "How does this plan look?", "Any changes before we start?", or similar MUST use ExitPlanMode.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications using the AskUserQuestion tool. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.</system-reminder>`;
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
    const { recursionDepth = 0, model, allowedRules, maxTokens } = options;

    // Set loading state early for the initial call, before any async work
    if (recursionDepth === 0) {
      this.setIsLoading(true);
      if (allowedRules && allowedRules.length > 0) {
        this.permissionManager?.addTemporaryRules(allowedRules);
      }
    }

    // Scan for file mentions in the last user message
    if (recursionDepth === 0) {
      const messages = this.messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.role === "user") {
        for (const block of lastMessage.blocks) {
          if (block.type === "text") {
            const content = block.content;
            const fileMentionRegex = /(?:^|\s)@([\w.\-/]+)/g;
            let match;
            while ((match = fileMentionRegex.exec(content)) !== null) {
              const filePath = match[1];
              this.messageManager.touchFile(filePath);
            }
          }
        }
      }
    }

    // Save session in each recursion to ensure message persistence
    await this.messageManager.saveSession();

    // Only create new AbortControllers for the initial call (recursionDepth === 0)
    // For recursive calls, reuse existing controllers to maintain abort signal
    let abortController: AbortController;
    let toolAbortController: AbortController;

    if (recursionDepth === 0) {
      // Create new AbortControllers for initial call
      abortController = new AbortController();
      this.abortController = abortController;

      toolAbortController = new AbortController();
      this.toolAbortController = toolAbortController;
    } else {
      // Reuse existing controllers for recursive calls
      abortController = this.abortController!;
      toolAbortController = this.toolAbortController!;
    }

    // Get recent message history with microcompact applied
    const rawMessages = this.messageManager.getMessages();
    const microcompactedMessages = microcompactMessages(rawMessages, {
      timeThresholdMS: 30 * 60 * 1000, // 30 minutes
      recentResultsToKeep: 3,
    });
    const recentMessages = convertMessagesForAPI(microcompactedMessages);

    // Get current permission mode and plan file path (needed for meta message injection)
    const currentMode = this.permissionManager?.getCurrentEffectiveMode(
      this.getModelConfig().permissionMode,
    );
    let planModeOptions:
      | { planFilePath: string; planExists: boolean; isSubagent: boolean }
      | undefined;

    if (currentMode === "plan") {
      const planFilePath = this.permissionManager?.getPlanFilePath();
      if (planFilePath) {
        let planExists = false;
        try {
          await fs.access(planFilePath);
          planExists = true;
        } catch {
          planExists = false;
        }
        planModeOptions = {
          planFilePath,
          planExists,
          isSubagent: !!this.subagentType,
        };
      }
    }

    // Inject deferred tools as a user meta message (matching Claude Code pattern).
    // Placed in messages rather than system prompt to preserve prompt cache stability
    // when MCP servers connect/disconnect.
    const deferredToolNames = this.toolManager.getDeferredToolNames();
    if (deferredToolNames.length > 0) {
      recentMessages.unshift({
        role: "user",
        content: `<available-deferred-tools>\n${deferredToolNames.join(" ")}\nThese tools are NOT loaded yet — call ToolSearch first to discover their schemas before invoking them.</available-deferred-tools>`,
      });
    }

    // Inject plan mode instructions as a user meta message (matching Claude Code pattern).
    // Placed in messages rather than system prompt to preserve prompt cache stability.
    if (planModeOptions) {
      const planModeMessage = this.buildPlanModeMessage(planModeOptions);
      recentMessages.unshift({
        role: "user",
        content: planModeMessage,
      });
    }

    try {
      // Get combined memory content
      const combinedMemory = await this.messageManager.getCombinedMemory();

      // Track if assistant message has been created
      let assistantMessageCreated = false;

      logger?.debug("modelConfig in sendAIMessage", this.getModelConfig());

      const toolsConfig = this.getFilteredToolsConfig();
      const toolNames = new Set(toolsConfig.map((t) => t.function.name));
      const filteredToolPlugins = this.toolManager
        .getTools()
        .filter((t) => toolNames.has(t.name));

      let autoMemoryOptions: { directory: string; content: string } | undefined;

      if (this.getAutoMemoryEnabled()) {
        const directory = this.memoryService.getAutoMemoryDirectory(
          this.getWorkdir(),
        );
        const content = await this.memoryService.getAutoMemoryContent(
          this.getWorkdir(),
        );
        autoMemoryOptions = { directory, content };
      }

      // Call AI service with streaming callbacks if enabled
      const callAgentOptions: CallAgentOptions = {
        gatewayConfig: this.getGatewayConfig(),
        modelConfig: this.getModelConfig(),
        messages: recentMessages,
        sessionId: this.messageManager.getSessionId(),
        abortSignal: abortController.signal,
        workdir: this.getWorkdir(), // Pass working directory
        tools: toolsConfig, // Pass filtered tool configuration
        model: model, // Use passed model
        systemPrompt: buildSystemPrompt(
          this.systemPrompt,
          filteredToolPlugins,
          {
            workdir: this.getWorkdir(),
            memory: combinedMemory,
            language: this.getLanguage(),
            isSubagent: !!this.subagentType,
            autoMemory: autoMemoryOptions,
            permissionMode: currentMode,
          },
        ), // Pass custom system prompt
        maxTokens: maxTokens, // Pass max tokens override
      };

      // Add streaming callbacks only if streaming is enabled
      if (this.stream) {
        callAgentOptions.onContentUpdate = (content: string) => {
          // Create assistant message on first chunk if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }
          this.messageManager.updateCurrentMessageContent(content);
        };
        callAgentOptions.onToolUpdate = (toolCall) => {
          // Create assistant message on first tool update if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }

          // Use parametersChunk as compact param for better performance
          // No need to extract params or generate compact params during streaming

          // Update tool block with streaming parameters using parametersChunk as compact param
          this.messageManager.updateToolBlock({
            id: toolCall.id,
            name: toolCall.name,
            parameters: toolCall.parameters,
            parametersChunk: toolCall.parametersChunk,
            stage: toolCall.stage || "streaming", // Default to streaming if stage not provided
          });
        };
        callAgentOptions.onReasoningUpdate = (reasoning: string) => {
          // Create assistant message on first reasoning update if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }
          this.messageManager.updateCurrentMessageReasoning(reasoning);
        };
      }

      const result = await aiService.callAgent(callAgentOptions);
      const createdByStreaming = assistantMessageCreated;

      // For non-streaming mode, create assistant message after callAgent returns
      // Also create if streaming mode but no streaming callbacks were called (e.g., when content comes directly in result)
      if (
        !this.stream ||
        (!assistantMessageCreated &&
          (result.content || result.tool_calls || result.reasoning_content))
      ) {
        this.messageManager.addAssistantMessage();
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
        this.messageManager.updateCurrentMessageReasoning(
          result.reasoning_content,
        );
      }

      // Handle result content from non-streaming mode
      if (result.content && !createdByStreaming) {
        this.messageManager.updateCurrentMessageContent(result.content);
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
          ...(result.usage.cache_creation && {
            cache_creation: result.usage.cache_creation,
          }),
        };
      }

      // Set usage on the assistant message if available
      if (usage) {
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
        // Execute all tools in parallel using Promise.all
        const toolExecutionPromises = toolCalls.map(
          async (functionToolCall) => {
            const toolId = functionToolCall.id || "";

            // Check if already interrupted, skip tool execution if so
            if (
              abortController.signal.aborted ||
              toolAbortController.signal.aborted
            ) {
              return;
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
                  logger.warn(
                    `Recovered truncated JSON for tool "${toolName}"`,
                  );
                } catch (parseError) {
                  let errorMessage = `Failed to parse tool arguments`;
                  if (result.finish_reason === "length") {
                    errorMessage +=
                      " (output truncated, please reduce your output)";
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
                  return;
                }
              }
            }

            const compactParams = this.generateCompactParams(
              toolName,
              toolArgs,
            );

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
              // Execute PreToolUse hooks before tool execution
              const shouldExecuteTool = await this.executePreToolUseHooks(
                toolName,
                toolArgs,
                toolId,
              );

              // If PreToolUse hooks blocked execution, skip tool execution
              if (!shouldExecuteTool) {
                logger?.info(
                  `Tool ${toolName} execution blocked by PreToolUse hooks`,
                );
                return; // Skip this tool and return from this map function
              }

              // Create tool execution context
              const context: ToolContext = {
                abortSignal: toolAbortController.signal,
                backgroundTaskManager: this.backgroundTaskManager,
                workdir: this.getWorkdir(),
                messageId: this.messageManager.getMessages().slice(-1)[0]?.id,
                sessionId: this.messageManager.getSessionId(),
                toolCallId: toolId,
                taskManager: this.taskManager,
                onShortResultUpdate: (shortResult: string) => {
                  this.messageManager.updateToolBlock({
                    id: toolId,
                    shortResult,
                    stage: "running", // Keep it in running stage while updating shortResult
                  });
                },
                onResultUpdate: (result: string) => {
                  this.messageManager.updateToolBlock({
                    id: toolId,
                    result,
                    stage: "running", // Keep it in running stage while updating result
                  });
                },
              };

              // Execute tool
              const toolResult = await this.toolManager.execute(
                functionToolCall.function?.name || "",
                toolArgs,
                context,
              );

              // Build result content, adding truncation warning if JSON was recovered
              let toolResultContent =
                toolResult.content ||
                (toolResult.error ? `Error: ${toolResult.error}` : "");
              if (jsonRecovered) {
                toolResultContent +=
                  "\n\n⚠️ Tool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls.";
              }

              // Update message state - tool execution completed
              this.messageManager.updateToolBlock({
                id: toolId,
                parameters: argsString,
                result: toolResultContent,
                success: toolResult.success,
                error: toolResult.error,
                stage: "end",
                name: toolName,
                compactParams,
                shortResult: toolResult.shortResult,
                isManuallyBackgrounded: toolResult.isManuallyBackgrounded,
                startLineNumber: toolResult.startLineNumber,
                timestamp: Date.now(),
              });

              // Execute PostToolUse hooks after successful tool completion
              await this.executePostToolUseHooks(
                toolId,
                toolName,
                toolArgs,
                toolResult,
              );

              // Track discovered tools from ToolSearch results
              if (toolName === "ToolSearch" && toolResult.success) {
                this.trackDiscoveredTools(toolResult.content);
              }
            } catch (toolError) {
              const errorMessage =
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError);

              this.messageManager.updateToolBlock({
                id: toolId,
                parameters: JSON.stringify(toolArgs, null, 2),
                result: `Tool execution failed: ${errorMessage}`,
                success: false,
                error: errorMessage,
                stage: "end",
                name: toolName,
                compactParams,
                isManuallyBackgrounded: false,
                timestamp: Date.now(),
              });
            }
          },
        );

        // Wait for all tools to complete execution in parallel
        await Promise.all(toolExecutionPromises);
      }

      // Handle token statistics and message compaction
      await this.handleTokenUsageAndCompaction(result.usage, abortController);

      // Finalize text/reasoning blocks for the final response (no tools)
      this.messageManager.finalizeStreamingBlocks();

      // Check if there are tool operations or response was truncated, if so automatically initiate next AI service call
      if (toolCalls.length > 0 || result.finish_reason === "length") {
        // Check maxTurns limit before recursing
        if (this.maxTurns && recursionDepth + 1 >= this.maxTurns) {
          logger?.debug(
            `Max turns (${this.maxTurns}) reached, stopping recursion.`,
          );
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

          // Check if all tools were manually backgrounded
          const lastMessage =
            this.messageManager.getMessages()[
              this.messageManager.getMessages().length - 1
            ];
          const toolBlocks =
            lastMessage?.blocks.filter(
              (block): block is import("../types/messaging.js").ToolBlock =>
                block.type === "tool",
            ) || [];
          const hasBackgrounded =
            toolBlocks.length > 0 &&
            toolBlocks.some((block) => block.isManuallyBackgrounded);

          if (hasBackgrounded) {
            logger?.info(
              "Some tools were manually backgrounded, stopping recursion.",
            );
          } else if (!isCurrentlyAborted) {
            // If response was truncated, add a hidden continuation message
            if (result.finish_reason === "length") {
              this.messageManager.addUserMessage({
                content:
                  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
                isMeta: true,
              });
            }

            // Duplicate Tool Call Detection
            if (toolCalls.length > 0) {
              const messages = this.messageManager.getMessages();
              // Find the most recent assistant message BEFORE the current one that has tool blocks
              // The current assistant message is messages[messages.length - 1]
              let previousAssistantWithTools: Message | undefined;
              for (let i = messages.length - 2; i >= 0; i--) {
                const msg = messages[i];
                if (
                  msg.role === "assistant" &&
                  msg.blocks.some((b) => b.type === "tool")
                ) {
                  previousAssistantWithTools = msg;
                  break;
                }
              }

              if (previousAssistantWithTools) {
                const previousToolBlocks =
                  previousAssistantWithTools.blocks.filter(
                    (b): b is import("../types/messaging.js").ToolBlock =>
                      b.type === "tool",
                  );

                for (const currentToolCall of toolCalls) {
                  const currentName = currentToolCall.function?.name;
                  const currentArgs = currentToolCall.function?.arguments;

                  const isDuplicate = previousToolBlocks.some(
                    (prevBlock) =>
                      prevBlock.name === currentName &&
                      prevBlock.parameters === currentArgs,
                  );

                  if (isDuplicate && currentName) {
                    const toolId = currentToolCall.id;
                    const lastMessage = messages[messages.length - 1];
                    const toolBlock = lastMessage.blocks.find(
                      (b): b is import("../types/messaging.js").ToolBlock =>
                        b.type === "tool" && b.id === toolId,
                    );
                    if (toolBlock) {
                      const warning = `\n\nNote: You just called this tool with the same arguments in the previous turn. Please ensure you are not in a loop and consider if you need to change your approach.`;
                      this.messageManager.updateToolBlock({
                        id: toolId,
                        result: (toolBlock.result || "") + warning,
                        stage: "end",
                      });
                    }
                  }
                }
              }
            }

            // Recursively call AI service, increment recursion depth, and pass same configuration
            await this.sendAIMessage({
              recursionDepth: recursionDepth + 1,
              model,
              allowedRules,
              maxTokens,
            });
          }
        }
      }
    } catch (error) {
      this.messageManager.addErrorBlock(
        error instanceof Error ? error.message : "Unknown error occurred",
      );
    } finally {
      // Only execute cleanup and hooks for the initial call
      if (recursionDepth === 0) {
        // Save session in each recursion to ensure message persistence
        await this.messageManager.saveSession();
        // Set loading to false first
        this.setIsLoading(false);

        // Inject pending notifications from background tasks
        const notificationQueue = this.container.has("NotificationQueue")
          ? this.container.get<NotificationQueue>("NotificationQueue")
          : undefined;
        if (notificationQueue && notificationQueue.hasPending()) {
          const notifications = notificationQueue.dequeueAll();
          for (const notification of notifications) {
            const block = parseTaskNotificationXml(notification);
            if (block) {
              this.messageManager.addNotificationMessage({
                taskId: block.taskId,
                taskType: block.taskType,
                status: block.status,
                summary: block.summary,
                outputFile: block.outputFile,
              });
            }
          }
          // Recursively process the notifications
          await this.sendAIMessage({
            recursionDepth: 0,
            model,
            allowedRules,
            maxTokens,
          });
        } else {
          // Clear temporary rules
          this.permissionManager?.clearTemporaryRules();

          // Clear abort controllers
          this.abortController = null;
          this.toolAbortController = null;

          // Execute Stop/SubagentStop hooks only if the operation was not aborted
          const isCurrentlyAborted =
            abortController.signal.aborted ||
            toolAbortController.signal.aborted;

          if (!isCurrentlyAborted) {
            // Record committed snapshots to message history for the final turn
            if (this.reversionManager) {
              const snapshots =
                this.reversionManager.getAndClearCommittedSnapshots();
              if (snapshots.length > 0) {
                this.messageManager.addFileHistoryBlock(snapshots);
              }
            }

            const shouldContinue = await this.executeStopHooks();

            // If Stop/SubagentStop hooks indicate we should continue (due to blocking errors),
            // restart the AI conversation cycle
            if (shouldContinue) {
              logger?.info(
                `${this.subagentType ? "SubagentStop" : "Stop"} hooks indicate issues need fixing, continuing conversation...`,
              );

              // Restart the conversation to let AI fix the issues
              // Use recursionDepth = 0 to set loading false again for continuation
              await this.sendAIMessage({
                recursionDepth: 0,
                model,
                allowedRules,
                maxTokens,
              });
            }
          }
        }
      }
    }
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

      const context: ExtendedHookExecutionContext = {
        event: hookName,
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        subagentType: this.subagentType, // Include subagent type in hook context
        // Stop hooks don't need toolName, toolInput, toolResponse, or userPrompt
        env: Object.fromEntries(
          Object.entries(process.env).filter((e) => e[1] !== undefined),
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

        // If hook processing indicates we should block (exit code 2), continue conversation
        if (processResult.shouldBlock) {
          logger?.info(
            `${hookName} hook blocked stopping with error:`,
            processResult.errorMessage,
          );
          shouldContinue = true;
        }
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
          autoMemoryService.onTurnEnd(this.getWorkdir()).catch((err) => {
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
   * Execute PreToolUse hooks before tool execution
   * Returns true if hooks allow tool execution, false if blocked
   */
  private async executePreToolUseHooks(
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolId?: string,
  ): Promise<boolean> {
    if (!this.hookManager) return true;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse",
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        toolInput,
        subagentType: this.subagentType, // Include subagent type in hook context
        env: Object.fromEntries(
          Object.entries(process.env).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PreToolUse",
        context,
      );

      // Process hook results to handle exit codes and determine if tool should be blocked
      let shouldContinue = true;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          "PreToolUse",
          results,
          this.messageManager,
          toolId, // Pass toolId for proper PreToolUse blocking error handling
          JSON.stringify(toolInput || {}, null, 2), // Pass serialized tool parameters
        );
        shouldContinue = !processResult.shouldBlock;
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} PreToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PreToolUse hook execution failed:", error);
      return true; // Allow tool execution on hook errors
    }
  }

  /**
   * Execute PostToolUse hooks after tool completion
   */
  private async executePostToolUseHooks(
    toolId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolResponse?: ToolResult,
  ): Promise<void> {
    if (!this.hookManager) return;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PostToolUse",
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        toolInput,
        toolResponse,
        subagentType: this.subagentType, // Include subagent type in hook context
        env: Object.fromEntries(
          Object.entries(process.env).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PostToolUse",
        context,
      );

      // Process hook results to handle exit codes and update tool results
      if (results.length > 0) {
        this.hookManager.processHookResults(
          "PostToolUse",
          results,
          this.messageManager,
          toolId,
        );
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} PostToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PostToolUse hook execution failed:", error);
    }
  }

  /**
   * Parse ToolSearch result content to extract discovered tool names.
   * ToolSearch returns content like "ToolName: description\nParameters: {...}"
   * or shortResult like "Discovered tools: ToolA, ToolB".
   */
  private trackDiscoveredTools(content: string): void {
    // Try to extract tool names from shortResult-style content
    const discoveredMatch = content.match(/Discovered tools?: ([\w-, ]+)/);
    if (discoveredMatch) {
      const names = discoveredMatch[1]!
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      for (const name of names) {
        this.discoveredTools.add(name);
      }
      logger?.debug("Discovered tools:", names);
      return;
    }

    // Fallback: extract tool names from "ToolName: description" pattern
    const lines = content.split("\n");
    const nonToolKeywords = new Set([
      "parameters",
      "description",
      "result",
      "error",
      "content",
      "type",
      "properties",
      "required",
    ]);
    for (const line of lines) {
      const toolMatch = line.match(/^([\w-]+):/);
      if (toolMatch && !nonToolKeywords.has(toolMatch[1]!.toLowerCase())) {
        this.discoveredTools.add(toolMatch[1]!);
      }
    }
  }
}
