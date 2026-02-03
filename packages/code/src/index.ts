import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import {
  listSessions,
  getSessionFilePath,
  getFirstMessageContent,
  Scope,
} from "wave-agent-sdk";

// Export main function for external use
export async function main() {
  const argv = await yargs(hideBin(process.argv))
    .option("restore", {
      alias: "r",
      description: "Restore session by ID (or list sessions if no ID provided)",
      type: "string",
      global: false,
    })
    .option("continue", {
      alias: "c",
      description: "Continue from last session",
      type: "boolean",
      global: false,
    })
    .option("print", {
      alias: "p",
      description: "Print response without interactive mode",
      type: "string",
      global: false,
    })
    .option("show-stats", {
      description: "Show timing and usage statistics in print mode",
      type: "boolean",
      global: false,
    })
    .option("dangerously-skip-permissions", {
      description: "Skip all permission checks (dangerous)",
      type: "boolean",
      default: false,
      global: false,
    })
    .option("plugin-dir", {
      description: "Load a plugin from a specific directory",
      type: "array",
      string: true,
      global: false,
    })
    .command(
      "plugin",
      "Manage plugins and marketplaces",
      (yargs) => {
        return yargs
          .help()
          .command(
            "marketplace",
            "Manage plugin marketplaces",
            (yargs) => {
              return yargs
                .help()
                .command(
                  "add <input>",
                  "Add a plugin marketplace (local path, owner/repo, or Git URL)",
                  (yargs) => {
                    return yargs.positional("input", {
                      describe:
                        "Path to local marketplace, GitHub owner/repo, or full Git URL (with optional #ref)",
                      type: "string",
                    });
                  },
                  async (argv) => {
                    const { addMarketplaceCommand } = await import(
                      "./commands/plugin/marketplace.js"
                    );
                    await addMarketplaceCommand(argv as { input: string });
                  },
                )
                .command(
                  "update [name]",
                  "Update registered marketplace(s)",
                  (yargs) => {
                    return yargs.positional("name", {
                      describe: "Name of the marketplace to update",
                      type: "string",
                    });
                  },
                  async (argv) => {
                    const { updateMarketplaceCommand } = await import(
                      "./commands/plugin/marketplace.js"
                    );
                    await updateMarketplaceCommand(argv as { name?: string });
                  },
                )
                .command(
                  "list",
                  "List registered marketplaces",
                  {},
                  async () => {
                    const { listMarketplacesCommand } = await import(
                      "./commands/plugin/marketplace.js"
                    );
                    await listMarketplacesCommand();
                  },
                )
                .demandCommand(1, "Please specify a marketplace subcommand");
            },
            () => {},
          )
          .command(
            "install <plugin>",
            "Install a plugin from a marketplace",
            (yargs) => {
              return yargs
                .positional("plugin", {
                  describe: "Plugin to install (format: name@marketplace)",
                  type: "string",
                })
                .option("scope", {
                  alias: "s",
                  describe: "Scope to enable the plugin in",
                  choices: ["user", "project", "local"],
                  default: "user",
                  type: "string",
                });
            },
            async (argv) => {
              const { installPluginCommand } = await import(
                "./commands/plugin/install.js"
              );
              await installPluginCommand(
                argv as {
                  plugin: string;
                  scope?: Scope;
                },
              );
            },
          )
          .command(
            "list",
            "List all available plugins from marketplaces",
            {},
            async () => {
              const { listPluginsCommand } = await import(
                "./commands/plugin/list.js"
              );
              await listPluginsCommand();
            },
          )
          .command(
            "enable <plugin>",
            "Enable a plugin in a specific scope",
            (yargs) => {
              return yargs
                .positional("plugin", {
                  describe: "Plugin ID (format: name@marketplace)",
                  type: "string",
                })
                .option("scope", {
                  alias: "s",
                  describe: "Scope to enable the plugin in",
                  choices: ["user", "project", "local"],
                  default: "user",
                  type: "string",
                });
            },
            async (argv) => {
              const { enablePluginCommand } = await import(
                "./commands/plugin/enable.js"
              );
              await enablePluginCommand(
                argv as {
                  plugin: string;
                  scope: Scope;
                },
              );
            },
          )
          .command(
            "disable <plugin>",
            "Disable a plugin in a specific scope",
            (yargs) => {
              return yargs
                .positional("plugin", {
                  describe: "Plugin ID (format: name@marketplace)",
                  type: "string",
                })
                .option("scope", {
                  alias: "s",
                  describe: "Scope to disable the plugin in",
                  choices: ["user", "project", "local"],
                  default: "user",
                  type: "string",
                });
            },
            async (argv) => {
              const { disablePluginCommand } = await import(
                "./commands/plugin/disable.js"
              );
              await disablePluginCommand(
                argv as {
                  plugin: string;
                  scope: Scope;
                },
              );
            },
          )
          .demandCommand(1, "Please specify a plugin subcommand");
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
    .help("h")
    .recommendCommands()
    .strict()
    .parseAsync();

  // Handle restore session command
  if (
    argv.restore === "" ||
    (process.argv.includes("-r") && argv.restore === undefined) ||
    (process.argv.includes("--restore") && argv.restore === undefined)
  ) {
    if (argv.print !== undefined) {
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
          const filePath = await getSessionFilePath(
            session.id,
            session.workdir,
          );

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
    } else {
      // Interactive session selection
      const { startSessionSelectorCli } = await import(
        "./session-selector-cli.js"
      );
      const selectedSessionId = await startSessionSelectorCli();
      if (!selectedSessionId) {
        return;
      }
      // Continue with the selected session
      return startCli({
        restoreSessionId: selectedSessionId,
        bypassPermissions: argv.dangerouslySkipPermissions,
        pluginDirs: argv.pluginDir as string[],
      });
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
