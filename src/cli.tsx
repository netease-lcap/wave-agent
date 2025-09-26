import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { SessionManager, type SessionData } from "./services/sessionManager.js";
import { PathValidator } from "./utils/path.js";
import { cleanupLogs } from "./utils/logger.js";

export interface CliOptions {
  workdir: string;
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

export async function startCli(options: CliOptions): Promise<void> {
  let { workdir } = options;
  const { restoreSessionId, continueLastSession } = options;
  let sessionToRestore: SessionData | null = null;

  // Handle session restoration
  if (restoreSessionId || continueLastSession) {
    try {
      if (restoreSessionId) {
        sessionToRestore = await SessionManager.loadSession(restoreSessionId);
        if (!sessionToRestore) {
          console.error(`Session not found: ${restoreSessionId}`);
          process.exit(1);
        }
      } else if (continueLastSession) {
        sessionToRestore = await SessionManager.getLatestSession(workdir);
        if (!sessionToRestore) {
          console.error(`No previous session found for workdir: ${workdir}`);
          process.exit(1);
        }
      }

      if (sessionToRestore) {
        // Validate the session's workdir
        const pathValidation = await PathValidator.validatePath(
          sessionToRestore.metadata.workdir,
        );

        if (pathValidation.isValid) {
          // Use session's workdir
          workdir = pathValidation.resolvedPath!;
          console.log(`Restoring session: ${sessionToRestore.id}`);
          console.log(`Working directory: ${workdir}`);
        } else {
          // Session's workdir is invalid, ask user what to do
          console.warn(
            `Session workdir is invalid: ${sessionToRestore.metadata.workdir}`,
          );
          console.warn(`Error: ${pathValidation.error}`);
          console.log(`Using current directory instead: ${workdir}`);

          // Keep the current workdir but still restore session data
        }
      }
    } catch (error) {
      console.error("Failed to restore session:", error);
      process.exit(1);
    }
  }

  // Global cleanup tracker
  let isCleaningUp = false;
  let appUnmounted = false;

  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log("\nShutting down gracefully...");

    try {
      // Clean up expired sessions
      await SessionManager.cleanupExpiredSessions().catch((error) => {
        console.warn("Failed to cleanup expired sessions:", error);
      });

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
    } catch (error) {
      console.error("Error during cleanup:", error);
      process.exit(1);
    }
  };

  // Handle process signals
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
    cleanup();
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled rejection at:", promise, "reason:", reason);
    cleanup();
  });

  // Render the application
  const { unmount } = render(
    <App workdir={workdir} sessionToRestore={sessionToRestore} />,
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
