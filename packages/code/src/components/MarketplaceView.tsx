import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { KnownMarketplace } from "wave-agent-sdk";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

import { MarketplaceList } from "./MarketplaceList.js";

export const MarketplaceView: React.FC = () => {
  const { marketplaces, actions } = usePluginManagerContext();
  const [state, dispatch] = useReducer(selectorReducer<KnownMarketplace>, {
    selectedIndex: 0,
    pendingDecision: null,
    items: [],
  } as SelectorState<KnownMarketplace>);

  const { selectedIndex, pendingDecision, items } = state;

  // Sync marketplaces into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: marketplaces });
  }, [marketplaces]);

  useInput((input, key) => {
    if (input === "a") {
      actions.setView("ADD_MARKETPLACE");
      return;
    }

    dispatch({
      type: "HANDLE_KEY",
      key,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      const mk = items[selectedIndex];
      if (mk) {
        actions.setSelectedId(mk.name);
        actions.setView("MARKETPLACE_DETAIL");
      }
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, items, actions]);

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
