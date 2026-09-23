import React, {
  useReducer,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import { Box, Text, useInput, type Key } from "ink";
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
  /**
   * Ctrl+R renames the focused session. The parent persists the new title
   * (the session may belong to another project, so only it knows the file);
   * the row shows the new title as soon as the promise resolves. Rejecting
   * keeps the old title and surfaces a visible failure notice.
   */
  onRename?: (sessionId: string, title: string) => Promise<void>;
}

type RenameState = {
  sessionId: string;
  value: string;
  cursor: number;
  saving: boolean;
};

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  onSelect,
  onCancel,
  worktreePaths = [],
  showProjectPath = false,
  onToggleAllProjects,
  onToggleAllWorktrees,
  onRename,
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

  // Titles committed during this picker session. The parent's list is only
  // re-synced through SET_ITEMS (which resets the selection), so overlaying the
  // new title here keeps the row, the scope and the selected index intact.
  const [renamedTitles, setRenamedTitles] = useState<Record<string, string>>(
    {},
  );
  const [renaming, setRenaming] = useState<RenameState | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Sync sessions into reducer state
  useEffect(() => {
    dispatch({ type: "SET_ITEMS", items: sessions });
  }, [sessions]);

  const submitRename = useCallback(async () => {
    if (!renaming || renaming.saving) return;
    const { sessionId, value } = renaming;
    const title = value.trim();
    // Blank title: nothing to save, just leave the editor (spec: 空标题为 no-op).
    if (!title) {
      setRenaming(null);
      return;
    }
    setRenaming({ ...renaming, saving: true });
    try {
      await onRename?.(sessionId, title);
      setRenamedTitles((prev) => ({ ...prev, [sessionId]: title }));
      setRenameError(null);
      setRenaming(null);
    } catch (error) {
      setRenaming(null);
      setRenameError(
        `Failed to rename: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }, [renaming, onRename]);

  const handleRenameKeys = (input: string, key: Key) => {
    // While saving, swallow everything — the editor closes on the response.
    if (!renaming || renaming.saving) return;

    if (key.escape) {
      setRenaming(null);
      return;
    }
    if (key.return) {
      void submitRename();
      return;
    }
    if (key.backspace || key.delete) {
      if (renaming.cursor === 0) return;
      const nextCursor = renaming.cursor - 1;
      setRenaming({
        ...renaming,
        value:
          renaming.value.slice(0, nextCursor) +
          renaming.value.slice(renaming.cursor),
        cursor: nextCursor,
      });
      return;
    }
    if (key.leftArrow) {
      setRenaming({
        ...renaming,
        cursor: Math.max(0, renaming.cursor - 1),
      });
      return;
    }
    if (key.rightArrow) {
      setRenaming({
        ...renaming,
        cursor: Math.min(renaming.value.length, renaming.cursor + 1),
      });
      return;
    }
    if (
      input &&
      !key.ctrl &&
      !key.meta &&
      !key.return &&
      !key.escape &&
      !key.backspace &&
      !key.delete &&
      !key.leftArrow &&
      !key.rightArrow
    ) {
      setRenaming({
        ...renaming,
        value:
          renaming.value.slice(0, renaming.cursor) +
          input +
          renaming.value.slice(renaming.cursor),
        cursor: renaming.cursor + input.length,
      });
    }
  };

  // One subscription for both modes: while the inline title editor is open it
  // owns every key (spec: 编辑期间按键不得冒泡触发列表操作), so a single handler
  // keeps the editor from racing a second `useInput` subscription.
  useInput((input, key) => {
    if (renaming) {
      handleRenameKeys(input, key);
      return;
    }
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
    // Ctrl+R — rename the focused session in place
    if (key.ctrl && input.toLowerCase() === "r" && onRename) {
      const target = items[selectedIndex];
      if (!target) return;
      const initial =
        renamedTitles[target.id] ??
        target.customTitle ??
        target.firstMessage ??
        "";
      setRenameError(null);
      setRenaming({
        sessionId: target.id,
        value: initial,
        cursor: initial.length,
        saving: false,
      });
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

  // Display precedence: custom title > first message > placeholder (shared with
  // every other host — spec: session-management.md 用户故事「会话自定义标题」).
  const sessionTitle = (session: SessionItem): string =>
    renamedTitles[session.id] ??
    session.customTitle ??
    session.firstMessage ??
    "";

  const hints = [
    onToggleAllProjects
      ? `Ctrl+A ${showAllProjects ? "current directory" : "all projects"}`
      : null,
    onToggleAllWorktrees && worktreePaths.length > 1
      ? `Ctrl+W ${showAllWorktrees ? "current worktree" : "all worktrees"}`
      : null,
    onRename ? "Ctrl+R rename" : null,
    "↑↓ select",
    "Enter confirm",
    "Esc cancel",
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
          const isRenaming = renaming?.sessionId === session.id;

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
              {isRenaming && renaming ? (
                <Box marginLeft={2} width="100%">
                  <Text>
                    <Text dimColor>Rename: </Text>
                    {renaming.value.slice(0, renaming.cursor)}
                    <Text backgroundColor="white" color="black">
                      {renaming.cursor < renaming.value.length
                        ? renaming.value[renaming.cursor]
                        : " "}
                    </Text>
                    {renaming.value.slice(renaming.cursor + 1)}
                  </Text>
                </Box>
              ) : (
                isSelected &&
                sessionTitle(session) && (
                  <Box marginLeft={2} width="100%">
                    <Text dimColor italic wrap="truncate-end">
                      {sessionTitle(session).replace(/\n/g, "\\n")}
                    </Text>
                  </Box>
                )
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

      {renameError && (
        <Box>
          <Text color="red">{renameError}</Text>
        </Box>
      )}

      <Box>
        <Text dimColor>
          {renaming
            ? renaming.saving
              ? "Saving…"
              : "Enter save  ·  Esc cancel"
            : hints}
        </Text>
      </Box>
    </Box>
  );
};
