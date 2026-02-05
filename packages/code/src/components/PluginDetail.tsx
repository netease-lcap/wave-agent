import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

const SCOPES = [
  { id: "project", label: "Install for all collaborators (project scope)" },
  { id: "user", label: "Install for you (user scope)" },
  { id: "local", label: "Install for you, in this repo only (local scope)" },
] as const;

export const PluginDetail: React.FC = () => {
  const { state, discoverablePlugins, installedPlugins, actions } =
    usePluginManagerContext();
  const [selectedScopeIndex, setSelectedScopeIndex] = useState(0);
  const [selectedActionIndex, setSelectedActionIndex] = useState(0);

  const plugin =
    discoverablePlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    ) ||
    installedPlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    );

  const INSTALLED_ACTIONS = [
    { id: "uninstall", label: "Uninstall plugin" },
    { id: "update", label: "Update plugin (reinstall)" },
  ] as const;

  useInput((input, key) => {
    if (key.escape) {
      const isFromDiscover = discoverablePlugins.find(
        (p) => `${p.name}@${p.marketplace}` === state.selectedId,
      );
      actions.setView(isFromDiscover ? "DISCOVER" : "INSTALLED");
    } else if (key.upArrow) {
      if (
        (plugin && "installed" in plugin && plugin.installed) ||
        (plugin && "enabled" in plugin && plugin.enabled !== undefined)
      ) {
        setSelectedActionIndex((prev) =>
          prev > 0 ? prev - 1 : INSTALLED_ACTIONS.length - 1,
        );
      } else {
        setSelectedScopeIndex((prev) =>
          prev > 0 ? prev - 1 : SCOPES.length - 1,
        );
      }
    } else if (key.downArrow) {
      if (
        (plugin && "installed" in plugin && plugin.installed) ||
        (plugin && "enabled" in plugin && plugin.enabled !== undefined)
      ) {
        setSelectedActionIndex((prev) =>
          prev < INSTALLED_ACTIONS.length - 1 ? prev + 1 : 0,
        );
      } else {
        setSelectedScopeIndex((prev) =>
          prev < SCOPES.length - 1 ? prev + 1 : 0,
        );
      }
    } else if (key.return && plugin) {
      if (
        ("installed" in plugin && plugin.installed) ||
        ("enabled" in plugin && plugin.enabled !== undefined)
      ) {
        const action = INSTALLED_ACTIONS[selectedActionIndex].id;
        if (action === "uninstall") {
          actions.uninstallPlugin(plugin.name, plugin.marketplace);
        } else {
          actions.updatePlugin(plugin.name, plugin.marketplace);
        }
        actions.setView("INSTALLED");
      } else {
        actions.installPlugin(
          plugin.name,
          plugin.marketplace,
          SCOPES[selectedScopeIndex].id,
        );
        actions.setView("INSTALLED");
      }
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
        <Text>{"description" in plugin ? plugin.description : ""}</Text>
      </Box>

      {plugin.version && (
        <Box marginBottom={1}>
          <Text>
            Version: <Text color="blue">{plugin.version}</Text>
          </Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {("installed" in plugin && plugin.installed) ||
        ("enabled" in plugin && plugin.enabled !== undefined) ? (
          <Box flexDirection="column">
            <Text bold>Plugin Actions:</Text>
            {INSTALLED_ACTIONS.map((action, index) => (
              <Text
                key={action.id}
                color={index === selectedActionIndex ? "yellow" : undefined}
              >
                {index === selectedActionIndex ? "> " : "  "}
                {action.label}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text dimColor>Use ↑/↓ to select, Enter to confirm</Text>
            </Box>
          </Box>
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
