import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

export const MarketplaceAddForm: React.FC = () => {
  const { actions } = usePluginManagerContext();
  const [source, setSource] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      actions.setView("MARKETPLACES");
    } else if (key.return) {
      if (source.trim()) {
        actions.addMarketplace(source.trim());
        actions.setView("MARKETPLACES");
      }
    } else if (key.backspace || key.delete) {
      setSource((prev) => prev.slice(0, -1));
    } else if (input.length === 1) {
      setSource((prev) => prev + input);
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        Add Marketplace
      </Text>
      <Box marginTop={1}>
        <Text>Source (URL or Path): </Text>
        <Text color="yellow">{source}</Text>
        <Text color="yellow">_</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to add, Esc to cancel</Text>
      </Box>
    </Box>
  );
};
