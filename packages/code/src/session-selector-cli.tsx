import React from "react";
import { render } from "ink";
import {
  SessionSelectorFlow,
  type SessionSelectorResult,
} from "./components/SessionSelectorFlow.js";

export type { SessionSelectorResult };

/**
 * Interactive session picker for `wave -r` (restore without an ID), rendered in
 * its own Ink instance before the main TUI starts. The picker itself is shared
 * with the in-TUI `/resume` command (see `SessionSelectorFlow`).
 */
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
