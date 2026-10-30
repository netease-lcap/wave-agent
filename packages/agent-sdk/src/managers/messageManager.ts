import {
  addAssistantMessageToMessages,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addUserMessageToMessages,
  updateUserMessageInMessages,
  removeLastUserMessage,
  addToolBlockToMessageInMessages,
  addNotificationMessageToMessages,
  UserMessageParams,
  type AgentToolBlockUpdateParams,
  type ToolBlockUpdateCallbackParams,
  type AddNotificationMessageParams,
  generateMessageId,
  sliceFromLastCompact,
  firstUserTextOf,
  findFirstUserText,
} from "../utils/messageOperations.js";
import type {
  Message,
  Usage,
  ToolBlock,
  InvokedSkillRecord,
} from "../types/index.js";
import { getLastApiRounds } from "../utils/groupMessagesByApiRound.js";
import { join, isAbsolute, relative, resolve } from "path";
import {
  appendMessages,
  createSession,
  generateSessionId,
  // Aliased: this class exposes a `reAppendSessionMetadata` method of its own.
  reAppendSessionMetadata as reAppendSessionMetadataToFile,
  truncateSession,
  SessionData,
  SESSION_DIR,
} from "../services/session.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import type { MemoryRuleManager } from "./MemoryRuleManager.js";
import type { MemoryRule } from "../types/memoryRule.js";
import type { MemoryService } from "../services/memory.js";
import { pathEncoder } from "../utils/pathEncoder.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import {
  findNestedMemoryFiles,
  type NestedMemoryFile,
} from "../utils/nestedMemory.js";
import { READ_TOOL_NAME } from "../constants/tools.js";
import { MESSAGE_PAGE_SIZE } from "../constants/messageWindow.js";
import { takeTailFromMemory } from "../utils/messageWindow.js";
import type {
  MessageWindow,
  MessageWindowResult,
} from "../types/messageWindow.js";
import type { RewindCheckpoint } from "../utils/rewindCheckpoints.js";

import { Container } from "../utils/container.js";
// Cap for recentFileReads: content is only consumed by getRecentFileReads
// (top 5 for post-compact restoration), so bound both the entry count and the
// number of entries that keep full content (aligned with Claude Code's
// FileStateCache 100-entry limit). Paths beyond the content cap are kept so
// hasFileBeenRead can still answer for every file read this session.
const RECENT_FILE_READS_CACHE_LIMIT = 100;
const RECENT_FILE_READS_CONTENT_LIMIT = 10;

