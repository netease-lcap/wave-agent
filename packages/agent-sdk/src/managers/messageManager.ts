import {
  addAssistantMessageToMessages,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addUserMessageToMessages,
  updateUserMessageInMessages,
  addBangMessage,
  updateBangInMessage,
  completeBangInMessage,
  removeLastUserMessage,
  addToolBlockToMessageInMessages,
  addNotificationMessageToMessages,
  UserMessageParams,
  type AgentToolBlockUpdateParams,
  type ToolBlockUpdateCallbackParams,
  type AddNotificationMessageParams,
  generateMessageId,
} from "../utils/messageOperations.js";
import type { Message, Usage, ToolBlock } from "../types/index.js";
import { getLastApiRounds } from "../utils/groupMessagesByApiRound.js";
import { join, isAbsolute, relative } from "path";
import {
  appendMessages,
  createSession,
  generateSessionId,
  SessionData,
  SESSION_DIR,
} from "../services/session.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import type { MemoryRuleManager } from "./MemoryRuleManager.js";
import type { MemoryRule } from "../types/memoryRule.js";
import type { MemoryService } from "../services/memory.js";
import { pathEncoder } from "../utils/pathEncoder.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import { READ_TOOL_NAME } from "../constants/tools.js";

import { Container } from "../utils/container.js";

export interface MessageManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUsagesChange?: (usages: Usage[]) => void;
  // Incremental callback
  onUserMessageAdded?: (params: UserMessageParams) => void;
  // MODIFIED: Remove arguments for separation of concerns
  onAssistantMessageAdded?: (messageId: string) => void;
  // NEW: Streaming content callback - FR-001: receives chunk and accumulated content
  onAssistantContentUpdated?: (params: {
    messageId: string;
    chunk: string;
    accumulated: string;
    stage: "streaming" | "end";
  }) => void;
  // NEW: Streaming reasoning callback
  onAssistantReasoningUpdated?: (params: {
    messageId: string;
    chunk: string;
    accumulated: string;
    stage: "streaming" | "end";
  }) => void;
  onToolBlockUpdated?: (params: ToolBlockUpdateCallbackParams) => void;
  onErrorBlockAdded?: (error: string) => void;
  onCompactBlockAdded?: (content: string) => void;
  onCompactionStateChange?: (isCompacting: boolean) => void;
  // Bang callback
  onAddBangMessage?: (command: string) => void;
  onUpdateBangMessage?: (command: string, output: string) => void;
  onCompleteBangMessage?: (command: string, exitCode: number) => void;
  onInfoBlockAdded?: (content: string) => void;
  // Rewind callbacks
  onShowRewind?: () => void;
  onFileHistoryBlockAdded?: (
    snapshots: import("../types/reversion.js").FileSnapshot[],
  ) => void;
  // Notification callback
  onNotificationMessageAdded?: (params: {
    taskId: string;
    taskType: "shell" | "agent" | "workflow";
    status: "completed" | "failed" | "killed" | "aborted";
    summary: string;
  }) => void;
}

import { logger } from "../utils/globalLogger.js";

export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  sessionType?: "main" | "subagent";
  subagentType?: string;
}

export class MessageManager {
  // Private state properties
  private sessionId: string;
  private messages: Message[];
  private latestTotalTokens: number;
  private workdir: string;
  private encodedWorkdir: string; // Cached encoded workdir
  private callbacks: MessageManagerCallbacks;
  private transcriptPath: string; // Cached transcript path
  private savedMessageCount: number; // Track how many messages have been saved to prevent duplication
  private pendingFileReadTriggers: Set<string> = new Set(); // File paths read via Read tool, awaiting rule matching
  private loadedRuleIds: Set<string> = new Set(); // IDs of conditional rules already injected as meta messages
  private recentFileReads: Map<string, { content: string; timestamp: number }> =
    new Map(); // Track file read contents
  private invokedSkills: Map<string, { skillName: string; timestamp: number }> =
    new Map(); // Track invoked skill names
  private sessionType: "main" | "subagent";
  private subagentType?: string;
  private _usages: Usage[] = [];

