import React, { useCallback, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { HistorySearch } from "./HistorySearch.js";
import { BackgroundTaskManager } from "./BackgroundTaskManager.js";
import { McpManager } from "./McpManager.js";
import { RewindCommand } from "./RewindCommand.js";
import { HelpView } from "./HelpView.js";
import { StatusCommand } from "./StatusCommand.js";
import { PluginManagerShell } from "./PluginManagerShell.js";
import { ModelSelector } from "./ModelSelector.js";
import { StatusLine } from "./StatusLine.js";
import { useChat } from "../contexts/useChat.js";
import { InputManagerCallbacks } from "../reducers/inputReducer.js";
import { PromptEntry } from "wave-agent-sdk";
import * as handlers from "../reducers/inputHandlers.js";

import type { McpServerStatus, SlashCommand } from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use /help for more info)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  workdir?: string;
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => void;
  abortMessage?: () => void;
  // MCP related properties
  mcpServers?: McpServerStatus[];
  connectMcpServer?: (serverName: string) => Promise<boolean>;
  disconnectMcpServer?: (serverName: string) => Promise<boolean>;
  // Slash Command related properties
  slashCommands?: SlashCommand[];
  hasSlashCommand?: (commandId: string) => boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  sendMessage = () => {},
  abortMessage = () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
}) => {
  const {
    setPermissionMode: setChatPermissionMode,
    handleRewindSelect,
    backgroundCurrentTask,
    messages,
    getFullMessageThread,
    sessionId,
    workingDirectory,
    inputState,
    inputDispatch,
    currentModel,
    configuredModels,
    setModel,
    askBtw,
  } = useChat();

  // Create callbacks object for handlers
  const callbacks: Partial<InputManagerCallbacks> = useMemo(
    () => ({
      onSendMessage: sendMessage,
      onAskBtw: askBtw,
      onHasSlashCommand: hasSlashCommand,
      onAbortMessage: abortMessage,
      onBackgroundCurrentTask: backgroundCurrentTask,
      onPermissionModeChange: (mode) => {
        inputDispatch({ type: "SET_PERMISSION_MODE", payload: mode });
        setChatPermissionMode(mode);
      },
      sessionId,
      workdir: workingDirectory,
      getFullMessageThread,
    }),
    [
      sendMessage,
      askBtw,
      hasSlashCommand,
      abortMessage,
      backgroundCurrentTask,
      inputDispatch,
      setChatPermissionMode,
      sessionId,
      workingDirectory,
      getFullMessageThread,
    ],
  );

  // Handler functions using inputDispatch
  const handleFileSelect = useCallback(
    (filePath: string) => {
      return handlers.handleFileSelect(
        inputState,
        inputDispatch,
        callbacks,
        filePath,
      );
    },
    [inputState, callbacks, inputDispatch],
  );

  const handleCancelFileSelect = useCallback(() => {
    inputDispatch({ type: "CANCEL_FILE_SELECTOR" });
  }, [inputDispatch]);

  const handleCommandSelect = useCallback(
    (command: string) => {
      return handlers.handleCommandSelect(
        inputState,
        inputDispatch,
        callbacks,
        command,
      );
    },
    [inputState, callbacks, inputDispatch],
  );

  const handleCommandInsert = useCallback(
    (command: string) => {
      if (inputState.slashPosition >= 0) {
        const wordEnd = handlers.getWordEnd(
          inputState.inputText,
          inputState.slashPosition,
        );
        const beforeSlash = inputState.inputText.substring(
          0,
          inputState.slashPosition,
        );
        const afterWord = inputState.inputText.substring(wordEnd);
        const newInput = beforeSlash + `/${command} ` + afterWord;
        const newCursorPosition = beforeSlash.length + command.length + 2;

        inputDispatch({ type: "SET_INPUT_TEXT", payload: newInput });
        inputDispatch({
          type: "SET_CURSOR_POSITION",
          payload: newCursorPosition,
        });
        inputDispatch({ type: "CANCEL_COMMAND_SELECTOR" });

        return { newInput, newCursorPosition };
      }
      return {
        newInput: inputState.inputText,
        newCursorPosition: inputState.cursorPosition,
      };
    },
    [inputState, inputDispatch],
  );

  const handleCancelCommandSelect = useCallback(() => {
    inputDispatch({ type: "CANCEL_COMMAND_SELECTOR" });
  }, [inputDispatch]);

  const handleHistorySearchSelect = useCallback(
    (entry: PromptEntry) => {
      inputDispatch({ type: "SELECT_HISTORY_ENTRY", payload: entry });
    },
    [inputDispatch],
  );

  const handleCancelHistorySearch = useCallback(() => {
    inputDispatch({ type: "CANCEL_HISTORY_SEARCH" });
  }, [inputDispatch]);

  const setShowBackgroundTaskManager = useCallback(
    (show: boolean) => {
      inputDispatch({
        type: "SET_SHOW_BACKGROUND_TASK_MANAGER",
        payload: show,
      });
    },
    [inputDispatch],
  );

  const setShowMcpManager = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_MCP_MANAGER", payload: show });
    },
    [inputDispatch],
  );

  const setShowRewindManager = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_REWIND_MANAGER", payload: show });
    },
    [inputDispatch],
  );

  const setShowHelp = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_HELP", payload: show });
    },
    [inputDispatch],
  );

  const setShowStatusCommand = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_STATUS_COMMAND", payload: show });
    },
    [inputDispatch],
  );

  const setShowPluginManager = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_PLUGIN_MANAGER", payload: show });
    },
    [inputDispatch],
  );

  const setShowModelSelector = useCallback(
    (show: boolean) => {
      inputDispatch({ type: "SET_SHOW_MODEL_SELECTOR", payload: show });
    },
    [inputDispatch],
  );

  // Main input handler
  useInput(async (input, key) => {
    await handlers.handleInput(
      inputState,
      inputDispatch,
      callbacks,
      input,
      key,
      () => inputDispatch({ type: "CLEAR_IMAGES" }),
    );
  });

  const handleRewindCancel = () => {
    setShowRewindManager(false);
  };

  const isPlaceholder = !inputState.inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  const isShellCommand =
    inputState.inputText?.startsWith("!") &&
    !inputState.inputText.includes("\n");

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputState.inputText;
  const beforeCursor = displayText.substring(0, inputState.cursorPosition);
  const atCursor =
    inputState.cursorPosition < displayText.length
      ? displayText[inputState.cursorPosition]
      : " ";
  const afterCursor = displayText.substring(inputState.cursorPosition + 1);

  // Always show cursor
  const shouldShowCursor = true;

  const handleRewindSelectWithClose = async (index: number) => {
    setShowRewindManager(false);
    await handleRewindSelect(index);
  };

  if (inputState.showRewindManager) {
    return (
      <RewindCommand
        messages={messages}
        onSelect={handleRewindSelectWithClose}
        onCancel={handleRewindCancel}
        getFullMessageThread={getFullMessageThread}
      />
    );
  }

  if (inputState.showHelp) {
    return (
      <HelpView onCancel={() => setShowHelp(false)} commands={slashCommands} />
    );
  }

  if (inputState.showStatusCommand) {
    return <StatusCommand onCancel={() => setShowStatusCommand(false)} />;
  }

  if (inputState.showPluginManager) {
    return <PluginManagerShell onCancel={() => setShowPluginManager(false)} />;
  }

  if (inputState.showModelSelector) {
    return (
      <ModelSelector
        onCancel={() => setShowModelSelector(false)}
        currentModel={currentModel}
        configuredModels={configuredModels}
        onSelectModel={setModel}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {inputState.showFileSelector && (
        <FileSelector
          files={inputState.filteredFiles}
          searchQuery={inputState.fileSearchQuery}
          isLoading={inputState.isFileSearching}
          onSelect={handleFileSelect}
          onCancel={handleCancelFileSelect}
        />
      )}

      {inputState.showCommandSelector && (
        <CommandSelector
          searchQuery={inputState.commandSearchQuery}
          onSelect={handleCommandSelect}
          onInsert={handleCommandInsert}
          onCancel={handleCancelCommandSelect}
          commands={slashCommands}
        />
      )}

      {inputState.showHistorySearch && (
        <HistorySearch
          searchQuery={inputState.historySearchQuery}
          onSelect={handleHistorySearchSelect}
          onCancel={handleCancelHistorySearch}
        />
      )}

      {inputState.showBackgroundTaskManager && (
        <BackgroundTaskManager
          onCancel={() => setShowBackgroundTaskManager(false)}
        />
      )}

      {inputState.showMcpManager && (
        <McpManager
          onCancel={() => setShowMcpManager(false)}
          servers={mcpServers}
          onConnectServer={connectMcpServer}
          onDisconnectServer={disconnectMcpServer}
        />
      )}

      {inputState.showBackgroundTaskManager ||
        inputState.showMcpManager ||
        inputState.showRewindManager ||
        inputState.showHelp ||
        inputState.showStatusCommand ||
        inputState.showPluginManager || (
          <Box flexDirection="column">
            <Box
              borderStyle="single"
              borderColor={inputState.btwState.isActive ? "cyan" : "gray"}
              borderLeft={false}
              borderRight={false}
            >
              <Text color={isPlaceholder ? "gray" : "white"}>
                {inputState.btwState.isActive && isPlaceholder ? (
                  <>
                    <Text backgroundColor="white" color="black">
                      {" "}
                    </Text>
                    <Text color="cyan">Type your side question...</Text>
                  </>
                ) : shouldShowCursor ? (
                  <>
                    {beforeCursor}
                    <Text backgroundColor="white" color="black">
                      {atCursor}
                    </Text>
                    {afterCursor}
                  </>
                ) : (
                  displayText
                )}
              </Text>
            </Box>
            <StatusLine
              permissionMode={inputState.permissionMode}
              isShellCommand={isShellCommand}
              isBtwActive={inputState.btwState.isActive}
            />
          </Box>
        )}
    </Box>
  );
};
