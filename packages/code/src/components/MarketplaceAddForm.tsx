import React, { useState, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

export const MarketplaceAddForm: React.FC = () => {
  const { state, actions } = usePluginManagerContext();
  const [source, setSource] = useState("");
  const sourceRef = useRef(source);

  // Keep ref in sync with state
  useEffect(() => {
    sourceRef.current = source;
  }, [source]);

  useInput((input, key) => {
    if (key.escape) {
      actions.setView("MARKETPLACES");
    } else if (state.isLoading) {
      return;
    } else if (key.return) {
      if (sourceRef.current.trim()) {
        actions.addMarketplace(sourceRef.current.trim());
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
        <Text color={state.isLoading ? "gray" : "yellow"}>{source}</Text>
        {!state.isLoading && <Text color="yellow">_</Text>}
      </Box>
      {state.isLoading && (
        <Box marginTop={1}>
          <Text color="yellow">⌛ Adding marketplace...</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {state.isLoading
            ? "Please wait..."
            : "Press Enter to add, Esc to cancel"}
        </Text>
      </Box>
    </Box>
  );
};
