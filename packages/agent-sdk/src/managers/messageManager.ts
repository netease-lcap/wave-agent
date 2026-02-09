import {
  addAssistantMessageToMessages,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addUserMessageToMessages,
  extractUserInputHistory,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
  addSubagentBlockToMessage,
  updateSubagentBlockInMessage,
  removeLastUserMessage,
  UserMessageParams,
  type AddSubagentBlockParams,
  type UpdateSubagentBlockParams,
  type AgentToolBlockUpdateParams,
} from "../utils/messageOperations.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { Logger, Message, Usage, SlashCommand } from "../types/index.js";
import { join } from "path";
import {
  appendMessages,
  createSession,
  generateSessionId,
  SessionData,
  SESSION_DIR,
} from "../services/session.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import { pathEncoder } from "../utils/pathEncoder.js";

export interface MessageManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUserInputHistoryChange?: (history: string[]) => void;
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
  onCompressBlockAdded?: (insertIndex: number, content: string) => void;
  onCompressionStateChange?: (isCompressing: boolean) => void;
  onMemoryBlockAdded?: (
    content: string,
    success: boolean,
    type: "project" | "user",
    storagePath: string,
  ) => void;
  // Bash command callback
  onAddCommandOutputMessage?: (command: string) => void;
  onUpdateCommandOutputMessage?: (command: string, output: string) => void;
  onCompleteCommandMessage?: (command: string, exitCode: number) => void;
  onSlashCommandsChange?: (commands: SlashCommand[]) => void;
  onInfoBlockAdded?: (content: string) => void;
  // Rewind callbacks
  onShowRewind?: () => void;
  // Subagent callbacks
  onSubAgentBlockAdded?: (
    subagentId: string,
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    },
  ) => void;
  onSubAgentBlockUpdated?: (
    subagentId: string,
    status: "active" | "completed" | "error" | "aborted",
  ) => void;
}

export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  sessionType?: "main" | "subagent";
  subagentType?: string;
}

export class MessageManager {
  // Private state properties
  private sessionId: string;
  private messages: Message[];
  private latestTotalTokens: number;
  private userInputHistory: string[];
  private workdir: string;
  private encodedWorkdir: string; // Cached encoded workdir
  private logger?: Logger; // Add optional logger property
  private callbacks: MessageManagerCallbacks;
  private transcriptPath: string; // Cached transcript path
  private savedMessageCount: number; // Track how many messages have been saved to prevent duplication
  private filesInContext: Set<string> = new Set(); // Track files mentioned in the conversation
  private sessionType: "main" | "subagent";
  private subagentType?: string;

  constructor(options: MessageManagerOptions) {
    this.sessionId = generateSessionId();
    this.messages = [];
    this.latestTotalTokens = 0;
    this.userInputHistory = [];
    this.workdir = options.workdir;
    this.encodedWorkdir = pathEncoder.encodeSync(this.workdir); // Cache encoded workdir
    this.callbacks = options.callbacks;
    this.logger = options.logger;
    this.savedMessageCount = 0; // Initialize saved message count tracker
    this.sessionType = options.sessionType || "main";
    this.subagentType = options.subagentType;

    // Compute and cache the transcript path
    this.transcriptPath = this.computeTranscriptPath();
  }

  // Getter methods
  public getSessionId(): string {
    return this.sessionId;
  }

  public getMessages(): Message[] {
    return [...this.messages];
  }

  public getlatestTotalTokens(): number {
    return this.latestTotalTokens;
  }

