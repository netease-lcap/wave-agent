import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

export const MarketplaceDetail: React.FC = () => {
  const { state, marketplaces, actions } = usePluginManagerContext();
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);

  const marketplace = marketplaces.find((m) => m.name === state.selectedId);

  const ACTIONS = [
    {
      id: "toggle-auto-update",
      label: `${marketplace?.autoUpdate ? "Disable" : "Enable"} auto-update`,
    },
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
    } else if (key.return && marketplace && !state.isLoading) {
      const action = ACTIONS[selectedActionIndex].id;
      if (action === "toggle-auto-update") {
        actions.toggleAutoUpdate(marketplace.name, !marketplace.autoUpdate);
      } else if (action === "update") {
        actions.updateMarketplace(marketplace.name);
      } else {
        actions.removeMarketplace(marketplace.name);
      }
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
        {marketplace.declaredScope &&
          marketplace.declaredScope !== "builtin" && (
            <Text dimColor> ({marketplace.declaredScope} scope)</Text>
          )}
      </Box>

      <Box marginBottom={1}>
        <Text>Source: {JSON.stringify(marketplace.source)}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>
          Auto-update:{" "}
          <Text color={marketplace.autoUpdate ? "green" : "red"}>
            {marketplace.autoUpdate ? "Enabled" : "Disabled"}
          </Text>
        </Text>
      </Box>

      {marketplace.lastUpdated && (
        <Box marginBottom={1}>
          <Text>
            Last updated:{" "}
            <Text color="cyan">
              {new Date(marketplace.lastUpdated).toLocaleString()}
            </Text>
          </Text>
        </Box>
      )}

      {state.isLoading && (
        <Box marginBottom={1}>
          <Text color="yellow">⌛ Processing operation...</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Marketplace Actions:</Text>
        {ACTIONS.map((action, index) => (
          <Text
            key={action.id}
            color={
              index === selectedActionIndex
                ? state.isLoading
                  ? "gray"
                  : "yellow"
                : undefined
            }
          >
            {index === selectedActionIndex ? "> " : "  "}
            {action.label}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text dimColor>
            {state.isLoading
              ? "Please wait..."
              : "Use ↑/↓ to select, Enter to confirm"}
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    </Box>
  );
};
