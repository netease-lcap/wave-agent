import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { SessionSelectorFlow } from "./SessionSelectorFlow.js";
import { listWorktrees } from "../utils/worktree.js";

export interface ResumeCommandProps {
  /** The session's current working directory (the picker's default scope). */
  workdir: string;
  /**
   * True while a turn is in flight. Switching mid-turn is refused: the running
   * turn must not be aborted (its abort error would land in the session being
   * left behind), so the picker is replaced by a notice.
   */
  isBusy: boolean;
  /**
   * Called with the chosen session. `resumeWorkdir` is set when the session
   * belongs to a sibling worktree of the same repo — the session then moves
   * into that directory.
   */
  onSelect: (sessionId: string, resumeWorkdir?: string) => void;
  onCancel: () => void;
}

/**
 * In-TUI `/resume` picker. Thin wrapper over the shared `SessionSelectorFlow`:
 * the worktree list is loaded lazily on open (it needs a `git worktree list`
 * round-trip), and a cross-project selection shows a dismissible notice instead
 * of tearing down the TUI.
 */
export const ResumeCommand: React.FC<ResumeCommandProps> = ({
  workdir,
  isBusy,
  onSelect,
  onCancel,
}) => {
  const [worktreePaths, setWorktreePaths] = useState<string[] | null>(null);

  useInput((_input, key) => {
    if (isBusy && key.escape) {
      onCancel();
    }
  });

  useEffect(() => {
    if (isBusy) return;
    let cancelled = false;
    listWorktrees(workdir).then((paths) => {
      if (!cancelled) setWorktreePaths(paths);
    });
    return () => {
      cancelled = true;
    };
  }, [workdir, isBusy]);

  if (isBusy) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="yellow">
          Cannot resume a conversation while the agent is running.
        </Text>
        <Text dimColor>Esc to go back</Text>
      </Box>
    );
  }

  if (!worktreePaths) {
    return (
      <Box paddingX={1}>
        <Text dimColor>Loading conversations…</Text>
      </Box>
    );
  }

  return (
    <SessionSelectorFlow
      currentWorkdir={workdir}
      worktreePaths={worktreePaths}
      crossProjectMode="dismiss"
      onDone={(result) =>
        result ? onSelect(result.sessionId, result.resumeWorkdir) : onCancel()
      }
    />
  );
};