  public getUserInputHistory(): string[] {
    return [...this.userInputHistory];
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
      this.logger?.error("Failed to create session:", error);
    }
  }

  public setMessages(messages: Message[]): void {
    this.messages = [...messages];
    this.updateFilesInContext(messages);
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
      );

      // Update the saved message count
      this.savedMessageCount = this.messages.length;
    } catch (error) {
      this.logger?.error("Failed to save session:", error);
    }
  }

  public setlatestTotalTokens(latestTotalTokens: number): void {
    if (this.latestTotalTokens !== latestTotalTokens) {
      this.latestTotalTokens = latestTotalTokens;

      this.callbacks.onLatestTotalTokensChange?.(latestTotalTokens);
    }
  }

  public setUserInputHistory(userInputHistory: string[]): void {
    this.userInputHistory = [...userInputHistory];
    this.callbacks.onUserInputHistoryChange?.(this.userInputHistory);
  }

  /**
   * Clear messages and input history
   */
  public clearMessages(): void {
    this.setMessages([]);
    this.setUserInputHistory([]);
    this.setSessionId(generateSessionId());
    this.setlatestTotalTokens(0);
    this.savedMessageCount = 0; // Reset saved message count
  }

  /**
   * Trigger the rewind UI callback
   */
  public triggerShowRewind(): void {
    this.callbacks.onShowRewind?.();
  }

  /**
   * Trigger slash commands change callback
   */
  public triggerSlashCommandsChange(commands: SlashCommand[]): void {
    this.callbacks.onSlashCommandsChange?.(commands);
  }

  // Initialize state from session data
  public initializeFromSession(sessionData: SessionData): void {
    this.setSessionId(sessionData.id);
    this.setMessages([...sessionData.messages]);
    this.updateFilesInContext(sessionData.messages);
    this.setlatestTotalTokens(sessionData.metadata.latestTotalTokens);

    // Extract user input history from session messages
    this.setUserInputHistory(extractUserInputHistory(sessionData.messages));

    // Set saved message count to the number of loaded messages since they're already saved
    // This must be done after setSessionId which resets it to 0
    this.savedMessageCount = sessionData.messages.length;
  }

  // Add to input history
  public addToInputHistory(input: string): void {
    // Avoid adding duplicate inputs
    if (
      this.userInputHistory.length > 0 &&
      this.userInputHistory[this.userInputHistory.length - 1] === input
    ) {
      return;
    }
    // Limit history records, keep the latest 100
    this.setUserInputHistory([...this.userInputHistory, input].slice(-100));
  }

  // Clear input history
  public clearInputHistory(): void {
    this.setUserInputHistory([]);
  }

  // Encapsulated message operation functions
  public addUserMessage(params: UserMessageParams): void {
    const newMessages = addUserMessageToMessages({
      messages: this.messages,
      ...params,
    });
    this.setMessages(newMessages);
    this.callbacks.onUserMessageAdded?.(params);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
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
      id: params.id,
      parameters: params.parameters,
      result: params.result,
      success: params.success,
      error: params.error,
      stage: params.stage,
      name: params.name,
      shortResult: params.shortResult,
      images: params.images,
      compactParams: params.compactParams,
      parametersChunk: params.parametersChunk,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.(params);

    // Note: Subagent-specific callbacks are now handled by SubagentManager
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
   * Compress messages and update session, delete compressed messages, only keep compressed messages and subsequent messages
   */
  public compressMessagesAndUpdateSession(
    insertIndex: number,
    compressedContent: string,
    usage?: Usage,
  ): void {
    const currentMessages = this.messages;

    // Create compressed message
    const compressMessage: Message = {
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

    // Convert negative index to positive index
    const actualIndex =
      insertIndex < 0 ? currentMessages.length + insertIndex : insertIndex;

    // Build new message array: keep compressed message and all messages from actualIndex onwards
    const newMessages: Message[] = [
      compressMessage,
      ...currentMessages.slice(actualIndex),
    ];

    // Update sessionId
    this.setSessionId(generateSessionId());

    // Set new message list
    this.setMessages(newMessages);

    // Trigger compression callback, insertIndex remains unchanged
    this.callbacks.onCompressBlockAdded?.(insertIndex, compressedContent);
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
    }
  }

  // Bash command related message operations
  public addCommandOutputMessage(command: string): void {
    const updatedMessages = addCommandOutputMessage({
      messages: this.messages,
      command,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onAddCommandOutputMessage?.(command);
  }

  public updateCommandOutputMessage(command: string, output: string): void {
    const updatedMessages = updateCommandOutputInMessage({
      messages: this.messages,
      command,
      output,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onUpdateCommandOutputMessage?.(command, output);
  }

  public completeCommandMessage(command: string, exitCode: number): void {
    const updatedMessages = completeCommandInMessage({
      messages: this.messages,
      command,
      exitCode,
    });
    this.setMessages(updatedMessages);
    this.callbacks.onCompleteCommandMessage?.(command, exitCode);
  }

  // Subagent block methods
  public addSubagentBlock(
    subagentId: string,
    subagentName: string,
    sessionId: string,
    configuration: SubagentConfiguration,
    status: "active" | "completed" | "error" | "aborted" = "active",
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    },
    runInBackground?: boolean,
  ): void {
    const params: AddSubagentBlockParams = {
      messages: this.messages,
      subagentId,
      subagentName,
      sessionId,
      status,
      configuration,
      runInBackground,
    };
    const updatedMessages = addSubagentBlockToMessage(params);
    this.setMessages(updatedMessages);
    this.callbacks.onSubAgentBlockAdded?.(params.subagentId, parameters);
  }

  public updateSubagentBlock(
    subagentId: string,
    updates: Partial<{
      status: "active" | "completed" | "error" | "aborted";
      sessionId: string;
    }>,
  ): void {
    const updatedMessages = updateSubagentBlockInMessage(
      this.messages,
      subagentId,
      updates,
    );
    this.setMessages(updatedMessages);
    const params: UpdateSubagentBlockParams = {
      messages: this.messages,
      subagentId,
      status: updates.status || "active",
    };
    this.callbacks.onSubAgentBlockUpdated?.(params.subagentId, params.status);
  }

  /**
   * Trigger usage change callback with all usage data from assistant messages
   */
  public triggerUsageChange(): void {
    const usages: Usage[] = [];
    for (const message of this.messages) {
      if (message.role === "assistant" && message.usage) {
        usages.push(message.usage);
      }
    }
    this.callbacks.onUsagesChange?.(usages);
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
      };
    } else {
      // Add new text block if none exists
      lastMessage.blocks.push({
        type: "text",
        content: newAccumulatedContent,
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
      };
    } else {
      // Add new reasoning block if none exists
      lastMessage.blocks.push({
        type: "reasoning",
        content: newAccumulatedReasoning,
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
   * Remove the last user message from the conversation
   * Used for hook error handling when the user prompt needs to be erased
   */
  public removeLastUserMessage(): void {
    const newMessages = removeLastUserMessage(this.messages);
    this.setMessages(newMessages);
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
    if (index < 0 || index >= this.messages.length) {
      throw new Error(`Invalid message index: ${index}`);
    }

    // Identify messages to be removed
    const messagesToRemove = this.messages.slice(index);
    const messageIdsToRemove = messagesToRemove
      .map((m) => m.id as string)
      .filter((id) => !!id);

    // Revert file changes if manager is provided
    if (reversionManager && messageIdsToRemove.length > 0) {
      await reversionManager.revertTo(messageIdsToRemove, this.messages);
    }

    // Truncate messages in memory
    const newMessages = this.messages.slice(0, index);
    this.setMessages(newMessages);

    // Update persistence: rewrite the session file
    await this.rewriteSessionFile(newMessages);

    // Update saved message count
    this.savedMessageCount = newMessages.length;
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
      this.logger?.error("Failed to rewrite session file:", error);
    }
  }

  /**
   * Updates the set of files mentioned in the conversation.
   */
  private updateFilesInContext(messages: Message[]): void {
    this.filesInContext.clear();
    for (const message of messages) {
      for (const block of message.blocks) {
        if (block.type === "tool") {
          // Extract file paths from common tool parameters
          if (block.parameters) {
            try {
              const params = JSON.parse(block.parameters) as Record<
                string,
                unknown
              >;
              const paths = this.extractPathsFromParams(params);
              for (const p of paths) {
                this.filesInContext.add(p);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      }
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
