import React from "react";
import { render } from "ink";
import { App } from "./components/App.js";
import { cleanupLogs } from "wave-agent-sdk";

export interface CliOptions {
  restoreSessionId?: string;
  continueLastSession?: boolean;
}

export async function startCli(options: CliOptions): Promise<void> {
  const { restoreSessionId, continueLastSession } = options;

  // Global cleanup tracker
  let isCleaningUp = false;
  let appUnmounted = false;

  const cleanup = async () => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    console.log("\nShutting down gracefully...");

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
    <App
      restoreSessionId={restoreSessionId}
      continueLastSession={continueLastSession}
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
