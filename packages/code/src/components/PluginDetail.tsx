import React, { useReducer, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { usePluginManagerContext } from "../contexts/PluginManagerContext.js";

const SCOPES = [
  { id: "project", label: "Install for all collaborators (project scope)" },
  { id: "user", label: "Install for you (user scope)" },
  { id: "local", label: "Install for you, in this repo only (local scope)" },
] as const;

type PluginDetailState = {
  selectedScopeIndex: number;
  selectedActionIndex: number;
};

type PluginDetailAction =
  | { type: "NAVIGATE_UP"; maxScope: number; maxAction: number }
  | { type: "NAVIGATE_DOWN"; maxScope: number; maxAction: number }
  | { type: "RESET" };

function pluginDetailReducer(
  state: PluginDetailState,
  action: PluginDetailAction,
): PluginDetailState {
  switch (action.type) {
    case "NAVIGATE_UP":
      return {
        selectedScopeIndex:
          state.selectedScopeIndex > 0
            ? state.selectedScopeIndex - 1
            : action.maxScope,
        selectedActionIndex:
          state.selectedActionIndex > 0
            ? state.selectedActionIndex - 1
            : action.maxAction,
      };
    case "NAVIGATE_DOWN":
      return {
        selectedScopeIndex:
          state.selectedScopeIndex < action.maxScope
            ? state.selectedScopeIndex + 1
            : 0,
        selectedActionIndex:
          state.selectedActionIndex < action.maxAction
            ? state.selectedActionIndex + 1
            : 0,
      };
    case "RESET":
      return { selectedScopeIndex: 0, selectedActionIndex: 0 };
    default:
      return state;
  }
}

export const PluginDetail: React.FC = () => {
  const { state, discoverablePlugins, installedPlugins, actions } =
    usePluginManagerContext();
  const [navState, dispatch] = useReducer(pluginDetailReducer, {
    selectedScopeIndex: 0,
    selectedActionIndex: 0,
  });

  // Keep a ref for useInput callback to read current state during async
  const navStateRef = useRef(navState);
  useEffect(() => {
    navStateRef.current = navState;
  }, [navState]);

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
        type: "NAVIGATE_UP",
        maxScope: SCOPES.length - 1,
        maxAction: INSTALLED_ACTIONS.length - 1,
      });
    } else if (key.downArrow) {
      dispatch({
        type: "NAVIGATE_DOWN",
        maxScope: SCOPES.length - 1,
        maxAction: INSTALLED_ACTIONS.length - 1,
      });
    } else if (key.return && plugin && !state.isLoading) {
      const current = navStateRef.current;
      if (isInstalledAndEnabled) {
        const action = INSTALLED_ACTIONS[current.selectedActionIndex].id;
        if (action === "uninstall") {
          actions.uninstallPlugin(plugin.name, plugin.marketplace);
        } else {
          actions.updatePlugin(plugin.name, plugin.marketplace);
        }
      } else {
        actions.installPlugin(
          plugin.name,
          plugin.marketplace,
          SCOPES[current.selectedScopeIndex].id,
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
                  index === navState.selectedActionIndex
                    ? state.isLoading
                      ? "gray"
                      : "yellow"
                    : undefined
                }
              >
                {index === navState.selectedActionIndex ? "> " : "  "}
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
                  index === navState.selectedScopeIndex
                    ? state.isLoading
                      ? "gray"
                      : "green"
                    : undefined
                }
              >
                {index === navState.selectedScopeIndex ? "> " : "  "}
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
