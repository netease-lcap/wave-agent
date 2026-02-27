import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { cleanupLogs } from "./utils/logger.js";
import { type WorktreeSession } from "./utils/worktree.js";

export interface CliOptions {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  bypassPermissions?: boolean;
  pluginDirs?: string[];
  tools?: string[];
  worktreeSession?: WorktreeSession;
}

export async function startCli(options: CliOptions): Promise<void> {
  const {
    restoreSessionId,
    continueLastSession,
    bypassPermissions,
    pluginDirs,
    tools,
    worktreeSession,
  } = options;

  // Continue with ink-based UI for normal mode
  // Global cleanup tracker
  let isCleaningUp = false;
  let appUnmounted = false;

  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    try {
      // Clean up old log files
      await cleanupLogs().catch((error) => {
        console.warn("Failed to cleanup old logs:", error);
      });

      // Unmount the React app to trigger cleanup
      if (!appUnmounted) {
        unmount();
        appUnmounted = true;
        // Give React time to cleanup
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      process.exit(0);
    } catch (error: unknown) {
      console.error("Error during cleanup:", error);
      process.exit(1);
    }
  };

  // Render the application
  const { unmount } = render(
    <App
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
      bypassPermissions={bypassPermissions}
      pluginDirs={pluginDirs}
      tools={tools}
      worktreeSession={worktreeSession}
      onExit={cleanup}
    />,
  );

  // Store unmount function for cleanup when process exits normally
  process.on("exit", () => {
    if (!appUnmounted) {
      try {
        unmount();
      } catch {
        // Ignore errors during unmount
      }
    }
  });

  // Return a promise that never resolves to keep the CLI running
  return new Promise(() => {});
}
