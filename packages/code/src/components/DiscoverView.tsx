import React, { useState } from "react";
import { Box, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import { PluginList } from "./PluginList.js";

export const DiscoverView: React.FC = () => {
  const { discoverablePlugins, actions } = usePluginManagerContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(
        Math.min(discoverablePlugins.length - 1, selectedIndex + 1),
      );
    } else if (key.return) {
      const plugin = discoverablePlugins[selectedIndex];
      if (plugin) {
        actions.setSelectedId(`${plugin.name}@${plugin.marketplace}`);
        actions.setView("PLUGIN_DETAIL");
      }
    }
  });

  return (
    <Box flexDirection="column">
      <PluginList plugins={discoverablePlugins} selectedIndex={selectedIndex} />
    </Box>
  );
};
