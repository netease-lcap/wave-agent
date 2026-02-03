import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { PluginDetail, PluginStatus } from "wave-agent-sdk";

export interface InstalledPluginsViewProps {
  plugins: PluginDetail[];
  onToggle: (pluginId: string) => Promise<void>;
  onRemove: (pluginId: string) => Promise<void>;
  onUpdate: (pluginId: string) => Promise<void>;
  onShowDetail: (plugin: PluginDetail) => void;
}

export const InstalledPluginsView: React.FC<InstalledPluginsViewProps> = ({
  plugins,
  onToggle,
  onRemove,
  onUpdate,
  onShowDetail,
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
    if (input === "t" && plugins.length > 0) {
      onToggle(plugins[selectedIndex].id);
    }
    if (input === "r" && plugins.length > 0) {
      onRemove(plugins[selectedIndex].id);
    }
    if (
      input === "u" &&
      plugins.length > 0 &&
      plugins[selectedIndex].status === PluginStatus.UPDATE_AVAILABLE
    ) {
      onUpdate(plugins[selectedIndex].id);
    }
  });

  if (plugins.length === 0) {
    return (
      <Box paddingY={1}>
        <Text color="yellow">
          No plugins installed. Go to Marketplace to discover more!
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {plugins.map((plugin, index) => (
        <Box key={plugin.id} flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={index === selectedIndex ? "cyan" : undefined}>
              {index === selectedIndex ? "▶ " : "  "}
            </Text>
            <Text bold={index === selectedIndex}>{plugin.name}</Text>
            <Text dimColor> v{plugin.installedVersion || "?.?.?"}</Text>
            <Box marginLeft={2}>
              {plugin.status === PluginStatus.ENABLED ? (
                <Text color="green">[Enabled]</Text>
              ) : (
                <Text color="gray">[Disabled]</Text>
              )}
              {plugin.status === PluginStatus.UPDATE_AVAILABLE && (
                <Text color="yellow"> [Update Available]</Text>
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
                <Text color="cyan">[t] Toggle </Text>
                <Text color="red">[r] Remove </Text>
                {plugin.status === PluginStatus.UPDATE_AVAILABLE && (
                  <Text color="yellow">[u] Update </Text>
                )}
              </Box>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};
