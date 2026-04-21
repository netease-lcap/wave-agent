import React, { useReducer } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";
import {
  pluginDetailReducer,
  type PluginDetailState,
} from "../reducers/pluginDetailReducer.js";

const SCOPES = [
  { id: "project", label: "Install for all collaborators (project scope)" },
  { id: "user", label: "Install for you (user scope)" },
  { id: "local", label: "Install for you, in this repo only (local scope)" },
] as const;

export const PluginDetail: React.FC = () => {
  const { state, discoverablePlugins, installedPlugins, actions } =
    usePluginManagerContext();
  const [detailState, dispatch] = useReducer(pluginDetailReducer, {
    selectedScopeIndex: 0,
    selectedActionIndex: 0,
  } as PluginDetailState);

  const plugin =
    discoverablePlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    ) ||
    installedPlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    );

  const INSTALLED_ACTIONS = [
    { id: "update", label: "Update plugin (reinstall)" },
    { id: "uninstall", label: "Uninstall plugin" },
  ] as const;

  const isInstalledAndEnabled = plugin && "enabled" in plugin && plugin.enabled;

  useInput((input, key) => {
    if (key.escape) {
      const isFromDiscover = discoverablePlugins.find(
        (p) => `${p.name}@${p.marketplace}` === state.selectedId,
      );
      actions.setView(isFromDiscover ? "DISCOVER" : "INSTALLED");
    } else if (key.upArrow) {
      dispatch({
        type: "MOVE_ACTION_UP",
        maxIndex: INSTALLED_ACTIONS.length - 1,
      });
      dispatch({ type: "MOVE_SCOPE_UP", maxIndex: SCOPES.length - 1 });
    } else if (key.downArrow) {
      dispatch({
        type: "MOVE_ACTION_DOWN",
        maxIndex: INSTALLED_ACTIONS.length - 1,
      });
      dispatch({ type: "MOVE_SCOPE_DOWN", maxIndex: SCOPES.length - 1 });
    } else if (key.return && plugin && !state.isLoading) {
      if (isInstalledAndEnabled) {
        const action = INSTALLED_ACTIONS[detailState.selectedActionIndex].id;
        if (action === "uninstall") {
          actions.uninstallPlugin(plugin.name, plugin.marketplace);
        } else {
          actions.updatePlugin(plugin.name, plugin.marketplace);
        }
      } else {
        actions.installPlugin(
          plugin.name,
          plugin.marketplace,
          SCOPES[detailState.selectedScopeIndex].id,
        );
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
      {state.isLoading && (
        <Box marginBottom={1}>
          <Text color="yellow">⌛ Processing operation...</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {isInstalledAndEnabled ? (
          <Box flexDirection="column">
            <Text bold>Plugin Actions:</Text>
            {INSTALLED_ACTIONS.map((action, index) => (
              <Text
                key={action.id}
                color={
                  index === detailState.selectedActionIndex
                    ? state.isLoading
                      ? "gray"
                      : "yellow"
                    : undefined
                }
              >
                {index === detailState.selectedActionIndex ? "> " : "  "}
                {action.label}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text dimColor>
                {state.isLoading
                  ? "Please wait..."
                  : "Use ↑/↓ to select, Enter to confirm"}
              </Text>
            </Box>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Text bold>Select Installation Scope:</Text>
            {SCOPES.map((scope, index) => (
              <Text
                key={scope.id}
                color={
                  index === detailState.selectedScopeIndex
                    ? state.isLoading
                      ? "gray"
                      : "green"
                    : undefined
                }
              >
                {index === detailState.selectedScopeIndex ? "> " : "  "}
                {scope.label}
              </Text>
            ))}
            <Box marginTop={1}>
              <Text dimColor>
                {state.isLoading
                  ? "Please wait..."
                  : "Use ↑/↓ to select, Enter to install"}
              </Text>
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
