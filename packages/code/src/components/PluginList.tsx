import React from "react";
import { Box, Text } from "ink";
import { MarketplacePluginEntry } from "wave-agent-sdk";

interface PluginListProps {
  plugins: (MarketplacePluginEntry & {
    marketplace: string;
    installed: boolean;
    version?: string;
  })[];
  selectedIndex: number;
  onSelect?: (index: number) => void;
}

export const PluginList: React.FC<PluginListProps> = ({
  plugins,
  selectedIndex,
}) => {
  if (plugins.length === 0) {
    return (
      <Box padding={1}>
        <Text dimColor>No plugins found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {plugins.map((plugin, index) => {
        const isSelected = index === selectedIndex;
        const pluginId = `${plugin.name}@${plugin.marketplace}`;

        return (
          <Box key={pluginId} flexDirection="column" marginBottom={1}>
            <Box>
              <Text color={isSelected ? "cyan" : undefined}>
                {isSelected ? "> " : "  "}
                <Text bold>{plugin.name}</Text>
                <Text dimColor> @{plugin.marketplace}</Text>
                {plugin.version && <Text color="blue"> v{plugin.version}</Text>}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <Text dimColor>{plugin.description}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};
