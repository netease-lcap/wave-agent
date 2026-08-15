import React, { useState, useCallback, useEffect, useRef } from "react";
import { render, Box, Text } from "ink";
import { existsSync } from "fs";
import {
  PathEncoder,
  listSessions,
  listAllSessions,
  truncateContent,
  type SessionMetadata,
} from "wave-agent-sdk";
import { SessionSelector } from "./components/SessionSelector.js";
import { setClipboardText } from "./utils/clipboard.js";

export interface SessionSelectorResult {
  sessionId: string;
  /**
   * When the selected session belongs to a sibling git worktree of the same
   * repo, the caller should chdir into this path before restoring.
   */
  resumeWorkdir?: string;
}

type SessionItem = SessionMetadata & { firstMessage?: string };

/** POSIX single-quote wrapping for use inside a `cd <path> && ...` command. */
function quotePath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export type SessionOwnership =
  | { kind: "current" }
  | { kind: "worktree"; resumeWorkdir: string }
  | { kind: "cross-project"; command: string };

/**
 * Decide how a selected session relates to the current working directory.
 *
 * Ownership is decided by comparing encoded directory names — the decoded
 * workdir is lossy for paths containing "-", but re-encoding it reproduces the
 * original encoded directory name exactly.
 *
 * - current:      session belongs to the current directory → resume in place
 * - worktree:     session belongs to a sibling same-repo worktree → resume
 *                 after chdir into it (skipped when the worktree dir is gone)
 * - cross-project: session belongs to another project → print a cd command
 */
export async function resolveSessionOwnership(
  session: { id: string; workdir: string },
  opts: { worktreePaths: string[]; currentWorkdir: string },
): Promise<SessionOwnership> {
  const encoder = new PathEncoder();
  const sessionEncoded = await encoder.encode(session.workdir);
  const cwdEncoded = await encoder.encode(opts.currentWorkdir);

  if (sessionEncoded === cwdEncoded) {
    return { kind: "current" };
  }

  for (const wt of opts.worktreePaths) {
    let wtEncoded: string;
    try {
      wtEncoded = await encoder.encode(wt);
    } catch {
      wtEncoded = encoder.encodeSync(wt);
    }
    if (wtEncoded === sessionEncoded && existsSync(wt)) {
      return { kind: "worktree", resumeWorkdir: wt };
    }
  }

  return {
    kind: "cross-project",
    command: `cd ${quotePath(session.workdir)} && wave --restore ${session.id}`,
  };
}

/**
 * Interactive session picker for `wave -r` (restore without an ID).
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
 *                              copy it to the clipboard, and exit
 */
function SessionSelectorFlow({
  currentWorkdir,
  worktreePaths,
  onDone,
}: {
  currentWorkdir: string;
  worktreePaths: string[];
  onDone: (result: SessionSelectorResult | null) => void;
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
        onExit={() => onDone(null)}
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
 * Cross-project message auto-exits after a short delay (mirrors Claude Code's
 * resume picker, which prints the cd command and exits).
 */
function CrossProjectMessage({
  command,
  onExit,
}: {
  command: string;
  onExit: () => void;
}): React.ReactNode {
  useEffect(() => {
    const timer = setTimeout(onExit, 100);
    return () => clearTimeout(timer);
  }, [onExit]);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>This conversation is from a different directory.</Text>
      <Box flexDirection="column">
        <Text>To resume, run:</Text>
        <Text> {command}</Text>
      </Box>
      <Text dimColor>(Command copied to clipboard)</Text>
    </Box>
  );
}

export async function startSessionSelectorCli({
  workdir,
  worktreePaths = [],
}: {
  workdir?: string;
  worktreePaths?: string[];
} = {}): Promise<SessionSelectorResult | null> {
  const currentWorkdir = workdir || process.cwd();

  return new Promise((resolve) => {
    const { unmount } = render(
      <SessionSelectorFlow
        currentWorkdir={currentWorkdir}
        worktreePaths={worktreePaths}
        onDone={(result) => {
          unmount();
          resolve(result);
        }}
      />,
    );
  });
}
