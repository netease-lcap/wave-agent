import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

export const MarketplaceDetail: React.FC = () => {
  const { state, marketplaces, actions } = usePluginManagerContext();
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);

  const marketplace = marketplaces.find((m) => m.name === state.selectedId);

  const ACTIONS = [
    { id: "update", label: "Update marketplace" },
    { id: "remove", label: "Remove marketplace" },
  ] as const;

  useInput((input, key) => {
    if (key.escape) {
      actions.setView("MARKETPLACES");
    } else if (key.upArrow) {
      setSelectedActionIndex((prev) =>
        prev > 0 ? prev - 1 : ACTIONS.length - 1,
      );
    } else if (key.downArrow) {
      setSelectedActionIndex((prev) =>
        prev < ACTIONS.length - 1 ? prev + 1 : 0,
      );
    } else if (key.return && marketplace) {
      const action = ACTIONS[selectedActionIndex].id;
      if (action === "update") {
        actions.updateMarketplace(marketplace.name);
      } else {
        actions.removeMarketplace(marketplace.name);
      }
      actions.setView("MARKETPLACES");
    }
  });

  if (!marketplace) {
    return (
      <Box>
        <Text color="red">Marketplace not found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {marketplace.name}
        </Text>
        {marketplace.isBuiltin && <Text dimColor> (Built-in)</Text>}
      </Box>

      <Box marginBottom={1}>
        <Text>Source: {JSON.stringify(marketplace.source)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text bold>Marketplace Actions:</Text>
        {ACTIONS.map((action, index) => (
          <Text
            key={action.id}
            color={index === selectedActionIndex ? "yellow" : undefined}
          >
            {index === selectedActionIndex ? "> " : "  "}
            {action.label}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text dimColor>Use ↑/↓ to select, Enter to confirm</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    </Box>
  );
};
