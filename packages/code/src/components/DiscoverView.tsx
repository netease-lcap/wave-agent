import React, { useReducer, useEffect } from "react";
import { Box, useInput } from "ink";
import type { MarketplacePluginEntry } from "wave-agent-sdk";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { PluginList } from "./PluginList.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

type DiscoverablePlugin = MarketplacePluginEntry & {
  marketplace: string;
  installed: boolean;
  version?: string;
};

export const DiscoverView: React.FC = () => {
  const { discoverablePlugins, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(selectorReducer<DiscoverablePlugin>, {
    selectedIndex: 0,
    pendingDecision: null,
    items: [],
  } as SelectorState<DiscoverablePlugin>);

  const { selectedIndex, pendingDecision, items } = state;

  // Sync plugins into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: discoverablePlugins });
  }, [discoverablePlugins]);

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

  return (
    <Box flexDirection="column">
      <PluginList plugins={discoverablePlugins} selectedIndex={selectedIndex} />
    </Box>
  );
};
