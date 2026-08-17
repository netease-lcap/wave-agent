import React, { useReducer, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { SessionMetadata } from "wave-agent-sdk";
import {
  selectorReducer,
  type SelectorState,
} from "../reducers/selectorReducer.js";

type SessionItem = SessionMetadata & { firstMessage?: string };

export interface SessionSelectorProps {
  sessions: SessionItem[];
  onSelect: (sessionId: string) => void;
  onCancel: () => void;
  /**
   * Same-repo worktree paths (from `git worktree list`). The Ctrl+W
   * all-worktrees toggle is only enabled when more than one worktree exists.
   */
  worktreePaths?: string[];
  /** Show each session's project directory at the end of its row. */
  showProjectPath?: boolean;
  /** Emitted with the new scope when the user toggles all-projects (Ctrl+A). */
  onToggleAllProjects?: (showAllProjects: boolean) => void;
  /** Emitted with the new scope when the user toggles all-worktrees (Ctrl+W). */
  onToggleAllWorktrees?: (showAllWorktrees: boolean) => void;
}

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  onSelect,
  onCancel,
  worktreePaths = [],
  showProjectPath = false,
  onToggleAllProjects,
  onToggleAllWorktrees,
}) => {
  const [state, dispatch] = useReducer(selectorReducer<SessionItem>, {
    selectedIndex: 0,
    pendingDecision: null,
    items: [],
    showAllProjects: false,
    showAllWorktrees: false,
  } as SelectorState<SessionItem>);

  const {
    selectedIndex,
    pendingDecision,
    items,
    showAllProjects,
    showAllWorktrees,
  } = state;

  // Sync sessions into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: sessions });
  }, [sessions]);

  useInput((input, key) => {
    // Ctrl+A — toggle all-projects scope (only when the parent supports it)
    if (key.ctrl && input.toLowerCase() === "a" && onToggleAllProjects) {
      dispatch({ type: "TOGGLE_ALL_PROJECTS" });
      return;
    }
    // Ctrl+W — toggle all-worktrees scope (only with multiple worktrees)
    if (
      key.ctrl &&
      input.toLowerCase() === "w" &&
      onToggleAllWorktrees &&
      worktreePaths.length > 1
    ) {
      dispatch({ type: "TOGGLE_ALL_WORKTREES" });
      return;
    }
    dispatch({ type: "HANDLE_KEY", key, hasInsert: false });
  });

  // Report scope toggles to the parent so it can reload the session list.
  // Skip the initial render — the parent already starts in the default scope.
  const projectsFirstRender = useRef(true);
  useEffect(() => {
    if (projectsFirstRender.current) {
      projectsFirstRender.current = false;
      return;
    }
    onToggleAllProjects?.(showAllProjects ?? false);
  }, [showAllProjects, onToggleAllProjects]);
  const worktreesFirstRender = useRef(true);
  useEffect(() => {
    if (worktreesFirstRender.current) {
      worktreesFirstRender.current = false;
      return;
    }
    onToggleAllWorktrees?.(showAllWorktrees ?? false);
  }, [showAllWorktrees, onToggleAllWorktrees]);

  useEffect(() => {
    if (pendingDecision === "select") {
      if (items.length > 0 && selectedIndex < items.length) {
        onSelect(items[selectedIndex].id);
      }
      dispatch({ type: "CLEAR_DECISION" });
    } else if (pendingDecision === "cancel") {
      onCancel();
      dispatch({ type: "CLEAR_DECISION" });
    }
  }, [pendingDecision, selectedIndex, items, onSelect, onCancel]);

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

  const hints = [
    onToggleAllProjects
      ? `Ctrl+A ${showAllProjects ? "当前目录" : "全部项目"}`
      : null,
    onToggleAllWorktrees && worktreePaths.length > 1
      ? `Ctrl+W ${showAllWorktrees ? "当前 worktree" : "全部 worktree"}`
      : null,
    "↑↓ 选择",
    "Enter 确认",
    "Esc 取消",
  ]
    .filter((hint): hint is string => hint !== null)
    .join("  ·  ");

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
                    {session.id.slice(0, 8)} | {lastActiveAt} |{" "}
                    {session.latestTotalTokens} tokens
                    {session.branch ? ` | [${session.branch}]` : ""}
                    {showProjectPath && session.workdir
                      ? ` | ${session.workdir}`
                      : ""}
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
        <Text dimColor>{hints}</Text>
      </Box>
    </Box>
  );
};
