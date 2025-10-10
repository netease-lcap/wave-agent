import React from "react";
import { Box, useStdin } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { NonRawInput } from "./NonRawInput.js";
import { useChat } from "../contexts/useChat.js";

export const ChatInterface: React.FC = () => {
  const {
    messages,
    isLoading,
    isCommandRunning,
    userInputHistory,
    clearMessages,
    sendMessage,
    abortMessage,
    saveMemory,
    setInputInsertHandler,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    reconnectMcpServer,
  } = useChat();
  const { isRawModeSupported } = useStdin();

  // 检查环境变量是否禁用了 raw mode
  const isRawModeDisabled = process.env.DISABLE_RAW_MODE === "true";
  const shouldUseRawMode = isRawModeSupported && !isRawModeDisabled;

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {/* 只在 raw mode 下显示 MessageList */}
        {shouldUseRawMode && (
          <MessageList messages={messages} isLoading={isLoading} />
        )}
      </Box>

      {shouldUseRawMode ? (
        <InputBox
          isLoading={isLoading}
          isCommandRunning={isCommandRunning}
          userInputHistory={userInputHistory}
          clearMessages={clearMessages}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
          saveMemory={saveMemory}
          setInputInsertHandler={setInputInsertHandler}
          mcpServers={mcpServers}
          connectMcpServer={connectMcpServer}
          disconnectMcpServer={disconnectMcpServer}
          reconnectMcpServer={reconnectMcpServer}
        />
      ) : (
        <NonRawInput />
      )}
    </Box>
  );
};
