#!/usr/bin/env tsx

import React, { useState } from "react";
import { render, Box, Text } from "ink";
import { FileSelector, FileItem } from "../src/components/FileSelector";

type TestAppProps = Record<string, never>;

const TestApp: React.FC<TestAppProps> = () => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(true);

  // Mock files and directories
  const mockFiles: FileItem[] = [
    { path: "src", type: "directory" },
    { path: "src/components", type: "directory" },
    { path: "tests", type: "directory" },
    { path: "package.json", type: "file" },
    { path: "README.md", type: "file" },
    { path: "src/components/FileSelector.tsx", type: "file" },
    { path: "src/hooks/useFileSelector.ts", type: "file" },
    { path: "tsconfig.json", type: "file" },
  ];

  const handleSelect = (filePath: string) => {
    setSelectedFile(filePath);
    setShowSelector(false);
  };

  const handleCancel = () => {
    setShowSelector(false);
  };

  if (!showSelector) {
    return (
      <Box flexDirection="column">
        <Text color="green">✅ Test completed!</Text>
        {selectedFile ? (
          <Text>Selected: {selectedFile}</Text>
        ) : (
          <Text>Cancelled selection</Text>
        )}
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        🧪 Testing FileSelector with Directory Support
      </Text>
      <Text dimColor>
        This test shows files (📄) and directories (📁) with different icons
      </Text>
      <Text dimColor>
        Use ↑↓ to navigate, Enter to select, Escape to cancel
      </Text>

      <FileSelector
        files={mockFiles}
        searchQuery="test"
        onSelect={handleSelect}
        onCancel={handleCancel}
      />
    </Box>
  );
};

render(<TestApp />);
