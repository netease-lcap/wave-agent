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
  UserMessageParams,
  type AgentToolBlockUpdateParams,
  generateMessageId,
} from "../utils/messageOperations.js";
import type { Message, Usage } from "../types/index.js";
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
import type { MemoryService } from "../services/memory.js";
import { pathEncoder } from "../utils/pathEncoder.js";

import { Container } from "../utils/container.js";

export interface MessageManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUsagesChange?: (usages: Usage[]) => void;
  // Incremental callback
  onUserMessageAdded?: (params: UserMessageParams) => void;
  // MODIFIED: Remove arguments for separation of concerns
  onAssistantMessageAdded?: () => void;
  // NEW: Streaming content callback - FR-001: receives chunk and accumulated content
  onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  // NEW: Streaming reasoning callback
  onAssistantReasoningUpdated?: (chunk: string, accumulated: string) => void;
  onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
  onErrorBlockAdded?: (error: string) => void;
  onCompressBlockAdded?: (content: string) => void;
  onCompressionStateChange?: (isCompressing: boolean) => void;
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
  private rootSessionId: string;
  private parentSessionId?: string;
  private messages: Message[];
  private latestTotalTokens: number;
  private workdir: string;
  private encodedWorkdir: string; // Cached encoded workdir
  private callbacks: MessageManagerCallbacks;
  private transcriptPath: string; // Cached transcript path
  private savedMessageCount: number; // Track how many messages have been saved to prevent duplication
  private filesInContext: Set<string> = new Set(); // Track files mentioned in the conversation
  private sessionType: "main" | "subagent";
  private subagentType?: string;
  private _usages: Usage[] = [];

  constructor(
    private container: Container,
    options: MessageManagerOptions,
  ) {
    this.sessionId = generateSessionId();
    this.rootSessionId = this.sessionId;
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
    return this.rootSessionId;
  }

  public getParentSessionId(): string | undefined {
    return this.parentSessionId;
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
   * Returns all files mentioned in the current conversation context.
   */
  public getFilesInContext(): string[] {
    return Array.from(this.filesInContext);
  }

  public getSessionDir(): string {
    return SESSION_DIR;
  }

  public getTranscriptPath(): string {
    return this.transcriptPath;
  }

  /**
   * Get combined memory content (project memory + user memory + modular rules)
   */
  public async getCombinedMemory(): Promise<string> {
    let combined = await this.memoryService.getCombinedMemoryContent(
      this.workdir,
    );

    if (this.memoryRuleManager) {
      const filesInContext = this.getFilesInContext();
      const activeRules = this.memoryRuleManager.getActiveRules(filesInContext);
      if (activeRules.length > 0) {
        combined += "\n\n";
        combined += activeRules.map((r) => r.content).join("\n\n");
      }
    }

    return combined;
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
   * Adds a file path to the set of files in context, normalizing it if necessary.
   */
  public touchFile(filePath: string): void {
    const normalizedPath = isAbsolute(filePath)
      ? relative(this.workdir, filePath)
      : filePath;
    this.filesInContext.add(normalizedPath);
  }

  /**
   * Extracts and adds file paths from a message's tool blocks.
   */
  private addPathsFromMessage(message: Message): void {
    for (const block of message.blocks) {
      if (block.type === "tool" && block.parameters) {
        try {
          const params = JSON.parse(block.parameters) as Record<
            string,
            unknown
          >;
          const paths = this.extractPathsFromParams(params);
          for (const p of paths) {
            this.touchFile(p);
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  public setMessages(messages: Message[]): void {
    const oldLength = this.messages.length;
    this.messages = [...messages];

    // Incrementally add paths from new messages
    const newMessages = messages.slice(oldLength);
    for (const message of newMessages) {
      this.addPathsFromMessage(message);
    }

    // Also check if the last message was updated (common for tool blocks)
    if (messages.length > 0 && messages.length === oldLength) {
      this.addPathsFromMessage(messages[messages.length - 1]);
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
        unsavedMessages, // Only append new messages
        this.workdir,
        this.sessionType,
        this.rootSessionId,
        this.parentSessionId,
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
    this.rootSessionId = newSessionId;
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
    this.rootSessionId = sessionData.rootSessionId || sessionData.id;
    this.parentSessionId = sessionData.parentSessionId;
    this.setMessages([...sessionData.messages]);
    this.setlatestTotalTokens(sessionData.metadata.latestTotalTokens);

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
    this.callbacks.onAssistantMessageAdded?.();

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
    const newMessages = updateToolBlockInMessage({
      messages: this.messages,
      ...params,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.(params);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
  }

  /**
   * Add a tool block to a specific message by ID.
   */
  public addToolBlockToMessage(
    messageId: string,
    params: Omit<AgentToolBlockUpdateParams, "id">,
  ): string {
    const { messages: newMessages, toolBlockId } =
      addToolBlockToMessageInMessages(this.messages, messageId, params);
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.({ ...params, id: toolBlockId });
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
   * Compress messages and update session, delete compressed messages, only keep compressed messages and last 3 messages
   */
  public compressMessagesAndUpdateSession(
    compressedContent: string,
    usage?: Usage,
  ): void {
    // Get last 3 messages to preserve
    const lastThreeMessages = this.messages.slice(-3);

    // Create compressed message
    const compressMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "compress",
          content: compressedContent,
          sessionId: this.sessionId,
        },
      ],
      ...(usage && { usage }),
    };

    // Build new message array: keep the compressed message and last 3 messages
    const newMessages: Message[] = [compressMessage, ...lastThreeMessages];

    // Update sessionId and parentSessionId
    const oldSessionId = this.sessionId;
    this.setSessionId(generateSessionId());
    this.parentSessionId = oldSessionId;

    // Trigger task list update if this is the main session to ensure continuity
    if (this.sessionType === "main") {
      this.callbacks.onSessionIdChange?.(this.sessionId);
    }

    // Set new message list
    this.setMessages(newMessages);

    // Reset and re-populate filesInContext
    this.filesInContext.clear();
    for (const message of this.messages) {
      this.addPathsFromMessage(message);
    }

    // Scan compressedContent for file mentions
    const fileMentionRegex = /(?:^|\s)@([\w.\-/]+)/g;
    let match;
    while ((match = fileMentionRegex.exec(compressedContent)) !== null) {
      this.touchFile(match[1]);
    }

    // Trigger compression callback
    this.callbacks.onCompressBlockAdded?.(compressedContent);
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
   * Update the current assistant message content during streaming
   * This method updates the last assistant message's content without creating a new message
   * FR-001: Tracks and provides both chunk (new content) and accumulated (total content)
   */
  public updateCurrentMessageContent(newAccumulatedContent: string): void {
    if (this.messages.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

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
    this.callbacks.onAssistantContentUpdated?.(chunk, newAccumulatedContent);

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
      lastMessage.blocks[reasoningBlockIndex] = {
        type: "reasoning",
        content: newAccumulatedReasoning,
        stage: "streaming",
      };
    } else {
      // Add new reasoning block if none exists
      lastMessage.blocks.push({
        type: "reasoning",
        content: newAccumulatedReasoning,
        stage: "streaming",
      });
    }

    // Trigger callbacks with chunk and accumulated reasoning content
    this.callbacks.onAssistantReasoningUpdated?.(
      chunk,
      newAccumulatedReasoning,
    );

    this.callbacks.onMessagesChange?.([...this.messages]); // Still need to notify of changes
  }

  /**
   * Finalize all streaming blocks by setting their stage to "end".
   * Called after tool execution completes to mark text/reasoning blocks as done.
   */
  public finalizeStreamingBlocks(): void {
    if (this.messages.length === 0) return;
    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    const newBlocks = lastMessage.blocks.map((block) => {
      if (
        (block.type === "text" || block.type === "reasoning") &&
        block.stage === "streaming"
      ) {
        return { ...block, stage: "end" as const };
      }
      return block;
    });

    // Only update if something changed
    const changed = newBlocks.some((b, i) => b !== lastMessage.blocks[i]);
    if (changed) {
      lastMessage.blocks = newBlocks;
      this.callbacks.onMessagesChange?.([...this.messages]);
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
    const { messages, sessionIds } = await this.getFullMessageThread();

    if (index < 0 || index >= messages.length) {
      throw new Error(`Invalid message index: ${index}`);
    }

    // Find which session the index belongs to
    let targetSessionId = this.sessionId;
    let targetIndexInSession = index;

    // We need to be careful here because loadFullMessageThread might have removed "compress" blocks
    // Let's re-calculate based on the actual messages returned.
    // Actually, it's easier to just load sessions one by one again or keep track of counts.

    // For simplicity, let's assume we want to truncate the WHOLE thread.
    // If the index is in a previous session, we need to:
    // 1. Load that session.
    // 2. Truncate it.
    // 3. Make it the current session.
    // 4. Delete/Invalidate subsequent sessions.

    // To correctly map 'index' to a session, we need to know the message count of each session
    // as they appear in the concatenated 'messages' array.

    let remainingIndex = index;
    const { loadSessionFromJsonl } = await import("../services/session.js");

    for (const sid of sessionIds) {
      const sessionData = await loadSessionFromJsonl(sid, this.workdir);
      if (!sessionData) continue;

      const sessionMessages = sessionData.messages;
      // If this is not the first session in the thread, it might have a compress block at the start
      // that was removed in getFullMessageThread.
      const hasCompressBlock = sessionMessages[0]?.blocks.some(
        (b) => b.type === "compress",
      );
      const effectiveMessages =
        hasCompressBlock && sid !== sessionIds[0]
          ? sessionMessages.slice(1)
          : sessionMessages;

      if (remainingIndex < effectiveMessages.length) {
        targetSessionId = sid;
        targetIndexInSession = hasCompressBlock
          ? remainingIndex + 1
          : remainingIndex;
        break;
      }
      remainingIndex -= effectiveMessages.length;
    }

    // Load the target session to perform truncation
    const targetSessionData = await loadSessionFromJsonl(
      targetSessionId,
      this.workdir,
    );
    if (!targetSessionData)
      throw new Error(`Target session ${targetSessionId} not found`);

    // Identify messages to be removed (from the whole thread)
    const messagesToRemove = messages.slice(index);
    const messageIdsToRemove = messagesToRemove
      .map((m) => m.id as string)
      .filter((id) => !!id);

    // Revert file changes if manager is provided
    if (reversionManager && messageIdsToRemove.length > 0) {
      await reversionManager.revertTo(messageIdsToRemove, messages);
    }

    // Truncate messages in the target session
    const newMessagesInSession = targetSessionData.messages.slice(
      0,
      targetIndexInSession,
    );

    // Update target session file
    this.sessionId = targetSessionId;
    this.rootSessionId = targetSessionData.rootSessionId || targetSessionId;
    this.parentSessionId = targetSessionData.parentSessionId;
    this.transcriptPath = this.computeTranscriptPath();

    await this.rewriteSessionFile(newMessagesInSession);

    // Update in-memory messages to the truncated session messages
    // We do NOT include ancestor messages here to avoid exceeding context limits.
    // The 'compress' block at the start of the session (if any) already summarizes them.
    this.setMessages(newMessagesInSession);

    // Update saved message count
    this.savedMessageCount = newMessagesInSession.length;

    // Notify session ID change if it changed
    this.callbacks.onSessionIdChange?.(this.sessionId);
  }

  /**
   * Rewrite the session file with the current messages.
   */
  private async rewriteSessionFile(messages: Message[]): Promise<void> {
    try {
      const { writeFile } = await import("fs/promises");

      const sessionMessages: import("../types/session.js").SessionMessage[] =
        messages.map((message) => ({
          ...message,
          timestamp: new Date().toISOString(),
        }));

      const content =
        sessionMessages.map((m) => JSON.stringify(m)).join("\n") +
        (sessionMessages.length > 0 ? "\n" : "");

      await writeFile(this.transcriptPath, content, "utf8");
    } catch (error) {
      logger?.error("Failed to rewrite session file:", error);
    }
  }

  private extractPathsFromParams(params: Record<string, unknown>): string[] {
    const paths: string[] = [];
    if (typeof params !== "object" || params === null) return paths;

    // Common parameter names for file paths
    const pathKeys = [
      "path",
      "filePath",
      "file_path",
      "target_file",
      "targetFile",
    ];
    for (const key of pathKeys) {
      if (typeof params[key] === "string") {
        paths.push(params[key]);
      }
    }

    // Handle arrays of paths (e.g. in Glob or Grep results if we ever track those,
    // but here we track inputs to tools)
    if (Array.isArray(params.files)) {
      for (const f of params.files) {
        if (typeof f === "string") paths.push(f);
      }
    }

    return paths;
  }
}
