import React from "react";
import { Box, Text, useStdin } from "ink";
import { MessageList } from "./MessageList";
import { InputBox } from "./InputBox";
import { NonRawInput } from "./NonRawInput";
import { useChat } from "../contexts/useChat";
import { useFiles } from "../contexts/useFiles";

export const ChatInterface: React.FC = () => {
  const { messages, isLoading, sessionId, totalTokens } = useChat();
  const { flatFiles } = useFiles();
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

      {shouldUseRawMode ? <InputBox /> : <NonRawInput />}

      {/* Session ID、文件数量和 Token 统计显示 */}
      <Box paddingX={1}>
        <Text color="gray" dimColor>
          Session ID: <Text color="blue">{sessionId}</Text>
          {" | "}
          Files: <Text color="yellow">{flatFiles.length}</Text>
          {" | "}
          Last Message Tokens:{" "}
          <Text color="green">{totalTokens.toLocaleString()}</Text>
        </Text>
      </Box>
    </Box>
  );
};
