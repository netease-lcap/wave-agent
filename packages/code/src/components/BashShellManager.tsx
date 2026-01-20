import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { useChat } from "../contexts/useChat.js";

interface BashShell {
  id: string;
  command: string;
  status: "running" | "completed" | "killed";
  startTime: number;
  exitCode?: number;
  runtime?: number;
}

export interface BashShellManagerProps {
  onCancel: () => void;
}

export const BashShellManager: React.FC<BashShellManagerProps> = ({
  onCancel,
}) => {
  const { backgroundShells, getBackgroundShellOutput, killBackgroundShell } =
    useChat();
  const [shells, setShells] = useState<BashShell[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "detail">("list");
  const [detailShellId, setDetailShellId] = useState<string | null>(null);
  const [detailOutput, setDetailOutput] = useState<{
    stdout: string;
    stderr: string;
    status: string;
  } | null>(null);

  // Convert backgroundShells to local BashShell format
  useEffect(() => {
    setShells(
      backgroundShells.map((shell) => ({
        id: shell.id,
        command: shell.command,
        status: shell.status,
        startTime: shell.startTime,
        exitCode: shell.exitCode,
        runtime: shell.runtime,
      })),
    );
  }, [backgroundShells]);

  // Load detail output for selected shell
  useEffect(() => {
    if (viewMode === "detail" && detailShellId) {
      const output = getBackgroundShellOutput(detailShellId);
      setDetailOutput(output);
    }
  }, [viewMode, detailShellId, getBackgroundShellOutput]);

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const killShell = (shellId: string) => {
    killBackgroundShell(shellId);
  };

  useInput((input, key) => {
    if (viewMode === "list") {
      // List mode navigation
      if (key.return) {
        if (shells.length > 0 && selectedIndex < shells.length) {
          const selectedShell = shells[selectedIndex];
          setDetailShellId(selectedShell.id);
          setViewMode("detail");
        }
        return;
      }

      if (key.escape) {
        onCancel();
        return;
      }

      if (key.upArrow) {
        setSelectedIndex(Math.max(0, selectedIndex - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex(Math.min(shells.length - 1, selectedIndex + 1));
        return;
      }

      if (input === "k" && shells.length > 0 && selectedIndex < shells.length) {
        const selectedShell = shells[selectedIndex];
        if (selectedShell.status === "running") {
          killShell(selectedShell.id);
        }
        return;
      }
    } else if (viewMode === "detail") {
      // Detail mode navigation
      if (key.escape) {
        setViewMode("list");
        setDetailShellId(null);
        setDetailOutput(null);
        return;
      }

      if (input === "k" && detailShellId) {
        const shell = shells.find((s) => s.id === detailShellId);
        if (shell && shell.status === "running") {
          killShell(detailShellId);
        }
        return;
      }
    }
  });

  if (viewMode === "detail" && detailShellId && detailOutput) {
    const shell = shells.find((s) => s.id === detailShellId);
    if (!shell) {
      setViewMode("list");
      return null;
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
            Background Shell Details: {shell.id}
          </Text>
        </Box>

        <Box flexDirection="column" gap={1}>
          <Box>
            <Text>
              <Text color="blue">Command:</Text> {shell.command}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Status:</Text> {shell.status}
              {shell.exitCode !== undefined &&
                ` (exit code: ${shell.exitCode})`}
            </Text>
          </Box>
          <Box>
            <Text>
              <Text color="blue">Started:</Text> {formatTime(shell.startTime)}
              {shell.runtime !== undefined && (
                <Text>
                  {" "}
                  | <Text color="blue">Runtime:</Text>{" "}
                  {formatDuration(shell.runtime)}
                </Text>
              )}
            </Text>
          </Box>
        </Box>

        {detailOutput.stdout && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="green" bold>
              STDOUT (last 10 lines):
            </Text>
            <Box borderStyle="single" borderColor="green" padding={1}>
              <Text>
                {detailOutput.stdout.split("\n").slice(-10).join("\n")}
              </Text>
            </Box>
          </Box>
        )}

        {detailOutput.stderr && (
          <Box flexDirection="column" marginTop={1}>
            <Text color="red" bold>
              STDERR:
            </Text>
            <Box borderStyle="single" borderColor="red" padding={1}>
              <Text color="red">
                {detailOutput.stderr.split("\n").slice(-10).join("\n")}
              </Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1}>
          <Text dimColor>
            {shell.status === "running" ? "k to kill · " : ""}Esc to go back
          </Text>
        </Box>
      </Box>
    );
  }

  if (!backgroundShells) {
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
          Background Bash Shells
        </Text>
        <Text>Background bash shells not available</Text>
        <Text dimColor>Press Escape to close</Text>
      </Box>
    );
  }

  if (shells.length === 0) {
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
          Background Bash Shells
        </Text>
        <Text>No background shells found</Text>
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
          Background Bash Shells
        </Text>
      </Box>
      <Text dimColor>Select a shell to view details</Text>

      {shells.map((shell, index) => (
        <Box key={shell.id} flexDirection="column">
          <Text
            color={index === selectedIndex ? "black" : "white"}
            backgroundColor={index === selectedIndex ? "cyan" : undefined}
          >
            {index === selectedIndex ? "▶ " : "  "}
            {index + 1}.{" "}
            {shell.command.length > 50
              ? shell.command.substring(0, 47) + "..."
              : shell.command}
            <Text
              color={
                shell.status === "running"
                  ? "green"
                  : shell.status === "completed"
                    ? "blue"
                    : "red"
              }
            >
              {" "}
              ({shell.status})
            </Text>
          </Text>
          {index === selectedIndex && (
            <Box marginLeft={4} flexDirection="column">
              <Text color="gray" dimColor>
                ID: {shell.id} | Started: {formatTime(shell.startTime)}
                {shell.runtime !== undefined &&
                  ` | Runtime: ${formatDuration(shell.runtime)}`}
                {shell.exitCode !== undefined && ` | Exit: ${shell.exitCode}`}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>
          ↑/↓ to select · Enter to view ·{" "}
          {shells[selectedIndex]?.status === "running" ? "k to kill · " : ""}Esc
          to close
        </Text>
      </Box>
    </Box>
  );
};