  constructor(
    private container: Container,
    options: MessageManagerOptions,
  ) {
    this.sessionId = generateSessionId();
    this.messages = [];
    this.latestTotalTokens = 0;
    this.workdir = options.workdir;
    this.encodedWorkdir = pathEncoder.encodeSync(this.workdir); // Cache encoded workdir
    this.callbacks = options.callbacks;
    this.savedMessageCount = 0; // Initialize saved message count tracker
    this.sessionType = options.sessionType || "main";
    this.subagentType = options.subagentType;

    // Compute and cache the transcript path
    this.transcriptPath = this.computeTranscriptPath();
  }

  private get memoryRuleManager(): MemoryRuleManager | undefined {
    return this.container.has("MemoryRuleManager")
      ? this.container.get<MemoryRuleManager>("MemoryRuleManager")
      : undefined;
  }

  private get memoryService(): MemoryService {
    const service = this.container.get<MemoryService>("MemoryService");
    if (!service) {
      throw new Error("MemoryService not found in container");
    }
    return service;
  }

  // Getter methods
  public getSessionId(): string {
    return this.sessionId;
  }

  public getRootSessionId(): string {
    return this.sessionId;
  }

  public getMessages(): Message[] {
    return [...this.messages];
  }

  public getUsages(): Usage[] {
    return [...this._usages];
  }

  public getLatestTotalTokens(): number {
    return this.latestTotalTokens;
  }

  public getWorkdir(): string {
    return this.workdir;
  }

  /**
   * Process pending file read triggers: match against conditional rules,
   * return rules not yet loaded (dedup via loadedRuleIds), mark them as loaded.
   * Clears triggers after processing.
   */
  public processTriggeredRules(): MemoryRule[] {
    if (!this.memoryRuleManager || this.pendingFileReadTriggers.size === 0) {
      this.pendingFileReadTriggers.clear();
      return [];
    }
    const filePaths = Array.from(this.pendingFileReadTriggers);
    this.pendingFileReadTriggers.clear();

    const { conditional } =
      this.memoryRuleManager.getActiveRulesSplit(filePaths);
    const newRules = conditional.filter(
      (rule) => !this.loadedRuleIds.has(rule.id),
    );
    for (const rule of newRules) {
      this.loadedRuleIds.add(rule.id);
    }
    return newRules;
  }

  public getSessionDir(): string {
    return SESSION_DIR;
  }

  public getTranscriptPath(): string {
    return this.transcriptPath;
  }

  /**
   * Get combined memory content (project memory + user memory + unconditional rules)
   * Note: conditional rules are handled separately via processTriggeredRules().
   */
  public async getCombinedMemory(): Promise<string> {
    let combined = await this.memoryService.getCombinedMemoryContent(
      this.workdir,
    );

    if (this.memoryRuleManager) {
      const { unconditional } = this.memoryRuleManager.getActiveRulesSplit([]);
      if (unconditional.length > 0) {
        combined += "\n\n";
        combined += unconditional.map((r) => r.content).join("\n\n");
      }
    }

    return combined;
  }

  /**
   * Get memory content for message-array injection:
   * - prependContent: AGENTS.md + user memory + unconditional rules (for head injection)
   * Conditional rules are handled separately via processTriggeredRules().
   */
  public async getMemoryForInjection(): Promise<{
    prependContent: string;
  }> {
    const baseMemory = await this.memoryService.getCombinedMemoryContent(
      this.workdir,
    );

    let prependContent = baseMemory;

    if (this.memoryRuleManager) {
      const { unconditional } = this.memoryRuleManager.getActiveRulesSplit([]);
      if (unconditional.length > 0) {
        prependContent += "\n\n";
        prependContent += unconditional.map((r) => r.content).join("\n\n");
      }
    }

    return { prependContent };
  }

  /**
   * Compute the transcript path using cached encoded workdir
   * Called during construction and when sessionId changes
   */
  private computeTranscriptPath(): string {
    const baseDir = join(SESSION_DIR, this.encodedWorkdir);

    // All sessions now go in the same directory
    // Session type is determined by metadata, not file path
    return join(baseDir, `${this.sessionId}.jsonl`);
  }

