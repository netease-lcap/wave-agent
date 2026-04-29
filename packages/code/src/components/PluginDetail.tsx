import React, { useReducer, useEffect, useMemo } from "react";
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
    pendingDecision: null,
  } as PluginDetailState);

  const { selectedScopeIndex, selectedActionIndex, pendingDecision } =
    detailState;

  const plugin =
    discoverablePlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    ) ||
    installedPlugins.find(
      (p) => `${p.name}@${p.marketplace}` === state.selectedId,
    );

  const INSTALLED_ACTIONS = useMemo(
    () =>
      [
        { id: "update", label: "Update plugin (reinstall)" },
        { id: "uninstall", label: "Uninstall plugin" },
      ] as const,
    [],
  );

  const isInstalledAndEnabled = plugin && "enabled" in plugin && plugin.enabled;

  useInput((_input, key) => {
    if (state.isLoading && !key.escape) return;

    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: isInstalledAndEnabled
        ? INSTALLED_ACTIONS.length - 1
        : SCOPES.length - 1,
    });
  });

  useEffect(() => {
    if (!pendingDecision) return;

    if (pendingDecision === "select" && plugin && !state.isLoading) {
      if (isInstalledAndEnabled) {
        const action = INSTALLED_ACTIONS[selectedActionIndex].id;
        if (action === "uninstall") {
          actions.uninstallPlugin(plugin.name, plugin.marketplace);
        } else {
          actions.updatePlugin(plugin.name, plugin.marketplace);
        }
      } else {
        actions.installPlugin(
          plugin.name,
          plugin.marketplace,
          SCOPES[selectedScopeIndex].id,
        );
      }
    } else if (pendingDecision === "cancel") {
      const isFromDiscover = discoverablePlugins.find(
        (p) => `${p.name}@${p.marketplace}` === state.selectedId,
      );
      actions.setView(isFromDiscover ? "DISCOVER" : "INSTALLED");
    }

    dispatch({ type: "CLEAR_DECISION" });
  }, [
    pendingDecision,
    selectedActionIndex,
    selectedScopeIndex,
    plugin,
    isInstalledAndEnabled,
    state.isLoading,
    discoverablePlugins,
    state.selectedId,
    actions,
    INSTALLED_ACTIONS,
  ]);

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
