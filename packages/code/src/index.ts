import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import {
  listSessions,
  getSessionFilePath,
  getFirstMessageContent,
} from "wave-agent-sdk";

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
    .option("print", {
      alias: "p",
      description: "Print response without interactive mode",
      type: "string",
    })
    .option("show-stats", {
      description: "Show timing and usage statistics in print mode",
      type: "boolean",
    })
    .option("list-sessions", {
      description: "List all available sessions",
      type: "boolean",
    })
    .option("dangerously-skip-permissions", {
      description: "Skip all permission checks (dangerous)",
      type: "boolean",
      default: false,
    })
    .option("plugin-dir", {
      description: "Load a plugin from a specific directory",
      type: "array",
      string: true,
    })
    .command(
      "plugin",
      "Manage plugins and marketplaces",
      (yargs) => {
        return yargs
          .command(
            "marketplace",
            "Manage plugin marketplaces",
            (yargs) => {
              return yargs
                .command(
                  "add <path>",
                  "Add a local plugin marketplace",
                  (yargs) => {
                    return yargs.positional("path", {
                      describe: "Path to the local marketplace directory",
                      type: "string",
                    });
                  },
                  async (argv) => {
                    const { MarketplaceService } = await import(
                      "wave-agent-sdk"
                    );
                    const service = new MarketplaceService();
                    try {
                      const marketplace = await service.addMarketplace(
                        argv.path as string,
                      );
                      console.log(
                        `Successfully added marketplace: ${marketplace.name} (${marketplace.path})`,
                      );
                      process.exit(0);
                    } catch (error) {
                      const message =
                        error instanceof Error ? error.message : String(error);
                      console.error(`Failed to add marketplace: ${message}`);
                      process.exit(1);
                    }
                  },
                )
                .command(
                  "list",
                  "List registered marketplaces",
                  {},
                  async () => {
                    const { MarketplaceService } = await import(
                      "wave-agent-sdk"
                    );
                    const service = new MarketplaceService();
                    const marketplaces = await service.listMarketplaces();
                    if (marketplaces.length === 0) {
                      console.log("No marketplaces registered.");
                    } else {
                      console.log("Registered Marketplaces:");
                      marketplaces.forEach((m) => {
                        console.log(`- ${m.name}: ${m.path}`);
                      });
                    }
                    process.exit(0);
                  },
                );
            },
            () => {},
          )
          .command(
            "install <plugin>",
            "Install a plugin from a marketplace",
            (yargs) => {
              return yargs.positional("plugin", {
                describe: "Plugin to install (format: name@marketplace)",
                type: "string",
              });
            },
            async (argv) => {
              const { MarketplaceService } = await import("wave-agent-sdk");
              const service = new MarketplaceService();
              try {
                const installed = await service.installPlugin(
                  argv.plugin as string,
                );
                console.log(
                  `Successfully installed plugin: ${installed.name} v${installed.version} from ${installed.marketplace}`,
                );
                console.log(`Cache path: ${installed.cachePath}`);
                process.exit(0);
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : String(error);
                console.error(`Failed to install plugin: ${message}`);
                process.exit(1);
              }
            },
          )
          .command("list", "List installed plugins", {}, async () => {
            const { MarketplaceService } = await import("wave-agent-sdk");
            const service = new MarketplaceService();
            const plugins = await service.getInstalledPlugins();
            if (plugins.plugins.length === 0) {
              console.log("No plugins installed.");
            } else {
              console.log("Installed Plugins:");
              plugins.plugins.forEach((p) => {
                console.log(`- ${p.name} v${p.version} (@${p.marketplace})`);
              });
            }
            process.exit(0);
          });
      },
      () => {},
    )
    .version()
    .alias("v", "version")
    .example("$0", "Start CLI with default settings")
    .example("$0 --restore session_123", "Restore specific session")
    .example("$0 --continue", "Continue from last session")
    .example("$0 --print 'Hello'", "Send message in print mode")
    .example(
      "$0 -p 'Hello' --show-stats",
      "Send message in print mode with statistics",
    )
    .example("$0 --list-sessions", "List all available sessions")
    .help("h")
    .parseAsync();

  // Handle list sessions command
  if (argv.listSessions) {
    try {
      const currentWorkdir = process.cwd();
      const sessions = await listSessions(currentWorkdir);

      if (sessions.length === 0) {
        console.log(`No sessions found for workdir: ${currentWorkdir}`);
        return;
      }

      console.log(`Available sessions for: ${currentWorkdir}`);
      console.log("==========================================");

      // Get last 5 sessions
      const lastSessions = sessions.slice(0, 5);

      for (const session of lastSessions) {
        const lastActiveAt = new Date(session.lastActiveAt).toLocaleString();
        const filePath = await getSessionFilePath(session.id, session.workdir);

        // Get first message content
        const firstMessageContent = await getFirstMessageContent(
          session.id,
          session.workdir,
        );

        // Truncate content if too long
        let truncatedContent =
          firstMessageContent || "No first message content";
        if (truncatedContent.length > 30) {
          truncatedContent = truncatedContent.substring(0, 30) + "...";
        }

        console.log(`ID: ${session.id}`);
        console.log(`  Workdir: ${session.workdir}`);
        console.log(`  File Path: ${filePath}`);
        console.log(`  Last Active: ${lastActiveAt}`);
        console.log(`  Last Message Tokens: ${session.latestTotalTokens}`);
        console.log(`  First Message: ${truncatedContent}`);
        console.log("");
      }

      if (sessions.length > 5) {
        console.log(`... and ${sessions.length - 5} more sessions`);
      }

      return;
    } catch (error) {
      console.error("Failed to list sessions:", error);
      process.exit(1);
    }
  }

  // Handle print mode directly
  if (argv.print !== undefined) {
    const { startPrintCli } = await import("./print-cli.js");
    return startPrintCli({
      restoreSessionId: argv.restore,
      continueLastSession: argv.continue,
      message: argv.print,
      showStats: argv.showStats,
      bypassPermissions: argv.dangerouslySkipPermissions,
      pluginDirs: argv.pluginDir as string[],
    });
  }

  await startCli({
    restoreSessionId: argv.restore,
    continueLastSession: argv.continue,
    bypassPermissions: argv.dangerouslySkipPermissions,
    pluginDirs: argv.pluginDir as string[],
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
