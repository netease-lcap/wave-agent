import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export interface FileSelectorProps {
  files: Array<{ path: string }>;
  searchQuery: string;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
}

export const FileSelector: React.FC<FileSelectorProps> = ({ files, searchQuery, onSelect, onCancel }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return) {
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
      <Box flexDirection="column" borderStyle="single" borderColor="yellow" padding={1} marginBottom={1}>
        <Text color="yellow">📁 No files found for "{searchQuery}"</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  const maxDisplay = 10;
  const displayFiles = files.slice(0, maxDisplay);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" padding={1} marginBottom={1}>
      <Text color="cyan" bold>
        📁 Select File {searchQuery && `(filtering: "${searchQuery}")`}
      </Text>

      {displayFiles.map((file, index) => (
        <Box key={file.path}>
          <Text
            color={index === selectedIndex ? 'black' : 'white'}
            backgroundColor={index === selectedIndex ? 'cyan' : undefined}
          >
            {index === selectedIndex ? '▶ ' : '  '}
            {file.path}
          </Text>
        </Box>
      ))}

      {files.length > maxDisplay && <Text dimColor>... and {files.length - maxDisplay} more files</Text>}

      <Box marginTop={1}>
        <Text dimColor>Use ↑↓ to navigate, Enter to select, Escape to cancel</Text>
      </Box>
    </Box>
  );
};
