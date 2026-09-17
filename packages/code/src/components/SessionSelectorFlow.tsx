import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import {
  listSessions,
  listAllSessions,
  truncateContent,
  type SessionMetadata,
} from "wave-agent-sdk";
import { SessionSelector } from "./SessionSelector.js";
import { setClipboardText } from "../utils/clipboard.js";
import { resolveSessionOwnership } from "../utils/sessionOwnership.js";

export interface SessionSelectorResult {
  sessionId: string;
  /**
   * When the selected session belongs to a sibling git worktree of the same
   * repo, the caller should chdir into this path before restoring.
   */
  resumeWorkdir?: string;
}

type SessionItem = SessionMetadata & { firstMessage?: string };

/**
 * Interactive session picker.
 *
 * Three scopes, toggled with Ctrl+A / Ctrl+W (mirroring Claude Code's resume
 * picker):
 * - current:   sessions in the current working directory (default)
 * - worktrees: sessions in any worktree of the same git repository
 * - all:       sessions across every project directory
 *
 * Resume decision on selection:
 * - current dir session      → resume in place
 * - same-repo worktree       → resume after chdir into that worktree
 * - other project            → print `cd <path> && wave --restore <id>`,
 *                              copy it to the clipboard, and finish
 *
 * Shared by `wave -r` (own Ink render) and the in-TUI `/resume` command, so
 * the two can never drift in scopes or ownership resolution.
 */
export function SessionSelectorFlow({
  currentWorkdir,
  worktreePaths,
  onDone,
  crossProjectMode = "exit",
}: {
  currentWorkdir: string;
  worktreePaths: string[];
  onDone: (result: SessionSelectorResult | null) => void;
  /**
   * What happens after the cross-project `cd` command is shown:
   * - "exit": finish the flow (the standalone `wave -r` picker then prints the
   *   command and the process exits).
   * - "dismiss": stay in the flow until Esc — used by the in-TUI `/resume`
   *   picker, which must not tear down the surrounding conversation.
   */
  crossProjectMode?: "exit" | "dismiss";
}): React.ReactNode {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [showAllWorktrees, setShowAllWorktrees] = useState(false);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [crossProjectCommand, setCrossProjectCommand] = useState<string | null>(
    null,
  );

  // Mirror of the scope flags for use inside async reload/decision callbacks.
  const scopeRef = useRef({ showAllProjects: false, showAllWorktrees: false });

  const loadSessions = useCallback(
    async (allProjects: boolean, allWorktrees: boolean) => {
      if (allProjects) {
        return listAllSessions();
      }
      if (allWorktrees) {
        return listAllSessions({ worktreePaths, workdir: currentWorkdir });
      }
      return listSessions(currentWorkdir);
    },
    [worktreePaths, currentWorkdir],
  );

  const reload = useCallback(
    async (allProjects: boolean, allWorktrees: boolean) => {
      setLoading(true);
      try {
        const result = await loadSessions(allProjects, allWorktrees);
        setSessions(
          result.map((s) => ({
            ...s,
            firstMessage: truncateContent(s.firstMessage || "No content", 80),
          })),
        );
      } finally {
        setLoading(false);
      }
    },
    [loadSessions],
  );

  // Initial load: current directory scope
  useEffect(() => {
    void reload(false, false);
  }, [reload]);

  const handleToggleAllProjects = useCallback(
    (value: boolean) => {
      scopeRef.current.showAllProjects = value;
      setShowAllProjects(value);
      void reload(value, scopeRef.current.showAllWorktrees);
    },
    [reload],
  );

  const handleToggleAllWorktrees = useCallback(
    (value: boolean) => {
      scopeRef.current.showAllWorktrees = value;
      setShowAllWorktrees(value);
      void reload(scopeRef.current.showAllProjects, value);
    },
    [reload],
  );

  const handleSelect = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;

      const ownership = await resolveSessionOwnership(session, {
        worktreePaths,
        currentWorkdir,
      });

      switch (ownership.kind) {
        case "current":
          onDone({ sessionId });
          return;
        case "worktree":
          onDone({ sessionId, resumeWorkdir: ownership.resumeWorkdir });
          return;
        case "cross-project":
          // Different project — show the cd command instead of resuming in place
          await setClipboardText(ownership.command);
          setCrossProjectCommand(ownership.command);
          return;
      }
    },
    [sessions, worktreePaths, currentWorkdir, onDone],
  );

  if (crossProjectCommand) {
    return (
      <CrossProjectMessage
        command={crossProjectCommand}
        onExit={() =>
          crossProjectMode === "dismiss"
            ? setCrossProjectCommand(null)
            : onDone(null)
        }
        autoExit={crossProjectMode === "exit"}
      />
    );
  }

  if (loading) {
    return (
      <Box>
        <Text dimColor>Loading conversations…</Text>
      </Box>
    );
  }

  return (
    <Box padding={1}>
      <SessionSelector
        sessions={sessions}
        worktreePaths={worktreePaths}
        showProjectPath={showAllProjects || showAllWorktrees}
        onSelect={(id) => void handleSelect(id)}
        onCancel={() => onDone(null)}
        onToggleAllProjects={handleToggleAllProjects}
        onToggleAllWorktrees={handleToggleAllWorktrees}
      />
    </Box>
  );
}

/**
 * Cross-project notice. `wave -r` auto-exits after a short delay (mirrors
 * Claude Code's resume picker, which prints the cd command and exits); the
 * in-TUI `/resume` picker waits for Esc instead, so the conversation behind it
 * survives.
 */
function CrossProjectMessage({
  command,
  onExit,
  autoExit,
}: {
  command: string;
  onExit: () => void;
  autoExit: boolean;
}): React.ReactNode {
  useEffect(() => {
    if (!autoExit) return;
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [autoExit, onExit]);

  useInput((_input, key) => {
    if (!autoExit && key.escape) {
      onExit();
    }
  });

  return (
    <Box flexDirection="column" gap={1}>
      <Text>This conversation is from a different directory.</Text>
      <Box flexDirection="column">
        <Text>To resume, run:</Text>
        <Text> {command}</Text>
      </Box>
      <Text dimColor>
        {autoExit ? "(Command copied to clipboard)" : "Esc to go back"}
      </Text>
    </Box>
  );
}
