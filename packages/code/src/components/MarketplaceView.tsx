import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

import { MarketplaceList } from "./MarketplaceList.js";

export const MarketplaceView: React.FC = () => {
  const { marketplaces, actions } = usePluginManagerContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(Math.min(marketplaces.length - 1, selectedIndex + 1));
    } else if (key.return) {
      const mk = marketplaces[selectedIndex];
      if (mk) {
        actions.setSelectedId(mk.name);
        actions.setView("MARKETPLACE_DETAIL");
      }
    } else if (input === "a") {
      actions.setView("ADD_MARKETPLACE");
    }
  });

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
