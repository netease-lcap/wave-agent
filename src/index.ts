import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import { SessionManager } from "./services/sessionManager.js";

// Export main function for external use
export async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("workdir", {
      alias: "w",
      description: "Working directory path",
      type: "string",
      default: process.cwd(),
    })
    .option("ignore", {
      alias: "i",
      description: "Additional ignore patterns (can be used multiple times)",
      type: "array",
      string: true,
    })
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
    .example("$0", "Start CLI with default settings")
    .example("$0 --workdir /path/to/project", "Use custom working directory")
    .example(
      '$0 --ignore "*.log" --ignore "temp/*"',
      "Add custom ignore patterns",
    )
    .example("$0 --restore session_123", "Restore specific session")
    .example("$0 --continue", "Continue from last session")
    .example("$0 --list-sessions", "List all available sessions")
    .help()
    .parseAsync();

  // Handle list sessions command
  if (argv.listSessions) {
    try {
      const sessions = await SessionManager.listSessions(argv.workdir);

      if (sessions.length === 0) {
        console.log(`No sessions found for workdir: ${argv.workdir}`);
        return;
      }

      console.log(`Available sessions for: ${argv.workdir}`);
      console.log("==========================================");

      for (const session of sessions) {
        const startedAt = new Date(session.startedAt).toLocaleString();
        const lastActiveAt = new Date(session.lastActiveAt).toLocaleString();

        console.log(`ID: ${session.id}`);
        console.log(`  Workdir: ${session.workdir}`);
        console.log(`  Started: ${startedAt}`);
        console.log(`  Last Active: ${lastActiveAt}`);
        console.log(`  Last Message Tokens: ${session.totalTokens}`);
        console.log("");
      }

      return;
    } catch (error) {
      console.error("Failed to list sessions:", error);
      process.exit(1);
    }
  }

  await startCli({
    workdir: argv.workdir,
    ignore: argv.ignore as string[],
    restoreSessionId: argv.restore,
    continueLastSession: argv.continue,
  });
}

// Export other functions that might be needed
export { startCli } from "./cli.js";
export { SessionManager } from "./services/sessionManager.js";
export { FileManager, isDangerousDirectory } from "./services/fileManager.js";

// Execute main function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Failed to start LCAP Code:", error);
    process.exit(1);
  });
}
