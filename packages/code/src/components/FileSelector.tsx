import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { FileItem } from "wave-agent-sdk";

export { type FileItem } from "wave-agent-sdk";

export interface FileSelectorProps {
  files: FileItem[];
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
        borderColor="yellow"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Text color="yellow">📁 No files found for "{searchQuery}"</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  const maxDisplay = 10;

  // Calculate display window start and end positions
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
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text color="cyan" bold>
        📁 Select File/Directory{" "}
        {searchQuery && `(filtering: "${searchQuery}")`}
      </Text>

      {/* Show hint for more files above */}
      {startIndex > 0 && (
        <Text dimColor>... {startIndex} more files above</Text>
      )}

      {displayFiles.map((fileItem, displayIndex) => {
        const actualIndex = startIndex + displayIndex;
        const isSelected = actualIndex === selectedIndex;
        const icon = fileItem.type === "directory" ? "📁" : "📄";

        return (
          <Box key={fileItem.path}>
            <Text
              color={isSelected ? "black" : "white"}
              backgroundColor={isSelected ? "cyan" : undefined}
            >
              {"  "}
              {icon} {fileItem.path}
            </Text>
          </Box>
        );
      })}

      {/* Show hint for more files below */}
      {endIndex < files.length && (
        <Text dimColor>... {files.length - endIndex} more files below</Text>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Use ↑↓ to navigate, Enter/Tab to select, Escape to cancel
        </Text>
        <Text dimColor>
          , File {selectedIndex + 1} of {files.length}
        </Text>
      </Box>
    </Box>
  );
};
