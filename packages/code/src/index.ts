import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import { listSessions } from "wave-agent-sdk";

// Export main function for external use
export async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("restore", {
      alias: "r",
      description: "Restore session by ID",
      type: "string",
    })
    .option("continue", {
      alias: "c",
      description: "Continue from last session",
      type: "boolean",
    })
    .option("list-sessions", {
      description: "List all available sessions",
      type: "boolean",
    })
    .version()
    .alias("v", "version")
    .example("$0", "Start CLI with default settings")
    .example("$0 --restore session_123", "Restore specific session")
    .example("$0 --continue", "Continue from last session")
    .example("$0 --list-sessions", "List all available sessions")
    .help("h")
    .parseAsync();

  // Handle list sessions command
  if (argv.listSessions) {
    try {
      const sessions = await listSessions();

      if (sessions.length === 0) {
        console.log(`No sessions found for workdir: ${process.cwd()}`);
        return;
      }

      console.log(`Available sessions for: ${process.cwd()}`);
      console.log("==========================================");

      for (const session of sessions) {
        const startedAt = new Date(session.startedAt).toLocaleString();
        const lastActiveAt = new Date(session.lastActiveAt).toLocaleString();

        console.log(`ID: ${session.id}`);
        console.log(`  Workdir: ${session.workdir}`);
        console.log(`  Started: ${startedAt}`);
        console.log(`  Last Active: ${lastActiveAt}`);
        console.log(`  Last Message Tokens: ${session.latestTotalTokens}`);
        console.log("");
      }

      return;
    } catch (error) {
      console.error("Failed to list sessions:", error);
      process.exit(1);
    }
  }

  await startCli({
    restoreSessionId: argv.restore,
    continueLastSession: argv.continue,
  });
}

// Export CLI function
export { startCli } from "./cli.js";

// Export logger
export { logger } from "./utils/logger.js";

// Export clipboard utilities
export {
  readClipboardImage,
  cleanupTempImage,
  hasClipboardImage,
  type ClipboardImageResult,
} from "./utils/clipboard.js";

// Execute main function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Failed to start WAVE Code:", error);
    process.exit(1);
  });
}
