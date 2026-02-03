import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { PluginDetail, PluginStatus } from "wave-agent-sdk";

export interface MarketplaceViewProps {
  plugins: PluginDetail[];
  onInstall: (pluginAtMarketplace: string) => Promise<void>;
  onShowDetail: (plugin: PluginDetail) => void;
  loading?: boolean;
}

export const MarketplaceView: React.FC<MarketplaceViewProps> = ({
  plugins,
  onInstall,
  onShowDetail,
  loading,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(Math.max(0, selectedIndex - 1));
    }
    if (key.downArrow) {
      setSelectedIndex(Math.min(plugins.length - 1, selectedIndex + 1));
    }
    if (key.return && plugins.length > 0) {
      onShowDetail(plugins[selectedIndex]);
    }
    if (input === "i" && plugins.length > 0) {
      const plugin = plugins[selectedIndex];
      if (plugin.status === PluginStatus.AVAILABLE) {
        onInstall(`${plugin.name}@${plugin.marketplaceName}`);
      }
    }
  });

  if (loading) {
    return (
      <Box paddingY={1}>
        <Text color="yellow">Fetching marketplace plugins...</Text>
      </Box>
    );
  }

  if (plugins.length === 0) {
    return (
      <Box paddingY={1}>
        <Text color="yellow">No plugins found in registered marketplaces.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {plugins.map((plugin, index) => (
        <Box
          key={`${plugin.name}-${plugin.marketplaceName}`}
          flexDirection="column"
          marginBottom={1}
        >
          <Box>
            <Text color={index === selectedIndex ? "cyan" : undefined}>
              {index === selectedIndex ? "▶ " : "  "}
            </Text>
            <Text bold={index === selectedIndex}>{plugin.name}</Text>
            <Text dimColor> @{plugin.marketplaceName}</Text>
            <Box marginLeft={2}>
              {plugin.status === PluginStatus.INSTALLED ||
              plugin.status === PluginStatus.ENABLED ? (
                <Text color="green">[Installed]</Text>
              ) : (
                <Text color="blue">[Available]</Text>
              )}
            </Box>
          </Box>
          {index === selectedIndex && (
            <Box marginLeft={4} flexDirection="column">
              <Text dimColor italic>
                {plugin.description}
              </Text>
              <Box marginTop={1}>
                <Text color="gray">Actions: </Text>
                {plugin.status === PluginStatus.AVAILABLE ? (
                  <Text color="cyan">[i] Install </Text>
                ) : (
                  <Text color="gray">Already installed </Text>
                )}
              </Box>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};
