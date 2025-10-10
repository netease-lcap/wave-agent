import { randomUUID } from "crypto";
import {
  addAssistantMessageToMessages,
  addAnswerBlockToMessage,
  updateAnswerBlockInMessage,
  addToolBlockToMessage,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addCompressBlockToMessage,
  addDiffBlockToMessage,
  addUserMessageToMessages,
  extractUserInputHistory,
  addMemoryBlockToMessage,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
  type AIManagerToolBlockUpdateParams,
} from "../utils/messageOperations.js";
import type { Message } from "../types.js";

export interface MessageManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onTotalTokensChange?: (totalTokens: number) => void;
  // 增量回调
  onUserMessageAdded?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  onAssistantMessageAdded?: () => void;
  onAnswerBlockAdded?: () => void;
  onAnswerBlockUpdated?: (content: string) => void;
  onToolBlockAdded?: (tool: { id: string; name: string }) => void;
  onToolBlockUpdated?: (params: AIManagerToolBlockUpdateParams) => void;
  onDiffBlockAdded?: (filePath: string, diffResult: string) => void;
  onErrorBlockAdded?: (error: string) => void;
  onCompressBlockAdded?: (content: string) => void;
  onMemoryBlockAdded?: (
    content: string,
    success: boolean,
    type: "project" | "user",
  ) => void;
  // Bash 命令回调
  onAddCommandOutputMessage?: (command: string) => void;
  onUpdateCommandOutputMessage?: (command: string, output: string) => void;
  onCompleteCommandMessage?: (command: string, exitCode: number) => void;
}

export class MessageManager {
  // 私有状态属性
  private sessionId: string;
  private messages: Message[];
  private totalTokens: number;
  private userInputHistory: string[];
  private callbacks: MessageManagerCallbacks;

  constructor(callbacks: MessageManagerCallbacks) {
    this.sessionId = randomUUID();
    this.messages = [];
    this.totalTokens = 0;
    this.userInputHistory = [];
    this.callbacks = callbacks;
  }

  // Getter 方法
  public getSessionId(): string {
    return this.sessionId;
  }

  public getMessages(): Message[] {
    return [...this.messages];
  }

  public getTotalTokens(): number {
    return this.totalTokens;
  }

  public getUserInputHistory(): string[] {
    return [...this.userInputHistory];
  }

  // Setter 方法，会触发回调
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

  public setTotalTokens(totalTokens: number): void {
    if (this.totalTokens !== totalTokens) {
      this.totalTokens = totalTokens;
      this.callbacks.onTotalTokensChange?.(totalTokens);
    }
  }

  public setUserInputHistory(userInputHistory: string[]): void {
    this.userInputHistory = [...userInputHistory];
  }

  // 重置会话
  public resetSession(): void {
    this.setSessionId(randomUUID());
    this.setTotalTokens(0);
    this.setUserInputHistory([]);
  }

  // 清空消息和输入历史
  public clearMessages(): void {
    this.setMessages([]);
    this.setUserInputHistory([]);
    this.resetSession();
  }

  // 从会话数据初始化状态
  public initializeFromSession(
    sessionId: string,
    messages: Message[],
    totalTokens: number,
  ): void {
    this.setSessionId(sessionId);
    this.setMessages([...messages]);
    this.setTotalTokens(totalTokens);

    // Extract user input history from session messages
    this.setUserInputHistory(extractUserInputHistory(messages));
  }

  // 添加到输入历史记录
  public addToInputHistory(input: string): void {
    // 避免重复添加相同的输入
    if (
      this.userInputHistory.length > 0 &&
      this.userInputHistory[this.userInputHistory.length - 1] === input
    ) {
      return;
    }
    // 限制历史记录数量，保留最近的100条
    this.setUserInputHistory([...this.userInputHistory, input].slice(-100));
  }

  // 清空输入历史记录
  public clearInputHistory(): void {
    this.setUserInputHistory([]);
  }

  // 封装的消息操作函数
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

  public addAssistantMessage(): void {
    const newMessages = addAssistantMessageToMessages(this.messages);
    this.setMessages(newMessages);
    this.callbacks.onAssistantMessageAdded?.();
  }

  public addAnswerBlock(): void {
    const newMessages = addAnswerBlockToMessage(this.messages);
    this.setMessages(newMessages);
    this.callbacks.onAnswerBlockAdded?.();
  }

  public updateAnswerBlock(content: string): void {
    const newMessages = updateAnswerBlockInMessage({
      messages: this.messages,
      content,
    });
    this.setMessages(newMessages);
    this.callbacks.onAnswerBlockUpdated?.(content);
  }

  public addToolBlock(tool: { id: string; name: string }): void {
    const newMessages = addToolBlockToMessage({
      messages: this.messages,
      attributes: tool,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockAdded?.(tool);
  }

  public updateToolBlock(params: AIManagerToolBlockUpdateParams): void {
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
    originalContent: string,
    newContent: string,
  ): void {
    const newMessages = addDiffBlockToMessage({
      messages: this.messages,
      path: filePath,
      diffResult,
      original: originalContent,
      modified: newContent,
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

  public addCompressBlock(insertIndex: number, content: string): void {
    const newMessages = addCompressBlockToMessage({
      messages: this.messages,
      insertIndex,
      compressContent: content,
    });
    this.setMessages(newMessages);
    this.callbacks.onCompressBlockAdded?.(content);
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
    this.callbacks.onMemoryBlockAdded?.(content, success, type);
  }

  // Bash 命令相关的消息操作
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
