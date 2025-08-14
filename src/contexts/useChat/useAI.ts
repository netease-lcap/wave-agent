import { useState, useRef, useCallback, useEffect } from "react";
import { AIManager, AIManagerCallbacks } from "../../services/aiManager";
import { useFiles } from "../useFiles";
import type { Message } from "../../types";
import type { SessionData } from "../../services/sessionManager";

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

export const useAI = (
  sessionToRestore?: SessionData | null,
  getCurrentInputHistory?: () => string[],
): UseAIReturn => {
  const filesContext = useFiles();
  const { workdir, setFlatFiles, fileManager } = filesContext;
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [totalTokens, setTotalTokens] = useState(0);
  const [sessionId, setSessionId] = useState("");

  const aiManagerRef = useRef<AIManager | null>(null);

  // Initialize AI manager
  useEffect(() => {
    // Only initialize if fileManager is available
    if (!fileManager) return;

    const callbacks: AIManagerCallbacks = {
      onMessagesChange: (newMessages) => {
        setMessages([...newMessages]);
      },
      onLoadingChange: (loading) => {
        setIsLoading(loading);
      },
      onFlatFilesChange: (updater) => {
        setFlatFiles(updater);
      },
      getCurrentInputHistory,
    };

    aiManagerRef.current = new AIManager(workdir, callbacks, fileManager);

    // Initialize from session or default state
    if (sessionToRestore) {
      // Restore from session data
      aiManagerRef.current.initializeFromSession(
        sessionToRestore.id,
        sessionToRestore.state.messages,
        sessionToRestore.metadata.totalTokens,
      );

      setSessionId(sessionToRestore.id);
      setMessages(sessionToRestore.state.messages);
      setTotalTokens(sessionToRestore.metadata.totalTokens);
      setIsLoading(false);
    } else {
      // Initialize with default state
      const state = aiManagerRef.current.getState();
      setSessionId(state.sessionId);
      setMessages(state.messages);
      setIsLoading(state.isLoading);
      setTotalTokens(state.totalTokens);
    }
  }, [
    workdir,
    setFlatFiles,
    fileManager,
    sessionToRestore,
    getCurrentInputHistory,
  ]);

  // Update totalTokens when AI manager state changes
  useEffect(() => {
    if (aiManagerRef.current) {
      const state = aiManagerRef.current.getState();
      setTotalTokens(state.totalTokens);
      setSessionId(state.sessionId);
    }
  }, [messages, isLoading]);

  const sendAIMessage = useCallback(
    async (recursionDepth?: number): Promise<void> => {
      if (aiManagerRef.current) {
        await aiManagerRef.current.sendAIMessage(recursionDepth);
      }
    },
    [],
  );

  const abortAIMessage = useCallback(() => {
    if (aiManagerRef.current) {
      aiManagerRef.current.abortAIMessage();
    }
  }, []);

  const resetSession = useCallback(() => {
    if (aiManagerRef.current) {
      aiManagerRef.current.resetSession();
      const state = aiManagerRef.current.getState();
      setSessionId(state.sessionId);
      setTotalTokens(state.totalTokens);
    }
  }, []);

  // Custom setMessages that updates the AI manager
  const setMessagesWrapper = useCallback(
    (messages: Message[] | ((prev: Message[]) => Message[])) => {
      if (aiManagerRef.current) {
        if (typeof messages === "function") {
          const currentState = aiManagerRef.current.getState();
          const newMessages = messages(currentState.messages);
          aiManagerRef.current.setMessages(newMessages);
        } else {
          aiManagerRef.current.setMessages(messages);
        }
      }
    },
    [],
  );

  // Custom setIsLoading that updates the AI manager
  const setIsLoadingWrapper = useCallback(
    (loading: boolean | ((prev: boolean) => boolean)) => {
      if (aiManagerRef.current) {
        if (typeof loading === "function") {
          const currentState = aiManagerRef.current.getState();
          const newLoading = loading(currentState.isLoading);
          aiManagerRef.current.setIsLoading(newLoading);
        } else {
          aiManagerRef.current.setIsLoading(loading);
        }
      }
    },
    [],
  );

  return {
    sessionId,
    isLoading,
    setIsLoading: setIsLoadingWrapper,
    messages,
    setMessages: setMessagesWrapper,
    sendAIMessage,
    abortAIMessage,
    resetSession,
    totalTokens,
  };
};
