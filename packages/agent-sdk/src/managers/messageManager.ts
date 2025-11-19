import { randomUUID } from "crypto";
import {
  addAssistantMessageToMessages,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addDiffBlockToMessage,
  addUserMessageToMessages,
  extractUserInputHistory,
  addMemoryBlockToMessage,
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
import type { Logger, Message, Usage } from "../types/index.js";
import {
  cleanupExpiredSessions,
  getLatestSession,
  loadSession,
  saveSession,
  SessionData,
  getSessionFilePath,
} from "../services/session.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";

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
  onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
  onDiffBlockAdded?: (filePath: string, diffResult: string) => void;
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
    messages: Message[],
    status: "active" | "completed" | "error" | "aborted",
  ) => void;
}

export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;

  // New: Optional session directory override
  /**
   * Custom session directory path
   * @default join(homedir(), ".wave", "sessions")
   */
  sessionDir?: string;
}

export class MessageManager {
  // Private state properties
  private sessionId: string;
  private messages: Message[];
  private latestTotalTokens: number;
  private userInputHistory: string[];
  private sessionStartTime: string;
  private workdir: string;
  private logger?: Logger; // Add optional logger property
  private callbacks: MessageManagerCallbacks;
  private sessionDir?: string; // Add session directory property

  constructor(options: MessageManagerOptions) {
    this.sessionId = randomUUID();
    this.messages = [];
    this.latestTotalTokens = 0;
    this.userInputHistory = [];
    this.sessionStartTime = new Date().toISOString();
    this.workdir = options.workdir;
    this.callbacks = options.callbacks;
    this.logger = options.logger;
    this.sessionDir = options.sessionDir;
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

  public getTranscriptPath(): string {
    return getSessionFilePath(this.sessionId, this.sessionDir);
  }

  // Setter methods, will trigger callbacks
  public setSessionId(sessionId: string): void {
    if (this.sessionId !== sessionId) {
      this.sessionId = sessionId;
      this.callbacks.onSessionIdChange?.(sessionId);
    }
  }

  public setMessages(messages: Message[]): void {
    this.messages = [...messages];
    this.callbacks.onMessagesChange?.([...messages]);
  }

  /**
   * Save current session
   */
  public async saveSession(): Promise<void> {
    try {
      await saveSession(
        this.sessionId,
        this.messages,
        this.workdir,
        this.latestTotalTokens,
        this.sessionStartTime,
        this.sessionDir,
      );
    } catch (error) {
      this.logger?.error("Failed to save session:", error);
    }
  }

  /**
   * Handle session restoration logic
   */
  public async handleSessionRestoration(
    restoreSessionId?: string,
    continueLastSession?: boolean,
  ): Promise<void> {
    // Clean up expired sessions first
    try {
      await cleanupExpiredSessions(this.workdir, this.sessionDir);
    } catch (error) {
      this.logger?.warn("Failed to cleanup expired sessions:", error);
    }

    if (!restoreSessionId && !continueLastSession) {
      return;
    }

    try {
      let sessionToRestore: SessionData | null = null;

      if (restoreSessionId) {
        sessionToRestore = await loadSession(restoreSessionId, this.sessionDir);
        if (!sessionToRestore) {
          console.error(`Session not found: ${restoreSessionId}`);
          process.exit(1);
        }
      } else if (continueLastSession) {
        sessionToRestore = await getLatestSession(
          this.workdir,
          this.sessionDir,
        );
        if (!sessionToRestore) {
          console.error(
            `No previous session found for workdir: ${this.workdir}`,
          );
          process.exit(1);
        }
      }

      if (sessionToRestore) {
        console.log(`Restoring session: ${sessionToRestore.id}`);

        // Initialize from session data
        this.initializeFromSession(
          sessionToRestore.id,
          sessionToRestore.messages,
          sessionToRestore.metadata.latestTotalTokens,
        );
      }
    } catch (error) {
      console.error("Failed to restore session:", error);
      process.exit(1);
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
    this.setSessionId(randomUUID());
    this.setlatestTotalTokens(0);
    this.sessionStartTime = new Date().toISOString();
  }

  // Initialize state from session data
  public initializeFromSession(
    sessionId: string,
    messages: Message[],
    latestTotalTokens: number,
  ): void {
    this.setSessionId(sessionId);
    this.setMessages([...messages]);
    this.setlatestTotalTokens(latestTotalTokens);

    // Extract user input history from session messages
    this.setUserInputHistory(extractUserInputHistory(messages));
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
  }

  public addAssistantMessage(
    content?: string,
    toolCalls?: ChatCompletionMessageFunctionToolCall[],
    usage?: Usage,
  ): void {
    const newMessages = addAssistantMessageToMessages(
      this.messages,
      content,
      toolCalls,
      usage,
    );
    this.setMessages(newMessages);
    this.callbacks.onAssistantMessageAdded?.();
  }

  public updateToolBlock(params: AgentToolBlockUpdateParams): void {
    const newMessages = updateToolBlockInMessage({
      messages: this.messages,
      id: params.id,
      parameters: params.parameters,
      result: params.result,
      success: params.success,
      error: params.error,
      isRunning: params.isRunning,
      name: params.name,
      shortResult: params.shortResult,
      images: params.images,
      compactParams: params.compactParams,
      parametersChunk: params.parametersChunk,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.(params);
  }

  /**
   * Update tool parameters in streaming mode
   * This method is optimized for real-time parameter updates during streaming
   */
  public updateToolParameters(params: {
    id: string;
    parameters: string;
    parametersChunk?: string;
    name?: string;
    compactParams?: string;
  }): void {
    const newMessages = updateToolBlockInMessage({
      messages: this.messages,
      id: params.id,
      parameters: params.parameters,
      parametersChunk: params.parametersChunk,
      name: params.name,
      compactParams: params.compactParams,
    });
    this.setMessages(newMessages);

    // Trigger callback with streaming parameter data including compactParams for view modes
    this.callbacks.onToolBlockUpdated?.({
      id: params.id,
      parameters: params.parameters,
      parametersChunk: params.parametersChunk,
      name: params.name,
      compactParams: params.compactParams,
    });
  }

  public addDiffBlock(
    filePath: string,
    diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
  ): void {
    const newMessages = addDiffBlockToMessage({
      messages: this.messages,
      path: filePath,
      diffResult,
    });
    this.setMessages(newMessages);
    this.callbacks.onDiffBlockAdded?.(filePath, JSON.stringify(diffResult));
  }

  public addErrorBlock(error: string): void {
    const newMessages = addErrorBlockToMessage({
      messages: this.messages,
      error,
    });
    this.setMessages(newMessages);
    this.callbacks.onErrorBlockAdded?.(error);
  }

  /**
   * Compress messages and update session, delete compressed messages, only keep compressed messages and subsequent messages
   */
  public compressMessagesAndUpdateSession(
    insertIndex: number,
    compressedContent: string,
  ): void {
    const currentMessages = this.messages;

    // Create compressed message
    const compressMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "compress",
          content: compressedContent,
        },
      ],
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
    this.setSessionId(randomUUID());

    // Set new message list
    this.setMessages(newMessages);

    // Trigger compression callback, insertIndex remains unchanged
    this.callbacks.onCompressBlockAdded?.(insertIndex, compressedContent);
  }

  public addMemoryBlock(
    content: string,
    success: boolean,
    type: "project" | "user",
    storagePath: string,
  ): void {
    const newMessages = addMemoryBlockToMessage({
      messages: this.messages,
      content,
      isSuccess: success,
      memoryType: type,
      storagePath,
    });
    this.setMessages(newMessages);
    this.callbacks.onMemoryBlockAdded?.(content, success, type, storagePath);
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
    status: "active" | "completed" | "error" = "active",
    subagentMessages: Message[] = [],
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    },
  ): void {
    const params: AddSubagentBlockParams = {
      messages: this.messages,
      subagentId,
      subagentName,
      status,
      subagentMessages,
    };
    const updatedMessages = addSubagentBlockToMessage(params);
    this.setMessages(updatedMessages);
    this.callbacks.onSubAgentBlockAdded?.(params.subagentId, parameters);
  }

  public updateSubagentBlock(
    subagentId: string,
    updates: Partial<{
      status: "active" | "completed" | "error" | "aborted";
      messages: Message[];
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
      subagentMessages: updates.messages || [],
    };
    this.callbacks.onSubAgentBlockUpdated?.(
      params.subagentId,
      params.messages,
      params.status,
    );
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
      lastMessage.blocks.unshift({
        type: "text",
        content: newAccumulatedContent,
      });
    }

    // FR-001: Trigger callbacks with chunk and accumulated content
    this.callbacks.onAssistantContentUpdated?.(chunk, newAccumulatedContent);
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
}
