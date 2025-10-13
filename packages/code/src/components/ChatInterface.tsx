import React, { useRef, useEffect } from "react";
import { Box } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { useChat } from "../contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

export const ChatInterface: React.FC = () => {
  const {
    messages,
    isLoading,
    isCommandRunning,
    userInputHistory,
    sendMessage,
    abortMessage,
    saveMemory,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    reconnectMcpServer,
    isExpanded,
    latestTotalTokens,
    slashCommands,
    executeSlashCommand,
    hasSlashCommand,
  } = useChat();

  // 创建一个 ref 来存储 expanded 模式下的消息
  const expandedMessagesRef = useRef<Message[]>([]);

  useEffect(() => {
    // 仅仅在折叠时同步
    if (!isExpanded) {
      expandedMessagesRef.current = messages.map((message, index) => {
        // 如果是最后一个消息，深拷贝其 blocks
        if (index === messages.length - 1) {
          return {
            ...message,
            blocks: message.blocks.map((block) => ({ ...block })),
          };
        }
        return message;
      });
    }
  }, [isExpanded, messages]);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {isExpanded ? (
          // expanded 模式下使用 ref 中的消息，loading 和 tokens 写死为 false 和 0
          <MessageList
            messages={expandedMessagesRef.current}
            isLoading={false}
            isCommandRunning={false}
            latestTotalTokens={0}
            isExpanded={true}
          />
        ) : (
          // 正常模式下使用实时状态
          <MessageList
            messages={messages}
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            latestTotalTokens={latestTotalTokens}
            isExpanded={false}
          />
        )}
      </Box>

      {!isExpanded && (
        <InputBox
          isLoading={isLoading}
          isCommandRunning={isCommandRunning}
          userInputHistory={userInputHistory}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
          saveMemory={saveMemory}
          mcpServers={mcpServers}
          connectMcpServer={connectMcpServer}
          disconnectMcpServer={disconnectMcpServer}
          reconnectMcpServer={reconnectMcpServer}
          slashCommands={slashCommands}
          executeSlashCommand={executeSlashCommand}
          hasSlashCommand={hasSlashCommand}
        />
      )}
    </Box>
  );
};
