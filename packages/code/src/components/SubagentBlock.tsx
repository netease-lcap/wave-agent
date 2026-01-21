import React from "react";
import { Box, Text } from "ink";
import type {
  SubagentBlock as SubagentBlockType,
  ToolBlock,
} from "wave-agent-sdk";
import {
  WRITE_TOOL_NAME,
  EDIT_TOOL_NAME,
  MULTI_EDIT_TOOL_NAME,
} from "wave-agent-sdk";
import { useChat } from "../contexts/useChat.js";
import { PlanDisplay } from "./PlanDisplay.js";
import { DiffDisplay } from "./DiffDisplay.js";

interface SubagentBlockProps {
  block: SubagentBlockType;
  isExpanded?: boolean;
}

export const SubagentBlock: React.FC<SubagentBlockProps> = ({
  block,
  isExpanded = false,
}) => {
  const { subagentMessages } = useChat();

  // Get messages for this subagent from context
  const messages = subagentMessages[block.subagentId] || [];

  // Status indicator mapping
  const getStatusIndicator = (status: SubagentBlockType["status"]) => {
    switch (status) {
      case "active":
        return { icon: "🔄", color: "yellow" as const };
      case "completed":
        return { icon: "✅", color: "green" as const };
      case "error":
        return { icon: "❌", color: "red" as const };
      case "aborted":
        return { icon: "⏹️", color: "gray" as const };
      default:
        return { icon: "⏳", color: "gray" as const };
    }
  };

  const statusInfo = getStatusIndicator(block.status);

  // Find the last 2 tool names and their compact params, and count total tools
  const getLastTwoTools = (): {
    tools: Array<{ name: string; compactParams?: string }>;
    totalToolCount: number;
  } => {
    const tools: Array<{ name: string; compactParams?: string }> = [];
    let totalToolCount = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      for (let j = message.blocks.length - 1; j >= 0; j--) {
        const messageBlock = message.blocks[j];
        if (messageBlock.type === "tool" && messageBlock.name) {
          totalToolCount++;
          if (tools.length < 2) {
            tools.push({
              name: messageBlock.name,
              compactParams: messageBlock.compactParams,
            });
          }
        }
      }
    }
    return { tools: tools.reverse(), totalToolCount }; // Reverse to show oldest first, newest last
  };

  const { tools: lastTwoTools, totalToolCount } = getLastTwoTools();

  // Find the latest planContent in subagent messages
  const getLatestPlanContent = (): string | undefined => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      for (let j = message.blocks.length - 1; j >= 0; j--) {
        const messageBlock = message.blocks[j];
        if (
          messageBlock.type === "tool" &&
          (messageBlock as ToolBlock).planContent
        ) {
          return (messageBlock as ToolBlock).planContent;
        }
      }
    }
    return undefined;
  };

  const planContent = getLatestPlanContent();

  // Find the latest tool block that has a diff
  const getLatestDiffToolBlock = (): ToolBlock | undefined => {
    const diffToolNames = [
      WRITE_TOOL_NAME,
      EDIT_TOOL_NAME,
      MULTI_EDIT_TOOL_NAME,
    ];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      for (let j = message.blocks.length - 1; j >= 0; j--) {
        const messageBlock = message.blocks[j];
        if (
          messageBlock.type === "tool" &&
          messageBlock.name &&
          diffToolNames.includes(messageBlock.name)
        ) {
          return messageBlock as ToolBlock;
        }
      }
    }
    return undefined;
  };

  const diffToolBlock = getLatestDiffToolBlock();

  return (
    <Box
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderStyle="classic"
      borderColor="magenta"
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginBottom={1}
    >
      {/* Header Section */}
      <Box flexDirection="row" gap={1}>
        <Box flexDirection="row" alignItems="center">
          <Text color="cyan">🤖 {block.subagentName}</Text>
          <Text color={statusInfo.color} dimColor={false}>
            {" "}
            {statusInfo.icon}
          </Text>
          <Text color="gray" dimColor>
            {" "}
            ({messages.length} messages)
          </Text>
        </Box>
      </Box>

      {/* Tool Names Section - Vertical List */}
      {lastTwoTools.length > 0 && (
        <Box flexDirection="column" marginTop={1} gap={1}>
          {totalToolCount > 2 && (
            <Text color="gray" dimColor>
              ...
            </Text>
          )}
          {lastTwoTools.map((tool, index) => (
            <Box key={index} flexDirection="row">
              <Text color="magenta">🔧 </Text>
              <Text color="white">{tool.name}</Text>
              {tool.compactParams && (
                <Text color="gray"> {tool.compactParams}</Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Plan content display - handled by PlanDisplay component */}
      <PlanDisplay planContent={planContent} isExpanded={isExpanded} />

      {/* Diff display - handled by DiffDisplay component */}
      {diffToolBlock && <DiffDisplay toolBlock={diffToolBlock} />}
    </Box>
  );
};
