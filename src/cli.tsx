import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { SessionManager, type SessionData } from "./services/sessionManager.js";
import { PathValidator } from "./utils/pathValidator.js";
import { cleanupLogs } from "./utils/logger.js";

export interface CliOptions {
  workdir: string;
  ignore?: string[];
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

export async function startCli(options: CliOptions): Promise<void> {
  let { workdir, ignore } = options;
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
        sessionToRestore = await SessionManager.getLatestSession();
        if (!sessionToRestore) {
          console.error("No previous session found.");
          process.exit(1);
        }
      }

      if (sessionToRestore) {
        // Validate the session's workdir
        const pathValidation = await PathValidator.validatePath(
          sessionToRestore.metadata.workdir,
        );

        if (pathValidation.isValid) {
          // Use session's workdir and ignore patterns
          workdir = pathValidation.resolvedPath!;
          ignore = sessionToRestore.metadata.ignore || ignore;
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

  // Clean up expired sessions in background
  SessionManager.cleanupExpiredSessions().catch((error) => {
    console.warn("Failed to cleanup expired sessions:", error);
  });

  // Clean up old log files in background
  cleanupLogs().catch((error) => {
    console.warn("Failed to cleanup old logs:", error);
  });

  // Render the application
  render(
    <App
      workdir={workdir}
      ignore={ignore}
      sessionToRestore={sessionToRestore}
    />,
  );

  // Return a promise that never resolves to keep the CLI running
  return new Promise(() => {});
}
