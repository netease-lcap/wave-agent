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
    originalCwd,
    version,
    model,
    mcpServers,
  } = options;

  // Continue with ink-based UI for normal mode
  let shouldRemoveWorktree = false;

  // Enable bracketed paste (DECSET 2004) so terminals wrap pasted text in
  // \x1b[200~ ... \x1b[201~ markers. The input pipeline uses these to insert
  // pasted text without submitting (a pasted trailing \r is not an Enter).
  // Terminals without bracketed-paste support ignore the sequence and paste
  // without markers, falling back to legacy behavior. No-op when stdout is
  // not a TTY (piped input, stdio mode).
  const stdoutIsTTY = process.stdout.isTTY === true;
  if (stdoutIsTTY) {
    process.stdout.write("\x1b[?2004h");
  }

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
      originalCwd={originalCwd}
      version={version}
      model={model}
      mcpServers={mcpServers}
      onExit={handleExit}
    />,
    { exitOnCtrlC: false },
  );

  // Wait for the app to finish unmounting
  try {
    await waitUntilExit();
  } finally {
    // Disable bracketed paste (DECSET 2004) so the terminal returns to its
    // previous paste handling.
    if (stdoutIsTTY) {
      process.stdout.write("\x1b[?2004l");
    }
  }

  try {
    // Clean up old log files
    await cleanupLogs().catch((error) => {
      console.warn("Failed to cleanup old logs:", error);
    });

    // Cleanup worktree if requested
    if (shouldRemoveWorktree && worktreeSession) {
      process.chdir(worktreeSession.repoRoot);
      await removeWorktree(worktreeSession);
    }

    process.exit(0);
  } catch (error: unknown) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}