  // Setter methods, will trigger callbacks
  public setSessionId(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      // Reset saved message count for new session
      this.savedMessageCount = 0;
      // Recompute transcript path since session ID changed
      this.transcriptPath = this.computeTranscriptPath();

      this.callbacks.onSessionIdChange?.(sessionId);
    }
  }

  /**
   * Create session if needed (async helper)
   */
  private async createSessionIfNeeded(): Promise<void> {
    try {
      await createSession(this.sessionId, this.workdir, this.sessionType);
    } catch (error) {
      logger?.error("Failed to create session:", error);
    }
  }

  /**
   * Record a file path read via the Read tool, to be matched against
   * conditional memory rules before the next AI call.
   */
  public triggerFileRead(filePath: string): void {
    const normalizedPath = isAbsolute(filePath)
      ? relative(this.workdir, filePath)
      : filePath;
    this.pendingFileReadTriggers.add(normalizedPath);
  }

  /**
   * Check if a file has been read (for read-before-edit enforcement).
   * Uses recentFileReads Map populated from Read tool execution.
   */
  public hasFileBeenRead(filePath: string): boolean {
    const normalizedPath = isAbsolute(filePath)
      ? relative(this.workdir, filePath)
      : filePath;
    return (
      this.recentFileReads.has(normalizedPath) ||
      this.recentFileReads.has(filePath)
    );
  }

  public setMessages(messages: Message[]): void {
    const oldLength = this.messages.length;
    this.messages = [...messages];

    // Incrementally extract metadata from new messages
    const newMessages = messages.slice(oldLength);
    for (const message of newMessages) {
      this.extractFileReadsFromMessage(message);
      this.extractSkillInvocationsFromMessage(message);
    }

    // Also check if the last message was updated (common for tool blocks)
    if (messages.length > 0 && messages.length === oldLength) {
      this.extractFileReadsFromMessage(messages[messages.length - 1]);
      this.extractSkillInvocationsFromMessage(messages[messages.length - 1]);
    }

    this.callbacks.onMessagesChange?.([...messages]);
  }

  /**
   * Save current session
   */
  public async saveSession(): Promise<void> {
    try {
      // Only save messages that haven't been saved yet
      const unsavedMessages = this.messages.slice(this.savedMessageCount);

      if (unsavedMessages.length === 0) {
        // No new messages to save
        return;
      }

      // Create session if needed (only when we have messages to save)
      if (this.savedMessageCount === 0) {
        // This is the first time saving messages, so create the session
        await this.createSessionIfNeeded();
      }

      // Use JSONL format for new sessions
      await appendMessages(
        this.sessionId,
        unsavedMessages,
        this.workdir,
        this.sessionType,
      );

      // Update the saved message count
      this.savedMessageCount = this.messages.length;
    } catch (error) {
      logger?.error("Failed to save session:", error);
    }
  }

  public setlatestTotalTokens(latestTotalTokens: number): void {
    if (this.latestTotalTokens !== latestTotalTokens) {
      this.latestTotalTokens = latestTotalTokens;

      this.callbacks.onLatestTotalTokensChange?.(latestTotalTokens);
    }
  }

  /**
   * Clear messages
   */
  public clearMessages(): void {
    this.setMessages([]);
    const newSessionId = generateSessionId();
    this.setSessionId(newSessionId);
    this.setlatestTotalTokens(0);
    this.savedMessageCount = 0; // Reset saved message count
  }

  /**
   * Trigger the rewind UI callback
   */
  public triggerShowRewind(): void {
    this.callbacks.onShowRewind?.();
  }

  // Initialize state from session data
  public initializeFromSession(sessionData: SessionData): void {
    this.setSessionId(sessionData.id);
    this.setMessages([...sessionData.messages]);
    this.setlatestTotalTokens(sessionData.metadata.latestTotalTokens);

    // Rebuild loadedRuleIds from persisted meta messages (session restore)
    this.rebuildLoadedRuleIds();

    // Set saved message count to the number of loaded messages since they're already saved
    // This must be done after setSessionId which resets it to 0
    this.savedMessageCount = sessionData.messages.length;
  }

  // Encapsulated message operation functions
  public addUserMessage(params: UserMessageParams): string {
    const id = generateMessageId();
    const newMessages = addUserMessageToMessages({
      messages: this.messages,
      ...params,
      id,
    });
    this.setMessages(newMessages);
    this.callbacks.onUserMessageAdded?.(params);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
    return id;
  }

  /**
   * Update an existing user message by its ID.
   */
  public updateUserMessage(
    id: string,
    params: Partial<UserMessageParams>,
  ): void {
    const newMessages = updateUserMessageInMessages(this.messages, id, params);
    this.setMessages(newMessages);
  }

  public addAssistantMessage(
    content?: string,
    toolCalls?: ChatCompletionMessageFunctionToolCall[],
    usage?: Usage,
    additionalFields?: Record<string, unknown>,
  ): void {
    const additionalFieldsRecord = additionalFields
      ? Object.fromEntries(
          Object.entries(additionalFields).filter(
            ([, value]) => value !== undefined,
          ),
        )
      : undefined;

    const newMessages = addAssistantMessageToMessages(
      this.messages,
      content,
      toolCalls,
      usage,
      additionalFieldsRecord,
    );
    this.setMessages(newMessages);
    const messageId = this.messages[this.messages.length - 1]?.id;
    this.callbacks.onAssistantMessageAdded?.(messageId);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
  }

  public mergeAssistantAdditionalFields(
    additionalFields: Record<string, unknown>,
  ): void {
    if (!additionalFields || Object.keys(additionalFields).length === 0) {
      return;
    }

    const newMessages = [...this.messages];
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const message = newMessages[i];
      if (message.role === "assistant") {
        const mergedAdditionalFields = {
          ...(message.additionalFields || {}),
        } as Record<string, unknown>;

        for (const [key, value] of Object.entries(additionalFields)) {
          if (value === undefined) {
            continue;
          }
          mergedAdditionalFields[key] = value;
        }

        if (Object.keys(mergedAdditionalFields).length === 0) {
          return;
        }

        message.additionalFields = mergedAdditionalFields;
        this.setMessages(newMessages);
        return;
      }
    }
  }

  public updateToolBlock(params: AgentToolBlockUpdateParams): void {
    // Finalize any streaming text/reasoning blocks before adding/updating a tool block
    this.finalizeStreamingBlocks();
    const { messages: newMessages, messageId: resolvedMessageId } =
      updateToolBlockInMessage({
        messages: this.messages,
        ...params,
      });
    this.setMessages(newMessages);
    const callbackParams: ToolBlockUpdateCallbackParams = {
      ...params,
      messageId:
        params.messageId ||
        resolvedMessageId ||
        this.messages[this.messages.length - 1]?.id ||
        "",
    };
    this.callbacks.onToolBlockUpdated?.(callbackParams);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
  }

  /**
   * Add a tool block to a specific message by ID.
   */
  public addToolBlockToMessage(
    messageId: string,
    params: Omit<AgentToolBlockUpdateParams, "id">,
  ): string {
    // Finalize any streaming text/reasoning blocks before adding a tool block
    this.finalizeStreamingBlocks();
    const { messages: newMessages, toolBlockId } =
      addToolBlockToMessageInMessages(this.messages, messageId, params);
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.({
      ...params,
      id: toolBlockId,
      messageId,
    });
    return toolBlockId;
  }

  public addErrorBlock(error: string): void {
    const newMessages = addErrorBlockToMessage({
      messages: this.messages,
      error,
    });
    this.setMessages(newMessages);
    this.callbacks.onErrorBlockAdded?.(error);
  }

  public addInfoBlock(content: string): void {
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      lastMessage.blocks.push({
        type: "info",
        content,
      } as unknown as import("../types/index.js").MessageBlock);
      this.setMessages([...this.messages]);
      this.callbacks.onInfoBlockAdded?.(content);
    }
  }

  /**
   * Compact messages and update session — append compact message to same file (append-only).
   * After compaction, in-memory messages are [compactMessage, ...lastThreeMessages].
   */
  public async compactMessagesAndUpdateSession(
    compactedContent: string,
    usage?: Usage,
  ): Promise<void> {
    // Get last 2 API rounds to preserve (structurally safe boundary)
    const lastThreeMessages = getLastApiRounds(this.messages, 2);

    // Create compacted message
    const compactMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "compact",
          content: compactedContent,
        },
      ],
      timestamp: new Date().toISOString(),
      ...(usage && { usage }),
    };

    // Build new message array: keep the compacted message and last messages
    const newMessages: Message[] = [compactMessage, ...lastThreeMessages];

    // APPEND to the same session file (append-only, like Claude Code)
    const { appendMessages } = await import("../services/session.js");
    await appendMessages(
      this.sessionId,
      newMessages,
      this.workdir,
      this.sessionType,
    );

    // Update in-memory state
    this.setMessages(newMessages);
    this.savedMessageCount = newMessages.length;

    // Clear and rebuild loaded rule IDs from remaining meta messages
    this.clearLoadedRuleIds();
    this.rebuildLoadedRuleIds();

    // Trigger compaction callback
    this.callbacks.onCompactBlockAdded?.(compactedContent);
  }

  public addFileHistoryBlock(
    snapshots: import("../types/reversion.js").FileSnapshot[],
  ): void {
    if (snapshots.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage && lastMessage.role === "assistant") {
      lastMessage.blocks.push({
        type: "file_history",
        snapshots,
      } as unknown as import("../types/index.js").MessageBlock);
      this.setMessages([...this.messages]);
      this.callbacks.onFileHistoryBlockAdded?.(snapshots);
    }
  }

  // Bang related message operations
  public addBangMessage(command: string): void {
    const updatedMessages = addBangMessage({
      messages: this.messages,
      command,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onAddBangMessage?.(command);
  }

  public updateBangMessage(command: string, output: string): void {
    const updatedMessages = updateBangInMessage({
      messages: this.messages,
      command,
      output,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onUpdateBangMessage?.(command, output);
  }

  public completeBangMessage(
    command: string,
    exitCode: number,
    output?: string,
  ): void {
    const updatedMessages = completeBangInMessage({
      messages: this.messages,
      command,
      exitCode,
      output,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onCompleteBangMessage?.(command, exitCode);
  }

  public addNotificationMessage(
    params: Omit<AddNotificationMessageParams, "messages">,
  ): void {
    const newMessages = addNotificationMessageToMessages({
      messages: this.messages,
      ...params,
    });
    this.setMessages(newMessages);
    this.callbacks.onNotificationMessageAdded?.({
      taskId: params.taskId,
      taskType: params.taskType,
      status: params.status,
      summary: params.summary,
    });
  }

  /**
   * Rebuild usage array from messages containing usage metadata
   * Called during session restoration to reconstruct usage tracking
   */
  public rebuildUsageFromMessages(messages: Message[]): void {
    this._usages = [];
    messages.forEach((message) => {
      if (message.role === "assistant" && message.usage) {
        this._usages.push(message.usage);
      }
    });
    // Trigger callback after rebuilding usage array
    this.triggerUsageChange();
  }

  /**
   * Add usage data to the tracking array and trigger callbacks
   * @param usage Usage data from AI operations
   */
  public addUsage(usage: Usage): void {
    this._usages.push(usage);
    this.triggerUsageChange();
  }

  /**
   * Trigger usage change callback with all usage data from assistant messages
   */
  public triggerUsageChange(): void {
    this.callbacks.onUsagesChange?.([...this._usages]);
  }

  /**
   * Finalize a streaming block of the given type by setting its stage to "end".
   * Fires the corresponding incremental callback with chunk="" to signal finalization.
   * Does NOT call onMessagesChange — the caller is responsible for that.
   * Returns true if a block was finalized.
   */
  private finalizeStreamingBlock(
    lastMessage: Message,
    type: "text" | "reasoning",
  ): boolean {
    const index = lastMessage.blocks.findIndex(
      (block) =>
        block.type === type &&
        (block as { stage?: string }).stage === "streaming",
    );
    if (index < 0) return false;

    const block = lastMessage.blocks[index] as {
      type: "text" | "reasoning";
      content: string;
      stage?: string;
      startTime?: number;
    };
    if (block.type === "reasoning") {
      lastMessage.blocks[index] = {
        type: "reasoning",
        content: block.content,
        stage: "end" as const,
        startTime: block.startTime,
        endTime: Date.now(),
      };
    } else {
      lastMessage.blocks[index] = {
        type: block.type,
        content: block.content,
        stage: "end" as const,
      };
    }

    // Fire incremental callback to signal finalization
    const callbackParams = {
      messageId: lastMessage.id,
      chunk: "",
      accumulated: block.content,
      stage: "end" as const,
    };
    if (type === "text") {
      this.callbacks.onAssistantContentUpdated?.(callbackParams);
    } else {
      this.callbacks.onAssistantReasoningUpdated?.(callbackParams);
    }
    return true;
  }

  /**
   * Update the current assistant message content during streaming
   * This method updates the last assistant message's content without creating a new message
   * FR-001: Tracks and provides both chunk (new content) and accumulated (total content)
   */
  public updateCurrentMessageContent(newAccumulatedContent: string): void {
    if (this.messages.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    // Finalize any streaming reasoning blocks before text content arrives
    this.finalizeStreamingBlock(lastMessage, "reasoning");

    // Get the current content to calculate the chunk
    const textBlockIndex = lastMessage.blocks.findIndex(
      (block) => block.type === "text",
    );
    const currentContent =
      textBlockIndex >= 0
        ? (
            lastMessage.blocks[textBlockIndex] as {
              type: "text";
              content: string;
            }
          ).content || ""
        : "";

    // Calculate the chunk (new content since last update)
    const chunk = newAccumulatedContent.slice(currentContent.length);

    if (textBlockIndex >= 0) {
      // Update existing text block
      lastMessage.blocks[textBlockIndex] = {
        type: "text",
        content: newAccumulatedContent,
        stage: "streaming",
      };
    } else {
      // Add new text block if none exists
      lastMessage.blocks.push({
        type: "text",
        content: newAccumulatedContent,
        stage: "streaming",
      });
    }

    // FR-001: Trigger callbacks with chunk and accumulated content
    this.callbacks.onAssistantContentUpdated?.({
      messageId: lastMessage.id,
      chunk,
      accumulated: newAccumulatedContent,
      stage: "streaming",
    });

    // Note: Subagent-specific callbacks are now handled by SubagentManager

    this.callbacks.onMessagesChange?.([...this.messages]); // Still need to notify of changes
  }

  /**
   * Update the current assistant message reasoning during streaming
   * This method updates the last assistant message's reasoning content without creating a new message
   */
  public updateCurrentMessageReasoning(newAccumulatedReasoning: string): void {
    if (this.messages.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    // Finalize any streaming text blocks before reasoning content arrives
    this.finalizeStreamingBlock(lastMessage, "text");

    // Get the current reasoning content to calculate the chunk
    const reasoningBlockIndex = lastMessage.blocks.findIndex(
      (block) => block.type === "reasoning",
    );
    const currentReasoning =
      reasoningBlockIndex >= 0
        ? (
            lastMessage.blocks[reasoningBlockIndex] as {
              type: "reasoning";
              content: string;
            }
          ).content || ""
        : "";

    // Calculate the chunk (new content since last update)
    const chunk = newAccumulatedReasoning.slice(currentReasoning.length);

    if (reasoningBlockIndex >= 0) {
      // Update existing reasoning block
      const existingStartTime = (
        lastMessage.blocks[reasoningBlockIndex] as {
          startTime?: number;
        }
      ).startTime;
      lastMessage.blocks[reasoningBlockIndex] = {
        type: "reasoning",
        content: newAccumulatedReasoning,
        stage: "streaming",
        startTime: existingStartTime,
      };
    } else {
      // Add new reasoning block if none exists
      lastMessage.blocks.push({
        type: "reasoning",
        content: newAccumulatedReasoning,
        stage: "streaming",
        startTime: Date.now(),
      });
    }

    // Trigger callbacks with chunk and accumulated reasoning content
    this.callbacks.onAssistantReasoningUpdated?.({
      messageId: lastMessage.id,
      chunk,
      accumulated: newAccumulatedReasoning,
      stage: "streaming",
    });

    this.callbacks.onMessagesChange?.([...this.messages]); // Still need to notify of changes
  }

  /**
   * Finalize streaming text/reasoning blocks by setting their stage to "end".
   * Called when a new block (e.g. tool) is appended during streaming, or when streaming completes.
   * Fires incremental callbacks for each finalized block.
   */
  public finalizeStreamingBlocks(): void {
    if (this.messages.length === 0) return;
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    const textFinalized = this.finalizeStreamingBlock(lastMessage, "text");
    const reasoningFinalized = this.finalizeStreamingBlock(
      lastMessage,
      "reasoning",
    );

    if (textFinalized || reasoningFinalized) {
      this.callbacks.onMessagesChange?.([...this.messages]);
    }
  }

  /**
   * Finalize any tool blocks still in a non-terminal stage (start/streaming/running)
   * by marking them as ended with an error. Called when the AI call is aborted or
   * fails mid-tool-stream so the UI stops showing the "running" spinner.
   * Fires onToolBlockUpdated for each finalized tool block.
   */
  public finalizeAbortedToolBlocks(error?: string): void {
    if (this.messages.length === 0) return;
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    const errorMessage = error ?? "Tool execution was aborted";
    let finalized = false;

    for (let i = 0; i < lastMessage.blocks.length; i++) {
      const block = lastMessage.blocks[i] as ToolBlock;
      if (block.type !== "tool" || block.stage === "end") continue;

      const timestamp = Date.now();
      lastMessage.blocks[i] = {
        ...block,
        stage: "end",
        success: false,
        error: errorMessage,
        timestamp,
      };
      finalized = true;

      this.callbacks.onToolBlockUpdated?.({
        id: block.id ?? "",
        messageId: lastMessage.id ?? "",
        name: block.name,
        parameters: block.parameters,
        parametersChunk: block.parametersChunk,
        compactParams: block.compactParams,
        stage: "end",
        success: false,
        error: errorMessage,
        isManuallyBackgrounded: block.isManuallyBackgrounded,
        timestamp,
      });
    }

    if (finalized) {
      this.setMessages([...this.messages]);
    }
  }

  /**
   * Remove the last user message from the conversation
   * Used for hook error handling when the user prompt needs to be erased
   */
  public removeLastUserMessage(): void {
    const newMessages = removeLastUserMessage(this.messages);
    this.setMessages(newMessages);
  }

  public async getFullMessageThread(): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    const { loadFullMessageThread } = await import("../services/session.js");
    return loadFullMessageThread(this.sessionId, this.workdir);
  }

  /**
   * Truncate history to a specific index and revert file changes.
   * @param index - The index of the user message to truncate to.
   * @param reversionManager - Optional ReversionManager to handle file rollbacks.
   */
  public async truncateHistory(
    index: number,
    reversionManager?: import("./reversionManager.js").ReversionManager,
  ): Promise<void> {
    const { messages } = await this.getFullMessageThread();

    if (index < 0 || index >= messages.length) {
      throw new Error(`Invalid message index: ${index}`);
    }

    const newMessages = messages.slice(0, index);
    const messagesToRemove = messages.slice(index);
    const messageIdsToRemove = messagesToRemove
      .map((m) => m.id as string)
      .filter((id) => !!id);

    if (reversionManager && messageIdsToRemove.length > 0) {
      await reversionManager.revertTo(messageIdsToRemove, messages);
    }

    // Rewrite file with truncated messages
    await this.rewriteSessionFile(newMessages);
    this.setMessages(newMessages);
    this.savedMessageCount = newMessages.length;
  }

  /**
   * Rewrite the session file with the current messages.
   */
  private async rewriteSessionFile(messages: Message[]): Promise<void> {
    try {
      const { writeFile } = await import("fs/promises");

      const content =
        messages
          .map((m) => {
            const { timestamp, ...rest } = m;
            return JSON.stringify({ timestamp, ...rest });
          })
          .join("\n") + (messages.length > 0 ? "\n" : "");

      await writeFile(this.transcriptPath, content, "utf8");
    } catch (error) {
      logger?.error("Failed to rewrite session file:", error);
    }
  }

  /**
   * Extract file read contents from tool result blocks in a message.
   */
  private extractFileReadsFromMessage(message: Message): void {
    for (const block of message.blocks) {
      if (
        block.type === "tool" &&
        block.name === READ_TOOL_NAME &&
        block.stage === "end" &&
        block.result &&
        block.parameters
      ) {
        let filePath: string | undefined;
        try {
          const params = JSON.parse(block.parameters) as Record<
            string,
            unknown
          >;
          filePath = params.file_path as string | undefined;
        } catch {
          // Ignore parse errors
        }
        if (filePath) {
          this.recentFileReads.set(filePath, {
            content: block.result,
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Get recent file read contents, sorted by timestamp (newest first).
   * @param maxFiles - Maximum number of files to return
   * @param maxTokensPerFile - Maximum tokens per file (CJK-aware estimation)
   * @returns Array of { path, content } sorted by recency
   */
  public getRecentFileReads(
    maxFiles = 5,
    maxTokensPerFile = 5000,
  ): Array<{ path: string; content: string }> {
    const sorted = Array.from(this.recentFileReads.entries())
      .sort(([, a], [, b]) => b.timestamp - a.timestamp)
      .slice(0, maxFiles);

    const result: Array<{ path: string; content: string }> = [];
    for (const [path, { content }] of sorted) {
      const tokenCount = estimateTokens(content);
      let truncated = content;
      if (tokenCount > maxTokensPerFile) {
        // Truncate proportionally to fit within the token budget
        const ratio = maxTokensPerFile / tokenCount;
        const cutIndex = Math.floor(content.length * ratio);
        truncated = content.slice(0, cutIndex);
      }
      result.push({ path, content: truncated });
    }
    return result;
  }

  /**
   * Extract skill invocations from tool blocks in a message.
   */
  private extractSkillInvocationsFromMessage(message: Message): void {
    for (const block of message.blocks) {
      if (
        block.type === "tool" &&
        block.name === "Skill" &&
        block.stage === "end" &&
        block.parameters
      ) {
        try {
          const params = JSON.parse(block.parameters) as Record<
            string,
            unknown
          >;
          const skillName = params.skill_name as string | undefined;
          if (skillName) {
            this.invokedSkills.set(skillName, {
              skillName,
              timestamp: Date.now(),
            });
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  /**
   * Get recently invoked skill names, sorted by timestamp (newest first).
   * @param maxSkills - Maximum number of skills to return
   * @returns Array of skill names sorted by recency
   */
  public getInvokedSkillNames(maxSkills = 10): string[] {
    const sorted = Array.from(this.invokedSkills.entries())
      .sort(([, a], [, b]) => b.timestamp - a.timestamp)
      .slice(0, maxSkills);

    return sorted.map(([, { skillName }]) => skillName);
  }

  /**
   * Clear all invoked skills (e.g., after compaction).
   */
  public clearInvokedSkills(): void {
    this.invokedSkills.clear();
  }

  /**
   * Clear the loaded rule IDs set (e.g., after compaction resets context).
   */
  public clearLoadedRuleIds(): void {
    this.loadedRuleIds.clear();
  }

  /**
   * Rebuild loadedRuleIds from persisted messages (session restore / post-compaction).
   * Scans for <!-- rule: {ruleId} --> markers in user meta message content.
   */
  public rebuildLoadedRuleIds(): void {
    for (const message of this.messages) {
      if (message.role !== "user" || !message.isMeta) continue;
      for (const block of message.blocks) {
        if (block.type === "text") {
          const content = (block as { content: string }).content;
          const match = content.match(/<!-- rule: (.+?) -->/);
          if (match) {
            this.loadedRuleIds.add(match[1]);
          }
        }
      }
    }
  }
}
