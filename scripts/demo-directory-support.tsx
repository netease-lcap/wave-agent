#!/usr/bin/env tsx

/**
 * Demo script to show the enhanced FileSelector with directory support
 * This script demonstrates how the FileSelector now supports both files and directories
 */

import React, { useState } from "react";
import { render, Box, Text } from "ink";
import { useFileSelector } from "../src/hooks/useFileSelector";

type DemoAppProps = Record<string, never>;

const DemoApp: React.FC<DemoAppProps> = () => {
  const [workdir] = useState(process.cwd());

  const {
    showFileSelector,
    filteredFiles,
    searchQuery,
    activateFileSelector,
    updateSearchQuery,
  } = useFileSelector(workdir);

  React.useEffect(() => {
    // Auto-start the demo
    activateFileSelector(0);

    // Update search query to show directory results
    setTimeout(() => {
      updateSearchQuery("src");
    }, 500);
  }, [activateFileSelector, updateSearchQuery]);

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        🚀 Enhanced FileSelector Demo - Directory Support
      </Text>
      <Text dimColor>
        The FileSelector now supports both files (📄) and directories (📁)!
      </Text>
      <Text dimColor>Directories are shown first, followed by files.</Text>

      {showFileSelector && (
        <Box marginTop={1}>
          <Text>Current search: "{searchQuery}"</Text>
          <Text>Found {filteredFiles.length} items</Text>

          {filteredFiles.map((item) => (
            <Box key={item.path}>
              <Text>
                {item.type === "directory" ? "📁" : "📄"} {item.path} (
                {item.type})
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};

render(<DemoApp />);
