import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { FileItem } from "wave-agent-sdk";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

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
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  } as SelectorState);

  const { selectedIndex, pendingDecision } = state;

  // Reset selected index when files change
  useEffect(() => {
    dispatch({ type: "RESET_INDEX" });
  }, [files]);

  // Handle decisions from reducer
  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select" || pendingDecision === "insert") {
      if (files.length > 0 && selectedIndex < files.length) {
        onSelect(files[selectedIndex].path);
      }
    } else if (pendingDecision === "cancel") {
      onCancel();
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [pendingDecision, selectedIndex, files, onSelect, onCancel]);

  useInput((input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: files.length - 1,
      hasInsert: true, // For FileSelector, Tab is also select
    });
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
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxDisplay / 2),
      Math.max(0, files.length - maxDisplay),
    ),
  );
  const endIndex = Math.min(files.length, startIndex + maxDisplay);
  const displayFiles = files.slice(startIndex, endIndex);

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
