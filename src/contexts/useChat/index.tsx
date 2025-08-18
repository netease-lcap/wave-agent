import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  useEffect,
  useMemo,
} from "react";
import { useFiles } from "../useFiles";
import type { Message } from "../../types";
import type { SessionData } from "../../services/sessionManager";
import {
  addUserMessageToMessages,
  addMemoryBlockToMessage,
} from "../../utils/messageOperations";
import { useAI } from "./useAI";
import { useInputHistory } from "./useInputHistory";
import {
  createBashManager,
  type BashManager,
} from "../../services/bashManager";
import { useInputInsert } from "./useInputInsert";
import { createMemoryManager } from "../../services/memoryManager";

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
  // AI functionality
  sessionId: string;
  sendMessage: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => Promise<void>;
  sendAIMessage: (recursionDepth?: number) => Promise<void>;
  abortAIMessage: () => void;
  abortMessage: () => void;
  resetSession: () => void;
  totalTokens: number;
  // Memory functionality
  saveMemory: (message: string, type: "project" | "user") => Promise<void>;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return context;
};

export interface ChatProviderProps {
  children: React.ReactNode;
  sessionToRestore?: SessionData | null;
}

export const ChatProvider: React.FC<ChatProviderProps> = ({
  children,
  sessionToRestore,
}) => {
  const { workdir } = useFiles();

  // Use the Input History hook
  const { userInputHistory, addToInputHistory, clearInputHistory } =
    useInputHistory(sessionToRestore?.state.inputHistory);

  // Create stable callback to get current input history
  const getCurrentInputHistoryRef = useRef<() => string[]>(() => []);

  useEffect(() => {
    getCurrentInputHistoryRef.current = () => userInputHistory;
  }, [userInputHistory]);

  const getCurrentInputHistory = useCallback(() => {
    return getCurrentInputHistoryRef.current?.() || [];
  }, []);

  // Use the AI hook
  const {
    sessionId,
    isLoading,
    setIsLoading,
    messages,
    setMessages,
    sendAIMessage,
    abortAIMessage,
    resetSession,
    totalTokens,
  } = useAI(sessionToRestore, getCurrentInputHistory);

  // Create bash manager
  const bashManagerRef = useRef<BashManager | null>(null);

  // Initialize bash manager
  useEffect(() => {
    if (!bashManagerRef.current) {
      bashManagerRef.current = createBashManager({
        workdir,
        onMessagesUpdate: setMessages,
      });
    } else {
      // Update workdir when it changes
      bashManagerRef.current.updateWorkdir(workdir);
    }
  }, [workdir, setMessages]);

  // Command execution functions
  const executeCommand = useCallback(
    async (command: string): Promise<number> => {
      if (!bashManagerRef.current) {
        throw new Error("Bash manager not initialized");
      }
      return bashManagerRef.current.executeCommand(command);
    },
    [],
  );

  const abortCommand = useCallback(() => {
    if (bashManagerRef.current) {
      bashManagerRef.current.abortCommand();
    }
  }, []);

  const isCommandRunning =
    bashManagerRef.current?.getIsCommandRunning() ?? false;

  // Use the Memory hook
  const memoryManager = useMemo(() => createMemoryManager(workdir), [workdir]);

  // Use the Input Insert hook
  const { insertToInput, inputInsertHandler, setInputInsertHandler } =
    useInputInsert();

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

  // 记忆保存函数
  const saveMemory = useCallback(
    async (message: string, type: "project" | "user") => {
      try {
        if (type === "project") {
          await memoryManager.addMemory(message);
        } else {
          await memoryManager.addUserMemory(message);
        }

        // 添加成功的 MemoryBlock 到最后一个助手消息
        const memoryText = message.substring(1).trim();
        const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
        const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

        setMessages((prev) =>
          addMemoryBlockToMessage(
            prev,
            `${typeLabel}: ${memoryText}`,
            true,
            type,
            storagePath,
          ),
        );
      } catch (error) {
        // 添加失败的 MemoryBlock 到最后一个助手消息
        const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
        const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

        setMessages((prev) =>
          addMemoryBlockToMessage(
            prev,
            `${typeLabel}添加失败: ${error instanceof Error ? error.message : String(error)}`,
            false,
            type,
            storagePath,
          ),
        );
      }
    },
    [memoryManager, setMessages],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
    ) => {
      if (isLoading) {
        return;
      }

      // 添加到输入历史记录
      addToInputHistory(content);

      // Check if this is a memory message (starts with #)
      if (memoryManager.isMemoryMessage(content)) {
        try {
          await memoryManager.addMemory(content);
          // 添加 MemoryBlock 到最后一个助手消息
          setMessages((prev) =>
            addMemoryBlockToMessage(prev, content.substring(1).trim(), true),
          );
        } catch (error) {
          // 添加失败的 MemoryBlock 到最后一个助手消息
          setMessages((prev) =>
            addMemoryBlockToMessage(
              prev,
              `添加记忆失败: ${error instanceof Error ? error.message : String(error)}`,
              false,
            ),
          );
        }
        return;
      }

      // Check if this is a command (starts with ! as the first character)
      if (content.startsWith("!")) {
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
    [
      isLoading,
      executeCommand,
      addToInputHistory,
      setMessages,
      sendAIMessage,
      memoryManager,
    ],
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
        // AI functionality
        sessionId,
        sendMessage,
        sendAIMessage,
        abortAIMessage,
        abortMessage,
        resetSession,
        totalTokens,
        // Memory functionality
        saveMemory,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};
