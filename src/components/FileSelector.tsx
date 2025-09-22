import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export interface FileSelectorProps {
  files: string[];
  searchQuery: string;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
}

export const FileSelector: React.FC<FileSelectorProps> = ({
  files,
  searchQuery,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      if (files.length > 0 && selectedIndex < files.length) {
        onSelect(files[selectedIndex]);
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
      setSelectedIndex(Math.min(files.length - 1, selectedIndex + 1));
      return;
    }
  });

  if (files.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        padding={1}
        marginBottom={1}
      >
        <Text color="yellow">📁 No files found for "{searchQuery}"</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  const maxDisplay = 10;

  // 计算显示窗口的开始和结束位置
  const getDisplayWindow = () => {
    const startIndex = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(maxDisplay / 2),
        files.length - maxDisplay,
      ),
    );
    const endIndex = Math.min(files.length, startIndex + maxDisplay);
    const adjustedStartIndex = Math.max(0, endIndex - maxDisplay);

    return {
      startIndex: adjustedStartIndex,
      endIndex: endIndex,
      displayFiles: files.slice(adjustedStartIndex, endIndex),
    };
  };

  const { startIndex, endIndex, displayFiles } = getDisplayWindow();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      padding={1}
      marginBottom={1}
    >
      <Text color="cyan" bold>
        📁 Select File {searchQuery && `(filtering: "${searchQuery}")`}
      </Text>

      {/* 显示上方还有更多文件的提示 */}
      {startIndex > 0 && (
        <Text dimColor>... {startIndex} more files above</Text>
      )}

      {displayFiles.map((filePath, displayIndex) => {
        const actualIndex = startIndex + displayIndex;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={filePath}>
            <Text
              color={isSelected ? "black" : "white"}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {isSelected ? "▶ " : "  "}
              {filePath}
            </Text>
          </Box>
        );
      })}

      {/* 显示下方还有更多文件的提示 */}
      {endIndex < files.length && (
        <Text dimColor>... {files.length - endIndex} more files below</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Use ↑↓ to navigate, Enter to select, Escape to cancel
        </Text>
        <Text dimColor>
          File {selectedIndex + 1} of {files.length}
        </Text>
      </Box>
    </Box>
  );
};
