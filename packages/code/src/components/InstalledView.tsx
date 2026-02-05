import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

export const InstalledView: React.FC = () => {
  const { installedPlugins, actions } = usePluginManagerContext();
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    } else if (key.downArrow) {
      setSelectedIndex(
        Math.min(installedPlugins.length - 1, selectedIndex + 1),
      );
    } else if (key.return) {
      const plugin = installedPlugins[selectedIndex];
      if (plugin) {
        actions.setSelectedId(`${plugin.name}@${plugin.marketplace}`);
        actions.setView("PLUGIN_DETAIL");
      }
    }
  });

  if (installedPlugins.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No plugins installed.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {installedPlugins.map((plugin, index) => {
        const isSelected = index === selectedIndex;
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
