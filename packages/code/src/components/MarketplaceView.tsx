import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { selectorReducer } from "../reducers/selectorReducer.js";

import { MarketplaceList } from "./MarketplaceList.js";

export const MarketplaceView: React.FC = () => {
  const { marketplaces, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  useInput((input, key) => {
    if (input === "a") {
      actions.setView("ADD_MARKETPLACE");
      return;
    }

    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: marketplaces.length - 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      const mk = marketplaces[selectedIndex];
      if (mk) {
        actions.setSelectedId(mk.name);
        actions.setView("MARKETPLACE_DETAIL");
      }
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, marketplaces, actions]);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="green">Press 'a' to add a new marketplace</Text>
      </Box>
      <MarketplaceList
        marketplaces={marketplaces}
        selectedIndex={selectedIndex}
      />
      {marketplaces.length > 0 && (
        <Box marginLeft={4} marginTop={1}>
          <Text dimColor>Press Enter for actions</Text>
        </Box>
      )}
    </Box>
  );
};