export interface MessageManagerCallbacks {
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUsagesChange?: (usages: Usage[]) => void;
  // Incremental callback
  onUserMessageAdded?: (params: UserMessageParams) => void;
  // MODIFIED: Remove arguments for separation of concerns
  onAssistantMessageAdded?: (messageId: string) => void;
  /**
   * A message that was already handed to the host must be dropped from its
   * incremental view (流式降级：失败尝试的半截消息作废).
   */
  onAssistantMessageDiscarded?: (messageId: string) => void;
  // NEW: Streaming content callback - FR-001: receives chunk delta and stage
  onAssistantContentUpdated?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  // NEW: Streaming reasoning callback
  onAssistantReasoningUpdated?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  onToolBlockUpdated?: (params: ToolBlockUpdateCallbackParams) => void;
  onErrorBlockAdded?: (error: string) => void;
  /**
   * Fires after compaction has written its state. `content` is the summary
   * text; `message` is the whole compact message — hosts append it to their
   * own copy of the list and forward it to the webview through the incremental
   * append channel, so compaction never replaces the table on screen. It is
   * optional so existing consumers keep working and a host that gets no
   * message falls back to a `getMessages` pull.
   */
  onCompactBlockAdded?: (content: string, message?: Message) => void;
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onInfoBlockAdded?: (content: string) => void;
  // Rewind callbacks
  onShowRewind?: () => void;
  onFileHistoryBlockAdded?: (
    snapshots: import("../types/reversion.js").FileSnapshot[],
  ) => void;
  // Notification callback
  onNotificationMessageAdded?: (params: {
    taskId: string;
    // Derived rather than repeated: the union lives on the block, and a copy
    // here silently excludes any member added there.
    taskType: import("../types/messaging.js").TaskNotificationBlock["taskType"];
    /** `"running"` = still alive, not terminal (see TaskNotificationBlock). */
    status: "running" | "completed" | "failed" | "killed" | "aborted";
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
  /**
   * How many messages the thread has in total — not how many the list holds.
   * After a compaction the list is only [summary, ...kept rounds], so its
   * length can no longer answer "how long is this conversation".
   */
  private threadMessageCount = 0;
  /**
   * Body of the thread's first user message; the session list falls back to it
   * when the session has no custom title. Captured as messages stream in
   * (that message is long gone from the list by then).
   */
  private firstUserText?: string;
  private pendingFileReadTriggers: Set<string> = new Set(); // File paths read via Read tool, awaiting rule matching
  private loadedRuleIds: Set<string> = new Set(); // IDs of conditional rules already injected as meta messages
  private pendingNestedMemoryTriggers: Set<string> = new Set(); // Absolute paths read since the last nested-memory scan
  private loadedNestedMemoryPaths: Set<string> = new Set(); // Nested memory files already injected (session-scoped, never evicted)
  private recentFileReads: Map<string, { content: string; timestamp: number }> =
    new Map(); // Track file read contents
  private invokedSkills: Map<string, InvokedSkillRecord> = new Map(); // Track invoked skills
  private sessionType: "main" | "subagent";
  private subagentType?: string;
  private _usages: Usage[] = [];
  /**
   * This session's user-set title, as last known to this process (set on
   * rename, or recovered from the transcript on resume). It is the fallback
   * `reAppendSessionMetadata` writes back at EOF once the `custom-title` entry
   * has been pushed out of the listing's tail window — at which point the file
   * itself can no longer answer "what was this session called".
   */
  private customTitle?: string;

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

  /**
   * Re-point this manager at another working directory (in-session session
   * switch). The encoded workdir and the transcript path are both derived from
   * it, so they must move together with it: otherwise the next append would
   * create a second copy of the same session file under the old project dir.
   */
  public setCurrentWorkdir(workdir: string): void {
    if (this.workdir === workdir) {
      return;
    }
    this.workdir = workdir;
    this.encodedWorkdir = pathEncoder.encodeSync(workdir);
    this.transcriptPath = this.computeTranscriptPath();
  }

  public getCurrentWorkdir(): string {
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

  /**
   * Directory of the project this session works in (`<session root>/<encoded
   * workdir>`) — the same directory the transcript lives in.
   *
   * Anything that belongs to the code being worked on rather than to the
   * machine goes here: the transcript (`computeTranscriptPath`) and the workflow
   * run directories. Keying those off the session ROOT instead made every run
   * visible to every other project on the machine (spec
   * multi-agent/workflow.md「从日志恢复工作流」场景 3).
   */
  public getProjectDir(): string {
    return join(SESSION_DIR, this.encodedWorkdir);
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
    // All sessions now go in the same directory
    // Session type is determined by metadata, not file path
    return join(this.getProjectDir(), `${this.sessionId}.jsonl`);
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
   *
   * Stored absolute: the match base belongs to the rule (its own project root)
   * and the path may live in a linked worktree, so relativizing here against
   * the session workdir would bake in the wrong base and lose the worktree
   * mapping. `MemoryRuleService` relativizes against the rule's base.
   */
  public triggerFileRead(filePath: string): void {
    this.pendingFileReadTriggers.add(
      isAbsolute(filePath) ? filePath : resolve(this.workdir, filePath),
    );
  }

  /**
   * Record an absolute path whose read may pull in a nested memory file
   * (`AGENTS.md` in one of its ancestor directories). Same coordinate space as
   * `triggerFileRead` (absolute), but a separate set: this one is consumed by
   * the nested walk, which needs the file's ancestor chain.
   */
  public triggerNestedMemory(filePath: string): void {
    this.pendingNestedMemoryTriggers.add(
      isAbsolute(filePath) ? filePath : resolve(this.workdir, filePath),
    );
  }

  /**
   * Resolve nested memory files for the paths read since the last call,
   * outermost first. Clears the pending set; dedup is session-scoped via
   * `loadedNestedMemoryPaths`.
   */
  public async collectNestedMemoryFiles(): Promise<NestedMemoryFile[]> {
    if (this.pendingNestedMemoryTriggers.size === 0) return [];

    const filePaths = Array.from(this.pendingNestedMemoryTriggers);
    this.pendingNestedMemoryTriggers.clear();

    const memories: NestedMemoryFile[] = [];
    for (const filePath of filePaths) {
      memories.push(
        ...(await findNestedMemoryFiles(
          filePath,
          this.workdir,
          this.loadedNestedMemoryPaths,
        )),
      );
    }
    return memories;
  }

  /**
   * Check if a file has been read in this session.
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

  /**
   * Replace the list.
   *
   * `countLifetime: false` is for the three paths that hand the list its
   * contents wholesale — session restore, compaction and rewind. They set the
   * thread's lifetime totals themselves (restore from the whole transcript,
   * compaction as "everything that was already counted, plus the summary
   * block"), so counting the fold's own survivors again would inflate them.
   */
  public setMessages(
    messages: Message[],
    opts?: { countLifetime?: boolean },
  ): void {
    const oldLength = this.messages.length;
    this.messages = [...messages];
    const added = messages.slice(oldLength);

    // The list is the context: after a compaction it is [summary, ...kept
    // rounds], and that is exactly what the UI shows. The thread's lifetime
    // totals are counted on the way in, because the moment a compaction folds
    // the list those messages are gone from it.
    if (opts?.countLifetime !== false) {
      for (const message of added) {
        this.threadMessageCount += 1;
        this.firstUserText ??= firstUserTextOf(message);
      }
    }

    for (const message of added) {
      this.extractFileReadsFromMessage(message);
      this.extractSkillInvocationsFromMessage(message);
    }

    // Also check if the last message was updated (common for tool blocks)
    if (messages.length > 0 && messages.length === oldLength) {
      this.extractFileReadsFromMessage(messages[messages.length - 1]);
      this.extractSkillInvocationsFromMessage(messages[messages.length - 1]);
    }
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

      // CC-aligned lazy materialization: when the session file has not been
      // materialized yet (no saved messages) and every unsaved message is a
      // meta message (isMeta: true, e.g. SessionStart hook context), skip
      // persistence. Persisting meta-only sessions would create "0 tokens /
      // No content" ghost entries in the resume list. The meta messages stay
      // in memory and are flushed together with the first real user/assistant
      // message (matches CC's pendingEntries buffering).
      if (
        this.savedMessageCount === 0 &&
        unsavedMessages.every((m) => m.isMeta)
      ) {
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

  public getCustomTitle(): string | undefined {
    return this.customTitle;
  }

  public setCustomTitle(customTitle: string | undefined): void {
    this.customTitle = customTitle;
  }

  /**
   * Re-append the session's metadata entries at EOF, so they stay inside the
   * tail window the session list reads. Called at the sparse points where the
   * transcript is about to be read back by another process (exit, compaction,
   * resume, rewind); doing it per save would cost a tail read plus a line on
   * every message.
   */
  public async reAppendSessionMetadata(): Promise<void> {
    try {
      await reAppendSessionMetadataToFile(
        this.sessionId,
        this.workdir,
        this.customTitle,
        this.sessionType,
      );
    } catch (error) {
      logger?.error("Failed to re-append session metadata:", error);
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
    this.threadMessageCount = 0;
    this.firstUserText = undefined;
    // The title belongs to the session that was just abandoned: the new
    // session id starts untitled until the user renames it.
    this.customTitle = undefined;
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
    // List and context are the same thing: the conversation starts at the last
    // compact boundary, so a resumed session shows [summary, ...kept rounds]
    // and the transcript keeps the rest for features that need it.
    this.setMessages(sliceFromLastCompact(sessionData.messages), {
      countLifetime: false,
    });
    // 载入器已经在扫描时数好了整条线程的条数与首个用户输入（那时压缩前的消息
    // 还在手边）；手工构造的会话数据没有这两项，就按传进来的数组算。
    this.threadMessageCount =
      sessionData.threadMessageCount ?? sessionData.messages.length;
    this.firstUserText =
      sessionData.firstUserText ?? findFirstUserText(sessionData.messages);
    this.setlatestTotalTokens(sessionData.metadata.latestTotalTokens);
    // Recovered by the whole-file scan on load: from here on it is the
    // in-memory fallback that survives the title entry sliding out of the
    // tail window.
    this.customTitle = sessionData.metadata.customTitle;

    // Rebuild loadedRuleIds from persisted meta messages (session restore)
    this.rebuildLoadedRuleIds();

    // Set saved message count to the number of loaded messages since they're already saved
    // This must be done after setSessionId which resets it to 0
    this.savedMessageCount = this.messages.length;
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
  ): string | undefined {
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
    return messageId;

    // Note: Subagent-specific callbacks are now handled by SubagentManager
  }

  /**
   * Drop a message from the conversation and from every host's incremental view.
   *
   * Used by the streaming → non-streaming fallback: the assistant message the
   * failed streaming attempt had already streamed into is void, so it is removed
   * by id instead of being finalized with an error block (spec: 流式响应正文
   * 中途断连时降级为非流式重发). Only messages past `savedMessageCount` can be
   * dropped — that prefix is already flushed to the session file, and removing an
   * entry below it would make `saveSession()`'s `slice(savedMessageCount)` skip a
   * live message.
   */
  public discardAssistantMessage(messageId: string | undefined): boolean {
    if (!messageId) return false;
    const index = this.messages.findIndex((m) => m.id === messageId);
    if (index < 0) return false;
    if (index < this.savedMessageCount) {
      logger.warn(
        "Refusing to discard an already-persisted message (streaming fallback)",
        { messageId },
      );
      return false;
    }
    this.messages.splice(index, 1);
    this.callbacks.onAssistantMessageDiscarded?.(messageId);
    return true;
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

    // The turn that triggered compaction has already finished streaming, so
    // finalize any still-'streaming' text/reasoning blocks on the preserved
    // last assistant message. Otherwise hosts that pull a full snapshot after
    // compaction (or the loop's own finalizeStreamingBlocks, which no-ops once
    // a plan-mode reminder is appended) would keep showing the streaming dot.
    const lastPreserved = lastThreeMessages[lastThreeMessages.length - 1];
    if (lastPreserved && lastPreserved.role === "assistant") {
      this.finalizeStreamingBlock(lastPreserved, "text");
      this.finalizeStreamingBlock(lastPreserved, "reasoning");
    }

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

    // APPEND only the compact block to the session file (append-only, like
    // Claude Code). The preserved last API rounds were already written before
    // compaction (saveSession ran at the start), so re-appending them would
    // duplicate those lines in the transcript — the loader relies on each
    // message id appearing exactly once (dedup-skipped, aligned with CC).
    const { appendMessages } = await import("../services/session.js");
    await appendMessages(
      this.sessionId,
      [compactMessage],
      this.workdir,
      this.sessionType,
    );

    // Compaction leaves the transcript readable by the next process that
    // lists sessions, so this is a flush point for the metadata entries.
    await this.reAppendSessionMetadata();

    // Update in-memory state: the list folds to [compact, ...last rounds].
    // What the user is looking at does not change here — the hosts append the
    // compact block to their own copy of the list (spec: 压缩不整表替换), so
    // the fold only takes effect on the next reload.
    this.setMessages(newMessages, { countLifetime: false });
    this.savedMessageCount = newMessages.length;
    this.threadMessageCount += 1;

    // Trim recent file read cache so contents compacted away are released
    this.trimRecentFileReads();

    // Clear and rebuild loaded rule IDs from remaining meta messages
    this.clearLoadedRuleIds();
    this.rebuildLoadedRuleIds();

    // Nested memory has no marker to rebuild from, so the dedup set is dropped
    // outright: compaction may have summarized the injected text away, and
    // re-injecting it on the next read of that subtree beats never showing it
    // again in this session.
    this.loadedNestedMemoryPaths.clear();

    // Trigger compaction callback. The compact message rides along so hosts
    // can append it incrementally (the display stream only gained one message
    // — the API context folding above is invisible to the UI).
    this.callbacks.onCompactBlockAdded?.(compactedContent, compactMessage);
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
  public rebuildUsageFromMessages(messages: Message[], usages?: Usage[]): void {
    if (usages) {
      // 恢复会话时载入器已扫过整条线程：用量统计要覆盖压缩前的对话，而传进来的
      // `messages` 只剩压缩后的尾部，从它推导会漏掉前半截。
      this._usages = [...usages];
    } else {
      this._usages = [];
      messages.forEach((message) => {
        if (message.role === "assistant" && message.usage) {
          this._usages.push(message.usage);
        }
      });
    }
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
   * Append a content chunk to the current assistant message during streaming.
   * The caller owns the delta: it passes only the new fragment, so the block is
   * appended in place instead of being replaced by a cumulative snapshot.
   * The non-streaming path also uses this to write the whole content in one call.
   */
  public appendCurrentMessageContent(chunk: string): void {
    if (!chunk) return;
    if (this.messages.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    // Finalize any streaming reasoning blocks before text content arrives
    this.finalizeStreamingBlock(lastMessage, "reasoning");

    const textBlockIndex = lastMessage.blocks.findIndex(
      (block) => block.type === "text",
    );

    if (textBlockIndex >= 0) {
      // Append to the existing text block
      const existingContent =
        (
          lastMessage.blocks[textBlockIndex] as {
            type: "text";
            content: string;
          }
        ).content || "";
      lastMessage.blocks[textBlockIndex] = {
        type: "text",
        content: existingContent + chunk,
        stage: "streaming",
      };
    } else {
      // Add new text block if none exists
      lastMessage.blocks.push({
        type: "text",
        content: chunk,
        stage: "streaming",
      });
    }

    // FR-001: Trigger callbacks with chunk delta and stage
    this.callbacks.onAssistantContentUpdated?.({
      messageId: lastMessage.id,
      chunk,
      stage: "streaming",
    });

    // Note: Subagent-specific callbacks are now handled by SubagentManager
  }

  /**
   * Append a reasoning chunk to the current assistant message during streaming.
   * Same delta-in contract as appendCurrentMessageContent.
   */
  public appendCurrentMessageReasoning(chunk: string): void {
    if (!chunk) return;
    if (this.messages.length === 0) return;

    const lastMessage = this.messages[this.messages.length - 1];
    if (lastMessage.role !== "assistant") return;

    // Finalize any streaming text blocks before reasoning content arrives
    this.finalizeStreamingBlock(lastMessage, "text");

    const reasoningBlockIndex = lastMessage.blocks.findIndex(
      (block) => block.type === "reasoning",
    );

    if (reasoningBlockIndex >= 0) {
      // Append to the existing reasoning block, keeping its start time
      const existingBlock = lastMessage.blocks[reasoningBlockIndex] as {
        type: "reasoning";
        content: string;
        startTime?: number;
      };
      lastMessage.blocks[reasoningBlockIndex] = {
        type: "reasoning",
        content: (existingBlock.content || "") + chunk,
        stage: "streaming",
        startTime: existingBlock.startTime,
      };
    } else {
      // Add new reasoning block if none exists
      lastMessage.blocks.push({
        type: "reasoning",
        content: chunk,
        stage: "streaming",
        startTime: Date.now(),
      });
    }

    // Trigger callbacks with chunk delta and stage
    this.callbacks.onAssistantReasoningUpdated?.({
      messageId: lastMessage.id,
      chunk,
      stage: "streaming",
    });
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

    this.finalizeStreamingBlock(lastMessage, "text");
    this.finalizeStreamingBlock(lastMessage, "reasoning");
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
        backgroundTaskId: block.backgroundTaskId,
        backgroundedByUser: block.backgroundedByUser,
        assistantAutoBackgrounded: block.assistantAutoBackgrounded,
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
   * `/rewind` 的检查点表：只投影 `{id, content, index}`，不留整份线程。
   *
   * 选择器要的是「整条线程里哪几条能回滚到」，而以前为了这几个字段把整份消息
   * （含工具结果里的 base64）读进内存数下标。扫一遍转录当场投影，峰值只与这张
   * 小表有关。
   */
  public async getRewindCheckpoints(): Promise<RewindCheckpoint[]> {
    const { loadRewindCheckpoints } = await import("../services/session.js");
    return loadRewindCheckpoints(this.sessionId, this.workdir);
  }

  /** 按 id 找回滚目标的位置与文本，扫转录即可，不读整份线程。 */
  public async findRewindTarget(
    messageId: string,
  ): Promise<{ index: number; content: string } | undefined> {
    const { findRewindTarget } = await import("../services/session.js");
    return findRewindTarget(this.sessionId, this.workdir, messageId);
  }

  /**
   * Answer a `getMessages` request: the whole list, or one page of it.
   *
   * - no parameters → the whole list (internal callers; still = 压缩后的上下文)
   * - `since` → everything appended after that id (remote page catch-up)
   * - `limit` → the newest `limit` (first screen)
   * - `before` → the page just above that id (上翻取更早)
   *
   * 内存里的列表从最近一次压缩开始，压缩之前的历史只在转录里，所以「上翻」和
   * 「首屏还有没有更早」这两件要读盘（`utils/transcriptPage.ts`）。读出来的页
   * **不写回内存**：它只活在页面那一侧，模型上下文一个字节都不变
   * （spec ui/message-rendering-system.md「内存只装压缩后的上下文，更早的历史
   * 按页从转录取」）。
   *
   * 锚点是消息 id 而不是下标：id 跨压缩边界稳定，所以翻页能连续走过压缩点。
   */
  public async getMessagePage(
    window: MessageWindow,
  ): Promise<MessageWindowResult> {
    const list = this.messages;

    if (window.since) {
      const at = lastIndexById(list, window.since);
      // Anchor gone (compaction / rewind / another session): ask the caller to
      // re-pull instead of answering with an empty list, which would read as
      // "nothing newer".
      if (at === -1) return { messages: [], reset: true };
      return { messages: list.slice(at + 1) };
    }

    if (!window.before && window.limit === undefined) {
      return { messages: [...list] };
    }

    const limit = window.limit ?? MESSAGE_PAGE_SIZE;

    if (!window.before) {
      // 首屏：内存尾部一页；内存放得下整份时才需要问转录还有没有更早。
      const page = takeTailFromMemory(list, limit);
      if (page.length < list.length) return { messages: page, hasMore: true };
      const earliest = page[0]?.id;
      return {
        messages: page,
        hasMore: earliest ? await this.hasTranscriptBefore(earliest) : false,
      };
    }

    // 上翻：锚点之上一段先在内存里取（那是刚刚显示过的那部分），不够再接转录。
    const at = lastIndexById(list, window.before);
    if (at === -1) {
      // 锚点不在内存里，说明它已经落在压缩边界之前了：整页从转录读。
      return this.readOlderPage(window);
    }
    const inMemory = takeTailFromMemory(list.slice(0, at), limit);
    if (inMemory.length >= limit) {
      return { messages: inMemory, hasMore: true };
    }
    const older = await this.readOlderPage({
      before: inMemory[0]?.id ?? window.before,
      limit: limit - inMemory.length,
    });
    if (older.anchorLost) {
      return { messages: inMemory, hasMore: false, anchorLost: true };
    }
    return {
      messages: [...older.messages, ...inMemory],
      hasMore: older.hasMore,
    };
  }

  /**
   * 从转录读一页更早的（不经过内存）。
   *
   * 读盘期间会话可能已经换掉了（`clearMessages` 换 sessionId、恢复另一个会话）：
   * 那一页属于上一个会话，拼进新列表就是串会话。参考物在同一位置做 revalidation
   * （读完再比一次会话身份），这里用同一个判据：会话变了就按新路径重读一次——
   * 新会话里那个锚点通常已经不存在，于是回 `anchorLost` 让调用方换更早的 id 重试；
   * 重读期间又变了就同样按锚点丢失处理。宁可让宿主多问一次，也不给出一页错会话
   * 的历史。
   */
  private async readOlderPage(
    window: MessageWindow,
  ): Promise<MessageWindowResult> {
    const { readTranscriptPage } = await import("../utils/transcriptPage.js");
    const sessionId = this.sessionId;
    let page = await readTranscriptPage(this.transcriptPath, window);
    if (this.sessionId !== sessionId) {
      // 换过会话了：以当前这条的身份重做一次，仍然变就放弃。
      const retryId = this.sessionId;
      page = await readTranscriptPage(this.transcriptPath, window);
      if (this.sessionId !== retryId) {
        return { messages: [], hasMore: false, anchorLost: true };
      }
    }
    return {
      messages: page.messages,
      hasMore: page.hasMore,
      ...(page.anchorLost ? { anchorLost: true } : {}),
    };
  }

  /** 转录里 `id` 之前还有没有消息；没有转录文件时为 false。 */
  private async hasTranscriptBefore(id: string): Promise<boolean> {
    const { hasTranscriptBefore } = await import("../utils/transcriptPage.js");
    return hasTranscriptBefore(this.transcriptPath, id);
  }

  /**
   * What the session list needs: total message count, the first user body
   * (title fallback) and the newest timestamp. The first two are counters —
   * the list starts at the last compaction, so it cannot answer them.
   */
  public getThreadSummary(): {
    messageCount: number;
    firstUserText?: string;
    lastActiveAt?: string;
  } {
    return {
      messageCount: this.threadMessageCount,
      ...(this.firstUserText ? { firstUserText: this.firstUserText } : {}),
      ...(this.messages.length > 0
        ? { lastActiveAt: this.messages[this.messages.length - 1].timestamp }
        : {}),
    };
  }

  /**
   * Truncate history to a specific index and revert file changes.
   *
   * The thread is only scanned, never materialised: the scan splits it into the
   * part that stays (the context after the last compaction boundary) and the
   * part being cut away (whose file snapshots `revertTo` needs), and hands back
   * the two counters a rewind needs afterwards.
   *
   * @param index - The index of the user message to truncate to.
   * @param reversionManager - Optional ReversionManager to handle file rollbacks.
   */
  public async truncateHistory(
    index: number,
    reversionManager?: import("./reversionManager.js").ReversionManager,
  ): Promise<void> {
    const { loadRewindCut } = await import("../services/session.js");
    const cut = await loadRewindCut(this.sessionId, this.workdir, index);

    if (index < 0 || index >= cut.threadMessageCount) {
      throw new Error(`Invalid message index: ${index}`);
    }

    if (reversionManager && cut.removed.length > 0) {
      await reversionManager.revertTo(cut.removed);
    }

    // Keep the first `index` messages on disk. Note the count is the message
    // position, not a file operation: the rewrite walks the file's own lines
    // and carries reserved entries (metadata header, custom-title) over.
    await this.rewriteSessionFile(index);
    // The rewrite drops messages but keeps the reserved entries where they sit,
    // which is not enough for the title: the session list reads only the file's
    // tail window, and a title written early can end up outside it (the
    // rewrite keeps the *first* messages, so the survivors after it are exactly
    // what pushes it away). Re-append it at EOF like the other flush points do.
    await this.reAppendSessionMetadata();
    // The scan already folded the surviving prefix at the last compact boundary,
    // matching what compact and resume put in memory.
    this.setMessages(cut.kept, { countLifetime: false });
    this.threadMessageCount = index;
    this.firstUserText = cut.firstUserText;
    // savedMessageCount tracks in-memory progress, so it must be the folded
    // length. Using the full disk count here would make saveSession's
    // slice(savedMessageCount) empty after a rewind past a compact boundary
    // and silently drop every subsequent message from the session file.
    this.savedMessageCount = this.messages.length;
  }

  /**
   * Drop everything past the first `keepMessageCount` messages from the
   * session file. The rewrite is a filter over the file's own lines, so the
   * metadata header, the user-set title and any other reserved entry survive.
   */
  private async rewriteSessionFile(keepMessageCount: number): Promise<void> {
    try {
      await truncateSession(
        this.sessionId,
        keepMessageCount,
        this.workdir,
        this.sessionType,
      );
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
          this.trimRecentFileReads();
        }
      }
    }
  }

  /**
   * Bound recentFileReads growth: evict oldest entries beyond the cache limit
   * and drop content from all but the most recent entries (paths are kept for
   * hasFileBeenRead). Prevents unbounded memory growth in long sessions.
   */
  private trimRecentFileReads(): void {
    if (this.recentFileReads.size > RECENT_FILE_READS_CACHE_LIMIT) {
      const sortedAsc = Array.from(this.recentFileReads.entries()).sort(
        ([, a], [, b]) => a.timestamp - b.timestamp,
      );
      const excess = this.recentFileReads.size - RECENT_FILE_READS_CACHE_LIMIT;
      for (const [path] of sortedAsc.slice(0, excess)) {
        this.recentFileReads.delete(path);
      }
    }

    if (this.recentFileReads.size > RECENT_FILE_READS_CONTENT_LIMIT) {
      const sortedDesc = Array.from(this.recentFileReads.entries()).sort(
        ([, a], [, b]) => b.timestamp - a.timestamp,
      );
      for (const [path, entry] of sortedDesc.slice(
        RECENT_FILE_READS_CONTENT_LIMIT,
      )) {
        this.recentFileReads.set(path, {
          content: "",
          timestamp: entry.timestamp,
        });
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
              // 模型当时实际看到的那份正文（已替换 ${WAVE_SKILL_DIR} 等占位符、
              // 首行带 `Base directory for this skill:`）——压缩后回灌直接复用它，
              // 不能重新读文件原文（spec core/message-compact 场景 4）。
              content: block.result,
            });
          }
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  /**
   * Get recently invoked skills, sorted by timestamp (newest first).
   * @param maxSkills - Maximum number of skills to return
   * @returns Invoked skill records sorted by recency
   */
  public getInvokedSkills(maxSkills = 10): InvokedSkillRecord[] {
    return Array.from(this.invokedSkills.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, maxSkills);
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

/** 最后一份同 id 副本的下标（-1 = 不在列表里）。 */
function lastIndexById(list: readonly Message[], id: string): number {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].id === id) return i;
  }
  return -1;
}
