import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { generateCommitMessage } from "../services/aiService";
import { logger } from "../utils/logger";
import { getGitDiff } from "../utils/gitUtils";

export interface Command {
  name: string;
  description: string;
}

const AVAILABLE_COMMANDS: Command[] = [
  {
    name: "git-commit",
    description: "Generate git commit message and create commit command",
  },
  {
    name: "bashes",
    description: "View and manage background bash shells",
  },
  {
    name: "mcp",
    description: "View and manage MCP servers",
  },
  {
    name: "clean",
    description: "Clear the chat session",
  },
];

export interface CommandSelectorProps {
  searchQuery: string;
  onSelect: (command: string) => void;
  onCancel: () => void;
  onCommandGenerated?: (command: string) => void;
}

export const CommandSelector: React.FC<CommandSelectorProps> = ({
  searchQuery,
  onSelect,
  onCancel,
  onCommandGenerated,
}) => {
  // serverUrl is now handled in aiService
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  // 过滤命令列表
  const filteredCommands = AVAILABLE_COMMANDS.filter(
    (command) =>
      !searchQuery ||
      command.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // 处理 git-commit 命令
  const handleGitCommit = async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    setError(null); // 清除之前的错误
    setWarning(null); // 清除之前的警告
    try {
      logger.debug("Starting git commit message generation");

      // 获取 git diff
      const diff = await getGitDiff();
      if (!diff.trim()) {
        logger.debug("No changes detected in git diff");
        setWarning("No changes detected. Please make some changes first.");
        return;
      }

      logger.debug("Git diff obtained, generating commit message");

      // 生成提交信息
      const commitMessage = await generateCommitMessage({
        diff,
      });

      logger.debug("Commit message generated:", commitMessage);

      // 验证提交信息是否有效
      if (!commitMessage || typeof commitMessage !== "string") {
        throw new Error(
          "Failed to generate commit message: received empty or invalid response",
        );
      }

      // 构建命令
      const command = `git add . && git commit -m "${commitMessage
        .replace(/"/g, '\\"')
        .replace(/`/g, "\\`")}"`;
      const commandWithPrefix = `!${command}`;

      logger.debug("Generated command:", commandWithPrefix);

      // 通过回调将命令放入输入框
      if (onCommandGenerated) {
        onCommandGenerated(commandWithPrefix);
      }

      onCancel(); // 关闭命令选择器
    } catch (error) {
      logger.error("Error generating git commit:", error);
      setError(
        error instanceof Error
          ? error.message
          : "Failed to generate git commit message",
      );
    } finally {
      setIsGenerating(false);
    }
  };

  useInput((input, key) => {
    if (isGenerating) return; // 生成中时不处理输入

    if (key.return) {
      if (
        filteredCommands.length > 0 &&
        selectedIndex < filteredCommands.length
      ) {
        const selectedCommand = filteredCommands[selectedIndex].name;
        if (selectedCommand === "git-commit") {
          handleGitCommit();
        } else {
          onSelect(selectedCommand);
        }
      }
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(
        Math.min(filteredCommands.length - 1, selectedIndex + 1),
      );
      return;
    }
  });

  if (filteredCommands.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        padding={1}
        marginBottom={1}
      >
        <Text color="yellow">No commands found for "{searchQuery}"</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="magenta"
      padding={1}
      gap={1}
      marginBottom={1}
    >
      <Box>
        <Text color="magenta" bold>
          Command Selector {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      {/* 错误显示 */}
      {error && (
        <Box>
          <Text color="red">❌ Error: {error}</Text>
        </Box>
      )}

      {/* 警告显示 */}
      {warning && (
        <Box>
          <Text color="yellow">⚠️ {warning}</Text>
        </Box>
      )}

      {filteredCommands.map((command, index) => (
        <Box key={command.name} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "magenta" : undefined}
          >
            {index === selectedIndex ? "▶ " : "  "}/{command.name}
            {command.name === "git-commit" &&
              isGenerating &&
              " (generating...)"}
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={4}>
              <Text color="gray" dimColor>
                {command.description}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
      </Box>
    </Box>
  );
};
