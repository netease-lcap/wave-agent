import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { cleanupLogs } from "./utils/logger.js";
import { removeWorktree } from "./utils/worktree.js";
import { BaseAppProps } from "./types.js";

export interface CliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

export async function startCli(options: CliOptions): Promise<void> {
  const {
    restoreSessionId,
    continueLastSession,
    bypassPermissions,
    permissionMode,
    pluginDirs,
    tools,
    allowedTools,
    disallowedTools,
    worktreeSession,
    workdir,
    version,
    model,
    mcpServers,
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
      permissionMode={permissionMode}
      pluginDirs={pluginDirs}
      tools={tools}
      allowedTools={allowedTools}
      disallowedTools={disallowedTools}
      worktreeSession={worktreeSession}
      workdir={workdir}
      version={version}
      model={model}
      mcpServers={mcpServers}
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
