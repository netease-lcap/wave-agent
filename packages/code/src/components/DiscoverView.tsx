import React, { useReducer, useEffect } from "react";
import { Box, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { PluginList } from "./PluginList.js";
import { selectorReducer } from "../reducers/selectorReducer.js";

export const DiscoverView: React.FC = () => {
  const { discoverablePlugins, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  useInput((_input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: discoverablePlugins.length - 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      const plugin = discoverablePlugins[selectedIndex];
      if (plugin) {
        actions.setSelectedId(`${plugin.name}@${plugin.marketplace}`);
        actions.setView("PLUGIN_DETAIL");
      }
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, discoverablePlugins, actions]);

  return (
    <Box flexDirection="column">
      <PluginList plugins={discoverablePlugins} selectedIndex={selectedIndex} />
    </Box>
  );
};
