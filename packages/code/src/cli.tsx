import React from "react";
import { render } from "ink";
import { ensureRuntimeDeps } from "wave-agent-sdk";
import { App } from "./components/App.js";
import { getPendingAgentDestroy } from "./contexts/useChat.js";
import { cleanupLogs } from "./utils/logger.js";
import { describeWorktreeSurvival, removeWorktree } from "./utils/worktree.js";
import { BaseAppProps } from "./types.js";

/**
 * Upper bound on waiting for `Agent.destroy()` after the UI is gone.
 *
 * The teardown is bounded on its own side (its async-work drain has a timeout),
 * but a wedged MCP child or LSP server must not turn closing the window into a
 * process that never exits. Past this point the orphan risk is accepted in
 * exchange for a terminal that actually comes back.
 */
const AGENT_DESTROY_TIMEOUT_MS = 5_000;

/**
 * Await the teardown that the unmount cleanup started.
 *
 * React effect cleanups are synchronous, so unmounting only *begins*
 * `Agent.destroy()`; without this wait, `process.exit()` below terminates the
 * process while the bash process trees, MCP children and LSP servers that
 * `destroy()` was about to signal are still alive. Detached bash children then
 * outlive their parent as launchd-reparented orphans.
 */
async function awaitAgentDestroy(): Promise<void> {
  const pending = getPendingAgentDestroy();
  if (!pending) return;

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = setTimeout(() => {
      console.warn(
        "Agent teardown timed out; exiting without waiting further.",
      );
      resolve();
    }, AGENT_DESTROY_TIMEOUT_MS);
  });

  try {
    await Promise.race([pending, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export interface CliOptions extends BaseAppProps {
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

export async function startCli(options: CliOptions): Promise<void> {
  // Install the on-demand runtime dependencies (image codec + ripgrep) before
  // the UI comes up. Waiting is the point: pasting an image or running a search
  // a second later must not race a download. Costs ~16ms once they are
  // installed (marker hit), ~6MB/20MB worth of time on the first run of a
  // host-bundled CLI. A failed download only degrades the affected tool — never
  // throws.
  await ensureRuntimeDeps();

  const {
    restoreSessionId,
    continueLastSession,
    bypassPermissions,
    permissionMode,
    pluginDirs,
    additionalDirectories,
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
  let isExiting = false;

  const handleExit = (shouldRemove: boolean) => {
    // A single close can arrive twice (SIGHUP plus the TTY-revocation poll, or
    // an outside kill racing the keypress). Only the first one may unmount.
    if (isExiting) return;
    isExiting = true;
    shouldRemoveWorktree = shouldRemove;
    unmount();
  };

  // Render the application
  const { clear, unmount, waitUntilExit } = render(
    <App
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
      bypassPermissions={bypassPermissions}
      permissionMode={permissionMode}
      pluginDirs={pluginDirs}
      additionalDirectories={additionalDirectories}
      tools={tools}
      allowedTools={allowedTools}
      disallowedTools={disallowedTools}
      worktreeSession={worktreeSession}
      workdir={workdir}
      originalCwd={originalCwd}
      version={version}
      model={model}
      mcpServers={mcpServers}
      // Late-bound: the hook is created before `render()` returns the instance
      // whose `clear()` it calls.
      onClearOutput={() => clear()}
      onExit={handleExit}
    />,
    {
      exitOnCtrlC: false,
      // Redraw only the lines that changed instead of rewriting the whole
      // frame. Measured in a real terminal (tmux, 100x30) while a Bash command
      // streamed 60 lines: 71 KB -> 20 KB written, 733 -> 78 cursor moves, same
      // output on screen. ink falls back to whole-line updates for lines
      // carrying controls it cannot diff around.
      incrementalRendering: true,
    },
  );

  // Wait for the app to finish unmounting
  await waitUntilExit();

  // ...which only *started* the agent teardown. Let it finish before exiting,
  // otherwise the bash trees it was about to signal survive as orphans.
  await awaitAgentDestroy();

  try {
    // Clean up old log files
    await cleanupLogs().catch((error) => {
      console.warn("Failed to cleanup old logs:", error);
    });

    // Cleanup worktree if requested. The Ink UI is already unmounted, and on
    // Windows recursive deletion can take a long time (deep paths, Defender
    // scanning), so show explicit progress feedback instead of leaving the
    // terminal looking frozen.
    if (shouldRemoveWorktree && worktreeSession) {
      process.stdout.write("\nDeleting worktree ...\n");
      process.chdir(worktreeSession.repoRoot);
      // "Done." only when it is: removal is best-effort, and a surviving
      // directory (with its branch kept for it) needs the cleanup commands
      // printed rather than a success line over the leftovers.
      process.stdout.write(
        (await removeWorktree(worktreeSession))
          ? "Done.\n"
          : `\n${describeWorktreeSurvival(worktreeSession)}\n`,
      );
    }

    process.exit(0);
  } catch (error: unknown) {
    console.error("Error during cleanup:", error);
    process.exit(1);
  }
}
