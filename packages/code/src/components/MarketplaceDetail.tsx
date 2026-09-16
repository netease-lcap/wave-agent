import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

const ACTIONS = [
  // 先刷新该市场检出，再把该市场内所有可更新插件一次升掉（范围恒为当前市场，
  // spec 插件市场场景 13）
  { id: "update", label: "Update plugins (batch)" },
  { id: "remove", label: "Remove marketplace" },
] as const;

export const MarketplaceDetail: React.FC = () => {
  const { state, marketplaces, actions } = usePluginManagerContext();
  const [selectorState, dispatch] = useReducer(
    selectorReducer<{ id: string; label: string }>,
    {
      selectedIndex: 0,
      pendingDecision: null,
      items: [],
    } as SelectorState<{ id: string; label: string }>,
  );

  const {
    selectedIndex: selectedActionIndex,
    pendingDecision,
    items: actionsList,
  } = selectorState;

  const marketplace = marketplaces.find((m) => m.name === state.selectedId);

  // Sync ACTIONS into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: [...ACTIONS] });
  }, []);

  useInput((_input, key) => {
    if (state.isLoading && !key.escape) return;

    dispatch({
      type: "HANDLE_KEY",
      key,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select" && marketplace && !state.isLoading) {
      const action = actionsList[selectedActionIndex]?.id;
      if (action === "update") {
        actions.updateMarketplace(marketplace.name);
      } else if (action === "remove") {
        actions.removeMarketplace(marketplace.name);
      }
    } else if (pendingDecision === "cancel") {
      actions.setView("MARKETPLACES");
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [
    pendingDecision,
    selectedActionIndex,
    actionsList,
    marketplace,
    state.isLoading,
    actions,
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
