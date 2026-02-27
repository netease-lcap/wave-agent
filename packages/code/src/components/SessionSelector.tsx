import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMetadata } from "wave-agent-sdk";

export interface SessionSelectorProps {
  sessions: (SessionMetadata & { firstMessage?: string })[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
}

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  onSelect,
  onCancel,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.return) {
      if (sessions.length > 0 && selectedIndex < sessions.length) {
        onSelect(sessions[selectedIndex].id);
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
      setSelectedIndex(Math.min(sessions.length - 1, selectedIndex + 1));
      return;
    }
  });

  if (sessions.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor="yellow"
        borderLeft={false}
        borderRight={false}
        paddingX={1}
        width="100%"
      >
        <Text color="yellow">No sessions found.</Text>
        <Text dimColor>Press Escape to cancel</Text>
      </Box>
    );
  }

  const maxDisplay = 10;
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxDisplay / 2),
      sessions.length - maxDisplay,
    ),
  );
  const displaySessions = sessions.slice(startIndex, startIndex + maxDisplay);

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      gap={1}
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      width="100%"
    >
      <Box>
        <Text color="cyan" bold>
          Select a session to resume
        </Text>
      </Box>

      <Box flexDirection="column">
        {displaySessions.map((session, index) => {
          const actualIndex = startIndex + index;
          const isSelected = actualIndex === selectedIndex;
          const lastActiveAt = new Date(session.lastActiveAt).toLocaleString();

          return (
            <Box key={session.id} flexDirection="column" width="100%">
              <Box width="100%">
                <Text
                  color={isSelected ? "black" : "white"}
                  backgroundColor={isSelected ? "cyan" : undefined}
                >
                  {isSelected ? "▶ " : "  "}
                  {session.id} | {lastActiveAt} | {session.latestTotalTokens}{" "}
                  tokens
                </Text>
              </Box>
              <Box marginLeft={4} width="100%">
                <Text dimColor italic>
                  {session.firstMessage}
                </Text>
              </Box>
            </Box>
          );
        })}
      </Box>

      {sessions.length > maxDisplay && (
        <Box>
          <Text dimColor>
            ... showing {displaySessions.length} of {sessions.length} sessions
          </Text>
        </Box>
      )}

      <Box>
        <Text dimColor>↑↓ navigate • Enter to select • Esc to cancel</Text>
      </Box>
    </Box>
  );
};
