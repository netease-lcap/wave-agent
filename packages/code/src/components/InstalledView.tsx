import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { InstalledPlugin } from "wave-agent-sdk";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

type InstalledPluginWithEnabled = InstalledPlugin & { enabled: boolean };

export const InstalledView: React.FC = () => {
  const { installedPlugins, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(
    selectorReducer<InstalledPluginWithEnabled>,
    {
      selectedIndex: 0,
      pendingDecision: null,
      items: [],
    } as SelectorState<InstalledPluginWithEnabled>,
  );

  const { selectedIndex, pendingDecision, items } = state;

  // Sync plugins into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: installedPlugins });
  }, [installedPlugins]);

  useInput((_input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      const plugin = items[selectedIndex];
      if (plugin) {
        actions.setSelectedId(`${plugin.name}@${plugin.marketplace}`);
        actions.setView("PLUGIN_DETAIL");
      }
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, items, actions]);

  if (installedPlugins.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No plugins installed.</Text>
      </Box>
    );
  }

  const MAX_VISIBLE_ITEMS = 3;
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, installedPlugins.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const visiblePlugins = installedPlugins.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

  return (
    <Box flexDirection="column">
      {visiblePlugins.map((plugin, index) => {
        const isSelected = index + startIndex === selectedIndex;
        return (
          <Box
            key={`${plugin.name}@${plugin.marketplace}`}
            flexDirection="column"
            marginBottom={1}
          >
            <Box>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "> " : "  "}
                <Text bold>{plugin.name}</Text>
                <Text dimColor> @{plugin.marketplace}</Text>
                {plugin.scope && <Text color="gray"> ({plugin.scope})</Text>}
              </Text>
            </Box>
            {isSelected && (
              <Box marginLeft={4}>
                <Text dimColor>Press Enter for actions</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
