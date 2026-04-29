import React, { useReducer, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMetadata } from "wave-agent-sdk";
import { selectorReducer } from "../reducers/selectorReducer.js";

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
  const [state, dispatch] = useReducer(selectorReducer, {
    selectedIndex: 0,
    pendingDecision: null,
  });

  const { selectedIndex, pendingDecision } = state;

  useInput((_input, key) => {
    dispatch({
      type: "HANDLE_KEY",
      key,
      maxIndex: sessions.length - 1,
      hasInsert: false,
    });
  });

  useEffect(() => {
    if (pendingDecision === "select") {
      if (sessions.length > 0 && selectedIndex < sessions.length) {
        onSelect(sessions[selectedIndex].id);
      }
      dispatch({ type: "CLEAR_DECISION" });
    } else if (pendingDecision === "cancel") {
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, sessions, onSelect, onCancel]);

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

  const MAX_VISIBLE_ITEMS = 3;
  const startIndex = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2),
      Math.max(0, sessions.length - MAX_VISIBLE_ITEMS),
    ),
  );
  const displaySessions = sessions.slice(
    startIndex,
    startIndex + MAX_VISIBLE_ITEMS,
  );

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
                <Box
                  backgroundColor={isSelected ? "cyan" : undefined}
                  flexShrink={0}
                >
                  <Text color={isSelected ? "black" : "white"}>
                    {isSelected ? "▶ " : "  "}
                  </Text>
                </Box>
                <Box
                  backgroundColor={isSelected ? "cyan" : undefined}
                  flexGrow={1}
                >
                  <Text
                    color={isSelected ? "black" : "white"}
                    wrap="truncate-end"
                  >
                    {session.id} | {lastActiveAt} | {session.latestTotalTokens}{" "}
                    tokens
                  </Text>
                </Box>
              </Box>
              {isSelected && session.firstMessage && (
                <Box marginLeft={2} width="100%">
                  <Text dimColor italic wrap="truncate-end">
                    {session.firstMessage.replace(/\n/g, "\\n")}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      {sessions.length > MAX_VISIBLE_ITEMS && (
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
