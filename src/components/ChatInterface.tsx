import React from "react";
import { Box, useStdin } from "ink";
import { MessageList } from "./MessageList";
import { InputBox } from "./InputBox";
import { NonRawInput } from "./NonRawInput";
import { useChat } from "../contexts/useChat";
import { useAppConfig } from "../contexts/useAppConfig";

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
  } = useChat();
  const { workdir } = useAppConfig();
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
          workdir={workdir}
          clearMessages={clearMessages}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
          saveMemory={saveMemory}
          setInputInsertHandler={setInputInsertHandler}
        />
      ) : (
        <NonRawInput />
      )}
    </Box>
  );
};
