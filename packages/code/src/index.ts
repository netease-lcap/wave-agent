import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import { Scope, generateRandomName } from "wave-agent-sdk";
import { createWorktree, type WorktreeSession } from "./utils/worktree.js";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const version = packageJson.version;

// Export main function for external use
export async function main() {
  try {
    const originalCwd = process.cwd();
    const argv = await yargs(hideBin(process.argv))
      .option("restore", {
        alias: "r",
        description:
          "Restore session by ID (or list sessions if no ID provided)",
        type: "string",
        global: false,
      })
      .option("continue", {
        alias: "c",
        description: "Continue from last session",
        type: "boolean",
        global: false,
      })
      .option("worktree", {
        alias: "w",
        description: "Start session in a git worktree (optional name)",
        type: "string",
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
      .option("tools", {
        description:
          'Specify a comma-separated list of tools to enable (e.g., \'Bash,Read,Write\'). Use "" to disable all, "default" for all.',
        type: "string",
        global: false,
      })
      .option("model", {
        description: "Specify the AI model to use",
        type: "string",
        global: false,
      })
      .command("plugin", "Manage plugins and marketplaces", (yargs) => {
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
            "uninstall <plugin>",
            "Uninstall a plugin",
            (yargs) => {
              return yargs.positional("plugin", {
                describe: "Plugin to uninstall (format: name@marketplace)",
                type: "string",
              });
            },
            async (argv) => {
              const { uninstallPluginCommand } = await import(
                "./commands/plugin/uninstall.js"
              );
              await uninstallPluginCommand(argv as { plugin: string });
            },
          )
          .command(
            "update <plugin>",
            "Update a plugin (uninstall followed by install)",
            (yargs) => {
              return yargs.positional("plugin", {
                describe: "Plugin to update (format: name@marketplace)",
                type: "string",
              });
            },
            async (argv) => {
              const { updatePluginCommand } = await import(
                "./commands/plugin/update.js"
              );
              await updatePluginCommand(argv as { plugin: string });
            },
          );
      })
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

    const parseTools = (tools: string | undefined): string[] | undefined => {
      if (tools === undefined || tools === "default") return undefined;
      if (tools === "") return [];
      return tools.split(",").map((t) => t.trim());
    };

    const tools = parseTools(argv.tools as string | undefined);

    // Resolve plugin directories to absolute paths before any worktree logic
    const pluginDirs = (argv.pluginDir as string[] | undefined)?.map((dir) =>
      path.resolve(originalCwd, dir),
    );

    let worktreeSession: WorktreeSession | undefined;
    if (
      argv.worktree !== undefined ||
      process.argv.includes("-w") ||
      process.argv.includes("--worktree")
    ) {
      let name = argv.worktree as string | undefined;
      if (!name || name === "") {
        name = generateRandomName();
      }
      worktreeSession = createWorktree(name, originalCwd);
    }

    const workdir = worktreeSession?.path || originalCwd;

    if (worktreeSession) {
      process.chdir(workdir);
    }

    // Handle restore session command
    if (
      argv.restore === "" ||
      (process.argv.includes("-r") && argv.restore === undefined) ||
      (process.argv.includes("--restore") && argv.restore === undefined)
    ) {
      // Interactive session selection
      const { startSessionSelectorCli } = await import(
        "./session-selector-cli.js"
      );
      const selectedSessionId = await startSessionSelectorCli({ workdir });
      if (!selectedSessionId) {
        return;
      }
      // Continue with the selected session
      return startCli({
        restoreSessionId: selectedSessionId,
        bypassPermissions: argv.dangerouslySkipPermissions,
        pluginDirs,
        tools,
        worktreeSession,
        workdir,
        version,
        model: argv.model as string | undefined,
      });
    }

    // Handle print mode directly
    if (argv.print !== undefined) {
      const { startPrintCli } = await import("./print-cli.js");
      return startPrintCli({
        restoreSessionId: argv.restore as string | undefined,
        continueLastSession: argv.continue as boolean | undefined,
        message: argv.print,
        showStats: argv.showStats as boolean | undefined,
        bypassPermissions: argv.dangerouslySkipPermissions as
          | boolean
          | undefined,
        pluginDirs,
        tools,
        worktreeSession,
        workdir,
        version,
        model: argv.model as string | undefined,
      });
    }

    await startCli({
      restoreSessionId: argv.restore as string | undefined,
      continueLastSession: argv.continue as boolean | undefined,
      bypassPermissions: argv.dangerouslySkipPermissions as boolean | undefined,
      pluginDirs,
      tools,
      worktreeSession,
      workdir,
      version,
      model: argv.model as string | undefined,
    });
  } catch (error) {
    console.error("Failed to start WAVE Code:", error);
    process.exit(1);
  }
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
