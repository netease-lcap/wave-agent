import React, { useReducer } from "react";
import { Box, Text, useInput } from "ink";
import { McpServerStatus } from "wave-agent-sdk";
import {
  mcpManagerReducer,
  type McpManagerState,
} from "../reducers/mcpManagerReducer.js";

export interface McpManagerProps {
  onCancel: () => void;
  servers: McpServerStatus[];
  onConnectServer: (serverName: string) => Promise<boolean>;
  onDisconnectServer: (serverName: string) => Promise<boolean>;
}

const initialState: McpManagerState = {
  selectedIndex: 0,
  viewMode: "list",
};

export const McpManager: React.FC<McpManagerProps> = ({
  onCancel,
  servers,
  onConnectServer,
  onDisconnectServer,
}) => {
  const [state, dispatch] = useReducer(mcpManagerReducer, initialState);

  // Dynamically calculate selectedServer based on selectedIndex and servers
  const selectedServer =
    state.viewMode === "detail" &&
    servers.length > 0 &&
    state.selectedIndex < servers.length
      ? servers[state.selectedIndex]
      : null;

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "connected":
        return "green";
      case "connecting":
        return "yellow";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status) {
      case "connected":
        return "✓";
      case "connecting":
        return "⟳";
      case "error":
        return "✗";
      default:
        return "○";
    }
  };

  const handleConnect = async (serverName: string) => {
    await onConnectServer(serverName);
  };

  const handleDisconnect = async (serverName: string) => {
    await onDisconnectServer(serverName);
  };

  useInput((input, key) => {
    if (key.return) {
      if (state.viewMode === "list") {
        dispatch({ type: "SET_VIEW_MODE", viewMode: "detail" });
      }
      return;
    }

    if (key.escape) {
      if (state.viewMode === "detail") {
        dispatch({ type: "SET_VIEW_MODE", viewMode: "list" });
      } else {
        onCancel();
      }
      return;
    }

    if (key.upArrow) {
      dispatch({ type: "MOVE_UP", serverCount: servers.length });
      return;
    }

    if (key.downArrow) {
      dispatch({ type: "MOVE_DOWN", serverCount: servers.length });
      return;
    }

    // Hotkeys for server actions
    if (input === "c") {
      const server = servers[state.selectedIndex];
      if (
        server &&
        (server.status === "disconnected" || server.status === "error")
      ) {
        handleConnect(server.name);
      }
      return;
    }

    if (input === "d") {
      const server = servers[state.selectedIndex];
      if (server && server.status === "connected") {
        handleDisconnect(server.name);
      }
      return;
    }
  });

  if (state.viewMode === "detail" && selectedServer) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
        gap={1}
      >
        <Box>
          <Text color="cyan" bold>
            MCP Server Details: {selectedServer.name}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box>
            <Text>
              <Text color="blue">Status:</Text>{" "}
              <Text color={getStatusColor(selectedServer.status)}>
                {getStatusIcon(selectedServer.status)} {selectedServer.status}
              </Text>
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Command:</Text> {selectedServer.config.command}
            </Text>
          </Box>
          {selectedServer.config.args && (
            <Box>
              <Text>
                <Text color="blue">Args:</Text>{" "}
                {selectedServer.config.args.join(" ")}
              </Text>
            </Box>
          )}
          {selectedServer.toolCount !== undefined && (
            <Box>
              <Text>
                <Text color="blue">Tools:</Text> {selectedServer.toolCount}{" "}
                tools
              </Text>
            </Box>
          )}
          {selectedServer.capabilities && (
            <Box>
              <Text>
                <Text color="blue">Capabilities:</Text>{" "}
                {selectedServer.capabilities.join(", ")}
              </Text>
            </Box>
          )}
          {selectedServer.lastConnected && (
            <Box>
              <Text>
                <Text color="blue">Last Connected:</Text>{" "}
                {formatTime(selectedServer.lastConnected)}
              </Text>
            </Box>
          )}
          {selectedServer.error && (
            <Box>
              <Text>
                <Text color="red">Error:</Text> {selectedServer.error}
              </Text>
            </Box>
          )}
        </Box>

        {selectedServer.config.env &&
          Object.keys(selectedServer.config.env).length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="blue" bold>
                Environment Variables:
              </Text>
              <Box borderStyle="single" borderColor="blue" padding={1}>
                {Object.entries(selectedServer.config.env).map(
                  ([key, value]) => (
                    <Text key={key}>
                      {key}={value}
                    </Text>
                  ),
                )}
              </Box>
            </Box>
          )}

        <Box marginTop={1}>
          <Text dimColor>
            {selectedServer.status === "disconnected" ||
            selectedServer.status === "error"
              ? "c to connect · "
              : ""}
            {selectedServer.status === "connected" ? "d to disconnect · " : ""}
            Esc to go back
          </Text>
        </Box>
      </Box>
    );
  }

  if (servers.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="cyan"
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingTop={1}
      >
        <Text color="cyan" bold>
          Manage MCP servers
        </Text>
        <Text>No MCP servers configured</Text>
        <Text dimColor>
          Create a .mcp.json file in your project root to add servers
        </Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="cyan"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingTop={1}
      gap={1}
    >
      <Box>
        <Text color="cyan" bold>
          Manage MCP servers
        </Text>
      </Box>
      <Text dimColor>Select a server to view details</Text>

      {servers.map((server, index) => (
        <Box key={server.name} flexDirection="column">
          <Text
            color={index === state.selectedIndex ? "black" : "white"}
            backgroundColor={index === state.selectedIndex ? "cyan" : undefined}
          >
            {index === state.selectedIndex ? "▶ " : "  "}
            {index + 1}.{" "}
            <Text color={getStatusColor(server.status)}>
              {getStatusIcon(server.status)}
            </Text>{" "}
            {server.name}
            {server.status === "connected" && server.toolCount && (
              <Text color="green"> · {server.toolCount} tools</Text>
            )}
          </Text>
          {index === state.selectedIndex && (
            <Box marginLeft={4} flexDirection="column">
              <Text color="gray" dimColor>
                {server.config.command}
                {server.config.args ? ` ${server.config.args.join(" ")}` : ""}
              </Text>
              {server.lastConnected && (
                <Text color="gray" dimColor>
                  Last connected: {formatTime(server.lastConnected)}
                </Text>
              )}
            </Box>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to select · Enter to view ·{" "}
          {servers[state.selectedIndex]?.status === "disconnected" ||
          servers[state.selectedIndex]?.status === "error"
            ? "c to connect · "
            : ""}
          {servers[state.selectedIndex]?.status === "connected"
            ? "d to disconnect · "
            : ""}
          Esc to close
        </Text>
      </Box>
    </Box>
  );
};
