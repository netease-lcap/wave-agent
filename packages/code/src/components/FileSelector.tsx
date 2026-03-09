import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { FileItem } from "wave-agent-sdk";

export { type FileItem } from "wave-agent-sdk";

export interface FileSelectorProps {
  files: FileItem[];
  searchQuery: string;
  isLoading?: boolean;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
}

export const FileSelector: React.FC<FileSelectorProps> = ({
  files,
  searchQuery,
  isLoading = false,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return || key.tab) {
      if (files.length > 0 && selectedIndex < files.length) {
        onSelect(files[selectedIndex].path);
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
        borderColor={isLoading ? "cyan" : "yellow"}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        {isLoading ? (
          <Text color="cyan" bold>
            Select File/Directory...
          </Text>
        ) : (
          <>
            <Text color="yellow">No files found for "{searchQuery}"</Text>
            <Text dimColor>Press Escape to cancel</Text>
          </>
        )}
      </Box>
    );
  }

  const maxDisplay = 5;

  // Calculate display window start and end positions
  const getDisplayWindow = () => {
    const startIndex = Math.max(
      0,
      Math.min(
        selectedIndex - Math.floor(maxDisplay / 2),
        Math.max(0, files.length - maxDisplay),
      ),
    );
    const endIndex = Math.min(files.length, startIndex + maxDisplay);

    return {
      startIndex,
      endIndex,
      displayFiles: files.slice(startIndex, endIndex),
    };
  };

  const { startIndex, displayFiles } = getDisplayWindow();

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      gap={1}
    >
      <Box>
        <Text color="cyan" bold>
          Select File/Directory {searchQuery && `(filtering: "${searchQuery}")`}
        </Text>
      </Box>

      <Box flexDirection="column">
        {displayFiles.map((fileItem, displayIndex) => {
          const actualIndex = startIndex + displayIndex;
          const isSelected = actualIndex === selectedIndex;

          return (
            <Box key={fileItem.path}>
              <Text
                color={isSelected ? "black" : "white"}
                backgroundColor={isSelected ? "cyan" : undefined}
              >
                {isSelected ? "▶ " : "  "}
                {fileItem.path}
              </Text>
            </Box>
          );
        })}
      </Box>

      <Box>
        <Text dimColor>↑↓ navigate • Enter/Tab select • Esc cancel</Text>
      </Box>
    </Box>
  );
};
