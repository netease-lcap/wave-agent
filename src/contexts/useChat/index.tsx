import React, { createContext, useContext, useCallback, useState } from 'react';
import { useFiles } from '../useFiles';
import type { Message } from '../../types';
import { addUserMessageToMessages } from '../../utils/messageOperations';
import { useAI } from './useAI';
import { useCommand } from './useCommand';
import { useInputHistory } from './useInputHistory';
import { useInputInsert } from './useInputInsert';

export interface ChatContextType {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  isLoading: boolean;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  clearMessages: () => void;
  executeCommand: (command: string) => Promise<number>;
  abortCommand: () => void;
  isCommandRunning: boolean;
  userInputHistory: string[];
  addToInputHistory: (input: string) => void;
  insertToInput: (text: string) => void;
  inputInsertHandler: ((text: string) => void) | null;
  setInputInsertHandler: (handler: (text: string) => void) => void;
  // Login form state
  showLoginForm: boolean;
  setShowLoginForm: (show: boolean) => void;
  // AI functionality
  sessionId: string;
  sendMessage: (content: string, images?: Array<{ path: string; mimeType: string }>) => Promise<void>;
  sendAIMessage: (recursionDepth?: number) => Promise<void>;
  abortAIMessage: () => void;
  abortMessage: () => void;
  resetSession: () => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within ChatProvider');
  }
  return context;
};

export interface ChatProviderProps {
  children: React.ReactNode;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({ children }) => {
  const { workdir } = useFiles();

  // Login form state
  const [showLoginForm, setShowLoginForm] = useState(false);

  // Use the AI hook
  const { sessionId, isLoading, setIsLoading, messages, setMessages, sendAIMessage, abortAIMessage, resetSession } =
    useAI();

  // Use the Command hook
  const { executeCommand, abortCommand, isCommandRunning } = useCommand(workdir, messages, setMessages);

  // Use the Input History hook
  const { userInputHistory, addToInputHistory, clearInputHistory } = useInputHistory();

  // Use the Input Insert hook
  const { insertToInput, inputInsertHandler, setInputInsertHandler } = useInputInsert();

  const clearMessages = useCallback(() => {
    setMessages([]);
    clearInputHistory(); // 也清空历史记录
    resetSession();
  }, [setMessages, clearInputHistory, resetSession]);

  // 统一的中断方法，同时中断AI消息和命令执行
  const abortMessage = useCallback(() => {
    abortAIMessage();
    abortCommand();
  }, [abortAIMessage, abortCommand]);

  const sendMessage = useCallback(
    async (content: string, images?: Array<{ path: string; mimeType: string }>) => {
      if (isLoading) {
        return;
      }

      // 添加到输入历史记录
      addToInputHistory(content);

      // Check if this is a command (starts with ! as the first character)
      if (content.startsWith('!')) {
        const command = content.substring(1).trim();
        if (command) {
          await executeCommand(command);
        }
        return;
      }

      // 添加用户消息
      setMessages((prev) => addUserMessageToMessages(prev, content, images));

      // 触发AI服务调用
      await sendAIMessage();
    },
    [isLoading, executeCommand, addToInputHistory, setMessages, sendAIMessage],
  );

  return (
    <ChatContext.Provider
      value={{
        messages,
        setMessages,
        isLoading,
        setIsLoading,
        clearMessages,
        executeCommand,
        abortCommand,
        isCommandRunning,
        userInputHistory,
        addToInputHistory,
        insertToInput,
        inputInsertHandler,
        setInputInsertHandler,
        // Login form state
        showLoginForm,
        setShowLoginForm,
        // AI functionality
        sessionId,
        sendMessage,
        sendAIMessage,
        abortAIMessage,
        abortMessage,
        resetSession,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
