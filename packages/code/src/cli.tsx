import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { cleanupLogs } from "./utils/logger.js";
import { type WorktreeSession, removeWorktree } from "./utils/worktree.js";

export interface CliOptions {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  bypassPermissions?: boolean;
  pluginDirs?: string[];
  tools?: string[];
  worktreeSession?: WorktreeSession;
  workdir?: string;
}

export async function startCli(options: CliOptions): Promise<void> {
  const {
    restoreSessionId,
    continueLastSession,
    bypassPermissions,
    pluginDirs,
    tools,
    worktreeSession,
    workdir,
  } = options;

  // Continue with ink-based UI for normal mode
  let shouldRemoveWorktree = false;

  const handleExit = (shouldRemove: boolean) => {
    shouldRemoveWorktree = shouldRemove;
    unmount();
  };

  // Render the application
  const { unmount, waitUntilExit } = render(
    <App
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
      bypassPermissions={bypassPermissions}
      pluginDirs={pluginDirs}
      tools={tools}
      worktreeSession={worktreeSession}
      workdir={workdir}
      onExit={handleExit}
    />,
    { exitOnCtrlC: false },
  );

  // Wait for the app to finish unmounting
  await waitUntilExit();

  try {
    // Clean up old log files
    await cleanupLogs().catch((error) => {
      console.warn("Failed to cleanup old logs:", error);
    });

    // Cleanup worktree if requested
    if (shouldRemoveWorktree && worktreeSession) {
      process.chdir(worktreeSession.repoRoot);
      removeWorktree(worktreeSession);
    }

    process.exit(0);
  } catch (error: unknown) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}
