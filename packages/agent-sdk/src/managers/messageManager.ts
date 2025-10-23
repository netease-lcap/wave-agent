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
  type AgentToolBlockUpdateParams,
} from "../utils/messageOperations.js";
import type { Logger, Message } from "../types.js";
import {
  cleanupExpiredSessions,
  getLatestSession,
  loadSession,
  saveSession,
  SessionData,
} from "../services/session.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";

export interface MessageManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onLatestTotalTokensChange?: (latestTotalTokens: number) => void;
  onUserInputHistoryChange?: (history: string[]) => void;
  // Incremental callback
  onUserMessageAdded?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  onAssistantMessageAdded?: (
    content?: string,
    toolCalls?: ChatCompletionMessageFunctionToolCall[],
  ) => void;
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
}

export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
}

export class MessageManager {
  // Private state properties
  private sessionId: string;
  private messages: Message[];
  private latestTotalTokens: number;
  private userInputHistory: string[];
  private sessionStartTime: string;
  private lastSaveTime: number = 0;
  private workdir: string;
  private logger?: Logger; // Add optional logger property
  private callbacks: MessageManagerCallbacks;

  constructor(options: MessageManagerOptions) {
    this.sessionId = randomUUID();
    this.messages = [];
    this.latestTotalTokens = 0;
    this.userInputHistory = [];
    this.sessionStartTime = new Date().toISOString();
    this.workdir = options.workdir;
    this.callbacks = options.callbacks;
    this.logger = options.logger;
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

    // Throttled save: only save if more than 30 seconds have passed since last save
    const now = Date.now();
    if (now - this.lastSaveTime > 30000) {
      this.lastSaveTime = now;
      // Asynchronously save session (non-blocking UI)
      this.saveSession().catch((error) => {
        this.logger?.error(
          "Failed to save session after message update:",
          error,
        );
      });
    }
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
      await cleanupExpiredSessions(this.workdir);
    } catch (error) {
      console.warn("Failed to cleanup expired sessions:", error);
    }

    if (!restoreSessionId && !continueLastSession) {
      return;
    }

    try {
      let sessionToRestore: SessionData | null = null;

      if (restoreSessionId) {
        sessionToRestore = await loadSession(restoreSessionId);
        if (!sessionToRestore) {
          console.error(`Session not found: ${restoreSessionId}`);
          process.exit(1);
        }
      } else if (continueLastSession) {
        sessionToRestore = await getLatestSession(this.workdir);
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
          sessionToRestore.state.messages,
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
  public addUserMessage(
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): void {
    const newMessages = addUserMessageToMessages({
      messages: this.messages,
      content,
      images,
    });
    this.setMessages(newMessages);
    this.callbacks.onUserMessageAdded?.(content, images);
  }

  public addCustomCommandMessage(
    commandName: string,
    content: string,
    originalInput?: string,
  ): void {
    const newMessages = addUserMessageToMessages({
      messages: this.messages,
      content: "", // Empty content, as we will use CustomCommandBlock
      customCommandBlock: {
        type: "custom_command",
        commandName,
        content,
        originalInput,
      },
    });
    this.setMessages(newMessages);
    this.callbacks.onUserMessageAdded?.(content);
  }

  public addAssistantMessage(
    content?: string,
    toolCalls?: ChatCompletionMessageFunctionToolCall[],
  ): void {
    const newMessages = addAssistantMessageToMessages(
      this.messages,
      content,
      toolCalls,
    );
    this.setMessages(newMessages);
    this.callbacks.onAssistantMessageAdded?.(content, toolCalls);
  }

  public updateToolBlock(params: AgentToolBlockUpdateParams): void {
    const newMessages = updateToolBlockInMessage({
      messages: this.messages,
      id: params.toolId,
      parameters: params.args || "",
      result: params.result,
      success: params.success,
      error: params.error,
      isRunning: params.isRunning,
      name: params.name,
      shortResult: params.shortResult,
      compactParams: params.compactParams,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.(params);
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
}
