import React, { useReducer, useEffect, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { selectorReducer } from "../reducers/selectorReducer.js";

export const MarketplaceDetail: React.FC = () => {
  const { state, marketplaces, actions } = usePluginManagerContext();
  const [selectorState, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  });

  const { selectedIndex: selectedActionIndex, pendingDecision } = selectorState;

  const marketplace = marketplaces.find((m) => m.name === state.selectedId);

  const ACTIONS = useMemo(
    () =>
      [
        {
          id: "toggle-auto-update",
          label: `${marketplace?.autoUpdate ? "Disable" : "Enable"} auto-update`,
        },
        { id: "update", label: "Update marketplace" },
        { id: "remove", label: "Remove marketplace" },
      ] as const,
    [marketplace?.autoUpdate],
  );

  useInput((_input, key) => {
    if (state.isLoading && !key.escape) return;

    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: ACTIONS.length - 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select" && marketplace && !state.isLoading) {
      const action = ACTIONS[selectedActionIndex].id;
      if (action === "toggle-auto-update") {
        actions.toggleAutoUpdate(marketplace.name, !marketplace.autoUpdate);
      } else if (action === "update") {
        actions.updateMarketplace(marketplace.name);
      } else {
        actions.removeMarketplace(marketplace.name);
      }
    } else if (pendingDecision === "cancel") {
      actions.setView("MARKETPLACES");
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [
    pendingDecision,
    selectedActionIndex,
    marketplace,
    state.isLoading,
    actions,
    ACTIONS,
  ]);

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
