import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

const SCOPES = [
  { id: "user", label: "Install for you (user scope)" },
  { id: "project", label: "Install for all collaborators (project scope)" },
  { id: "local", label: "Install for you, in this repo only (local scope)" },
] as const;

export const PluginDetail: React.FC = () => {
  const { state, discoverablePlugins, actions } = usePluginManagerContext();
  const [selectedScopeIndex, setSelectedScopeIndex] = useState(0);

  const plugin = discoverablePlugins.find(
    (p) => `${p.name}@${p.marketplace}` === state.selectedId,
  );

  useInput((input, key) => {
    if (key.escape) {
      actions.setView("DISCOVER");
    } else if (key.upArrow) {
      setSelectedScopeIndex((prev) =>
        prev > 0 ? prev - 1 : SCOPES.length - 1,
      );
    } else if (key.downArrow) {
      setSelectedScopeIndex((prev) =>
        prev < SCOPES.length - 1 ? prev + 1 : 0,
      );
    } else if (key.return && plugin && !plugin.installed) {
      actions.installPlugin(
        plugin.name,
        plugin.marketplace,
        SCOPES[selectedScopeIndex].id,
      );
    } else if (input === "u" && plugin && plugin.installed) {
      actions.uninstallPlugin(plugin.name, plugin.marketplace);
    }
  });

  if (!plugin) {
    return (
      <Box>
        <Text color="red">Plugin not found.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {plugin.name}
        </Text>
        <Text dimColor> @{plugin.marketplace}</Text>
      </Box>

      <Box marginBottom={1}>
        <Text>{plugin.description}</Text>
      </Box>

      {plugin.version && (
        <Box marginBottom={1}>
          <Text>
            Version: <Text color="blue">{plugin.version}</Text>
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {plugin.installed ? (
          <Text color="yellow">Press 'u' to Uninstall</Text>
        ) : (
          <Box flexDirection="column">
            <Text bold>Select Installation Scope:</Text>
            {SCOPES.map((scope, index) => (
              <Text
                key={scope.id}
                color={index === selectedScopeIndex ? "green" : undefined}
              >
                {index === selectedScopeIndex ? "> " : "  "}
                {scope.label}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text dimColor>Use ↑/↓ to select, Enter to install</Text>
            </Box>
          </Box>
        )}
        <Box marginTop={1}>
          <Text dimColor>Press Esc to go back</Text>
        </Box>
      </Box>
    </Box>
  );
};
