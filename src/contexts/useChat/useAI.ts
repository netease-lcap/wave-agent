import { useState, useRef, useCallback } from 'react';
import { randomUUID } from 'crypto';
import { callAgent, compressMessages } from '../../services/aiService';
import { FileTreeNode } from '../../types/common';
import {
  addAssistantMessageToMessages,
  addAnswerBlockToMessage,
  updateAnswerBlockInMessage,
  addToolBlockToMessage,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addCompressBlockToMessage,
} from '../../utils/messageOperations';
import { toolRegistry } from '../../plugins/tools';
import type { ToolContext } from '../../plugins/tools/types';
import { getRecentMessages } from '../../utils/getRecentMessages';
import { saveErrorLog } from '../../utils/errorLogger';
import type { Message, MessageBlock } from '../../types';
import { useFiles } from '../useFiles';
import { logger } from '../../utils/logger';

export interface UseAIReturn {
  sessionId: string;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sendAIMessage: (recursionDepth?: number) => Promise<void>;
  abortAIMessage: () => void;
  resetSession: () => void;
  totalTokens: number;
}

export const useAI = (): UseAIReturn => {
  const filesContext = useFiles();
  const { workdir, setFlatFiles } = filesContext;
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => randomUUID());
  const [isLoading, setIsLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const fileChanges = useRef<Array<{ type: string; path: string; success: boolean }>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolAbortControllerRef = useRef<AbortController | null>(null);

  const abortAIMessage = useCallback(() => {
    // 中断AI服务
    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
      } catch (error) {
        logger.error('Failed to abort AI service:', error);
      }
    }

    // 中断工具执行
    if (toolAbortControllerRef.current) {
      try {
        toolAbortControllerRef.current.abort();
      } catch (error) {
        logger.error('Failed to abort tool execution:', error);
      }
    }

    setIsLoading(false);
  }, [setIsLoading]);

  const resetSession = useCallback(() => {
    setSessionId(randomUUID());
    setTotalTokens(0);
    fileChanges.current = [];
  }, []);

  const sendAIMessage = useCallback(
    async (recursionDepth: number = 0): Promise<void> => {
      if (isLoading) {
        return;
      }

      // 创建新的AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      // 为工具执行创建单独的AbortController
      const toolAbortController = new AbortController();
      toolAbortControllerRef.current = toolAbortController;

      setIsLoading(true);

      // 添加助手消息
      setMessages((prev) => addAssistantMessageToMessages(prev));

      let hasToolOperations = false;

      // 获取当前最新的 messages 状态
      const currentMessages = await new Promise<Message[]>((resolve) => {
        setMessages((messages) => {
          resolve([...messages]);
          return messages;
        });
      });

      // 获取近期消息历史
      const recentMessages = getRecentMessages(currentMessages);

      try {
        // 添加答案块
        setMessages((prev) => addAnswerBlockToMessage(prev));

        const result = await callAgent({
          messages: recentMessages,
          sessionId,
          abortSignal: abortController.signal,
        });

        // 更新 token 统计 - 显示最新一次的token使用量
        if (result.usage) {
          setTotalTokens(result.usage.total_tokens);
          
          // 检查是否超过64k token限制
          if (result.usage.total_tokens > 64000) {
            logger.info('Token usage exceeded 64k, compressing messages...');
            
            // 获取当前最新的 messages 状态
            const latestMessages = await new Promise<Message[]>((resolve) => {
              setMessages((messages) => {
                resolve([...messages]);
                return messages;
              });
            });
            
            // 移除后六条消息进行压缩
            if (latestMessages.length > 6) {
              const messagesToCompress = latestMessages.slice(-7, -1); // 移除后六条（不包含当前正在处理的消息）
              const recentChatMessages = getRecentMessages(messagesToCompress);
              
              try {
                const compressedContent = await compressMessages({
                  messages: recentChatMessages,
                  abortSignal: abortController.signal,
                });
                
                // 计算插入位置（后六条之前）
                const insertIndex = latestMessages.length - 7;
                
                // 删除后六条消息并在该位置插入压缩块
                setMessages((prev) => {
                  const newMessages = [...prev];
                  // 移除后六条消息
                  newMessages.splice(-7, 6);
                  // 在指定位置插入压缩块
                  return addCompressBlockToMessage(newMessages, insertIndex, compressedContent, 6);
                });
                
                logger.info('Successfully compressed 6 messages');
              } catch (compressError) {
                logger.error('Failed to compress messages:', compressError);
              }
            }
          }
        }

        // 处理返回的内容
        if (result.content) {
          // 直接更新答案内容（非流式，一次性接收完整内容）
          setMessages((prev) => updateAnswerBlockInMessage(prev, result.content || ''));
        }

        // 处理返回的工具调用
        if (result.tool_calls) {
          for (const toolCall of result.tool_calls) {
            if (toolCall.type !== 'function') continue; // 跳过没有 function 的工具调用

            hasToolOperations = true;

            // 添加工具块
            setMessages((prev) =>
              addToolBlockToMessage(prev, { id: toolCall.id || '', name: toolCall.function?.name || '' }),
            );

            // 执行工具
            try {
              const toolArgs = JSON.parse(toolCall.function?.arguments || '{}');

              // 设置工具开始执行状态
              setMessages((prev) =>
                updateToolBlockInMessage(
                  prev,
                  toolCall.id || '',
                  JSON.stringify(toolArgs, null, 2),
                  undefined,
                  undefined,
                  undefined,
                  false, // isStreaming: false
                  true, // isRunning: true
                  toolCall.function?.name || '',
                  undefined,
                ),
              );

              try {
                // 获取最新的 flatFiles 状态
                const currentFlatFiles = await new Promise<FileTreeNode[]>((resolve) => {
                  setFlatFiles((flatFiles) => {
                    resolve([...flatFiles]);
                    return flatFiles;
                  });
                });

                // 创建工具执行上下文
                const context: ToolContext = {
                  flatFiles: currentFlatFiles,
                  abortSignal: toolAbortController.signal,
                  workdir,
                };

                // 执行工具
                const toolResult = await toolRegistry.execute(toolCall.function?.name || '', toolArgs, context);

                // 更新消息状态 - 工具执行完成
                setMessages((prev) =>
                  updateToolBlockInMessage(
                    prev,
                    toolCall.id || '',
                    JSON.stringify(toolArgs, null, 2),
                    toolResult.content || (toolResult.error ? `Error: ${toolResult.error}` : ''),
                    toolResult.success,
                    toolResult.error,
                    false, // isStreaming: false
                    false, // isRunning: false
                    toolCall.function?.name || '',
                    toolResult.shortResult,
                  ),
                );
              } catch (toolError) {
                const errorMessage = toolError instanceof Error ? toolError.message : String(toolError);

                setMessages((prev) =>
                  updateToolBlockInMessage(
                    prev,
                    toolCall.id || '',
                    JSON.stringify(toolArgs, null, 2),
                    `Tool execution failed: ${errorMessage}`,
                    false,
                    errorMessage,
                    false,
                    false,
                    toolCall.function?.name || '',
                    undefined,
                  ),
                );
              }
            } catch (parseError) {
              const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
              setMessages((prev) =>
                addErrorBlockToMessage(
                  prev,
                  `Failed to parse tool arguments for ${toolCall.function?.name}: ${errorMessage}`,
                ),
              );
            }
          }
        }

        // AI 服务调用结束，清除 abort controller
        abortControllerRef.current = null;

        // 工具执行完成后清理工具的AbortController
        if (toolAbortControllerRef.current) {
          toolAbortControllerRef.current = null;
        }

        // 检查是否有工具操作，如果有则自动发起下一次 AI 服务调用
        if (hasToolOperations) {
          // 检查全局中断标志和AbortController状态
          const isCurrentlyAborted = abortController.signal.aborted || toolAbortController.signal.aborted;

          if (isCurrentlyAborted) {
            return;
          }

          // 等一秒后再发起下一次 AI 服务调用，因为要等文件同步
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // 再次检查是否已被中断
          const isStillAborted = abortController.signal.aborted || toolAbortController.signal.aborted;

          if (isStillAborted) {
            return;
          }

          // 递归调用 AI 服务，递增的递归深度
          await sendAIMessage(recursionDepth + 1);
        }
      } catch (error) {
        // 检查是否是由于用户中断操作导致的错误
        const isAborted =
          abortController.signal.aborted ||
          toolAbortController.signal.aborted ||
          (error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted')));

        if (!isAborted) {
          setMessages((prev) =>
            addErrorBlockToMessage(prev, error instanceof Error ? error.message : 'Unknown error occurred'),
          );

          // 保存错误时发送给AI的参数到文件
          try {
            await saveErrorLog(error, sessionId, workdir, recentMessages, recursionDepth);
          } catch (saveError) {
            logger.error('Failed to save error log:', saveError);
          }
        }

        // 出错时也要重置 abort controller
        abortControllerRef.current = null;
        toolAbortControllerRef.current = null;

        // 如果是用户主动中断，直接返回，不继续递归
        if (isAborted) {
          return;
        }
      } finally {
        setIsLoading(false);
      }
    },
    [workdir, sessionId, isLoading, setIsLoading, setMessages, setFlatFiles],
  );

  return {
    sessionId,
    isLoading,
    setIsLoading,
    messages,
    setMessages,
    sendAIMessage,
    abortAIMessage,
    resetSession,
    totalTokens,
  };
};
