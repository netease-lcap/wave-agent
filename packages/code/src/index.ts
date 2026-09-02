import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { startCli } from "./cli.js";
import {
  Scope,
  generateRandomName,
  loadMergedWaveConfig,
  type PermissionMode,
} from "wave-agent-sdk";
import { createWorktree, type WorktreeSession } from "./utils/worktree.js";
import path from "path";
import { pathToFileURL } from "url";
import { readNearestPackageJson } from "./utils/readPackageJson.js";

const version = readNearestPackageJson().version;

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
      .option("stdio", {
        description: "Start in stdio mode (JSON-RPC over stdin/stdout)",
        type: "boolean",
        default: false,
        global: false,
      })
      .option("daemon", {
        description:
          "Start as a background daemon (JSON-RPC over a unix socket at PATH)",
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
      .option("permission-mode", {
        description: "Permission mode to use for the session",
        choices: [
          "acceptEdits",
          "bypassPermissions",
          "default",
          "dontAsk",
          "plan",
        ],
        type: "string",
        global: false,
      })
      .option("plugin-dir", {
        description: "Load a plugin from a specific directory",
        type: "array",
        string: true,
        global: false,
      })
      .option("add-dir", {
        description: "Add a directory to the session Safe Zone (repeatable)",
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
      .option("allowed-tools", {
        description:
          "Specify a comma-separated list of tools to always allow (e.g., 'Bash(ls),Read')",
        type: "string",
        global: false,
      })
      .option("disallowed-tools", {
        description:
          "Specify a comma-separated list of tools to always disallow (e.g., 'Bash(rm *),Write')",
        type: "string",
        global: false,
      })
      .option("model", {
        description: "Specify the AI model to use",
        type: "string",
        global: false,
      })
      .option("mcp-config", {
        description:
          "MCP server configuration as JSON string (same format as .mcp.json)",
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
      .command(
        "daemon",
        "Manage the wave daemon (client subcommands — to START a daemon use `wave --daemon <socket>` instead)",
        (yargs) => {
          return yargs
            .help()
            .command(
              "create",
              "Create a new session hosted by the daemon and print its sessionId",
              (yargs) => {
                return yargs
                  .option("workdir", {
                    describe:
                      "Working directory for the new session (default: current directory)",
                    type: "string",
                  })
                  .option("permission-mode", {
                    describe:
                      "Permission mode for the new session (default: bypassPermissions; options: default, bypassPermissions, acceptEdits, plan, dontAsk)",
                    type: "string",
                  })
                  .option("model", {
                    describe:
                      "Model override for the new session (default: configured model)",
                    type: "string",
                  })
                  .option("worktree", {
                    describe:
                      "Create the session in a new git worktree (name optional — auto-generated when omitted)",
                    type: "string",
                  });
              },
              async (argv) => {
                const { daemonCreateCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonCreateCommand(DEFAULT_DAEMON_SOCKET, {
                  workdir: argv.workdir as string | undefined,
                  permissionMode: argv.permissionMode as string | undefined,
                  model: argv.model as string | undefined,
                  worktree: argv.worktree as string | undefined,
                });
              },
            )
            .command(
              "list",
              "List sessions hosted by the daemon (in-memory registry)",
              {},
              async () => {
                const { daemonListCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonListCommand(DEFAULT_DAEMON_SOCKET);
              },
            )
            .command(
              "status <sessionId>",
              "Show a session's progress and recent messages",
              (yargs) => {
                return yargs
                  .positional("sessionId", {
                    describe: "Session ID hosted by the daemon",
                    type: "string",
                  })
                  .option("lines", {
                    describe: "Number of recent messages to show",
                    default: 20,
                    type: "number",
                  });
              },
              async (argv) => {
                const { daemonStatusCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonStatusCommand(
                  DEFAULT_DAEMON_SOCKET,
                  argv.sessionId as string,
                  argv.lines as number,
                );
              },
            )
            .command(
              "send <sessionId> <message>",
              "Inject a message into a session (async by default; --wait N to get the reply)",
              (yargs) => {
                return yargs
                  .positional("sessionId", {
                    describe: "Session ID hosted by the daemon",
                    type: "string",
                  })
                  .positional("message", {
                    describe: "Message to send",
                    type: "string",
                  })
                  .option("wait", {
                    describe:
                      "Seconds to wait for the reply and print it (0 = fire-and-forget, the default)",
                    default: 0,
                    type: "number",
                  });
              },
              async (argv) => {
                const { daemonSendCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonSendCommand(
                  DEFAULT_DAEMON_SOCKET,
                  argv.sessionId as string,
                  argv.message as string,
                  { wait: argv.wait as number },
                );
              },
            )
            .command(
              "respond <sessionId> <requestId>",
              "Respond to a pending permission request",
              (yargs) => {
                return yargs
                  .positional("sessionId", {
                    describe: "Session ID hosting the pending request",
                    type: "string",
                  })
                  .positional("requestId", {
                    describe: "Pending permission request ID",
                    type: "string",
                  })
                  .option("allow", {
                    describe: "Allow the operation",
                    type: "boolean",
                  })
                  .option("deny", {
                    describe: "Deny the operation",
                    type: "boolean",
                  })
                  .option("reason", {
                    describe: "Reason for the decision (deny)",
                    type: "string",
                  })
                  .option("answer", {
                    describe:
                      'AskUserQuestion answers: JSON object of {question: answer} or option numbers per question (e.g. "0" or "1,0")',
                    type: "string",
                  })
                  .option("rule", {
                    describe: "Persist an allowed rule (e.g. Bash(ls))",
                    type: "string",
                  })
                  .option("mode", {
                    describe: "Switch the session's permission mode",
                    type: "string",
                  });
              },
              async (argv) => {
                const { daemonRespondCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonRespondCommand(
                  DEFAULT_DAEMON_SOCKET,
                  argv.sessionId as string,
                  argv.requestId as string,
                  {
                    allow: argv.allow as boolean | undefined,
                    deny: argv.deny as boolean | undefined,
                    reason: argv.reason as string | undefined,
                    answer: argv.answer as string | undefined,
                    rule: argv.rule as string | undefined,
                    mode: argv.mode as string | undefined,
                  },
                );
              },
            )
            .command(
              "abort <sessionId>",
              "Abort the session's in-flight message generation",
              (yargs) => {
                return yargs.positional("sessionId", {
                  describe: "Session ID hosted by the daemon",
                  type: "string",
                });
              },
              async (argv) => {
                const { daemonAbortCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonAbortCommand(
                  DEFAULT_DAEMON_SOCKET,
                  argv.sessionId as string,
                );
              },
            )
            .command(
              "destroy <sessionId>",
              "Destroy a daemon session (idempotent)",
              (yargs) => {
                return yargs
                  .positional("sessionId", {
                    describe: "Session ID of the session to destroy",
                    type: "string",
                  })
                  .option("remove-worktree", {
                    describe:
                      "Also remove the session's git worktree (resolved via git, removed via protocol removeWorktree) before destroying",
                    type: "boolean",
                  });
              },
              async (argv) => {
                const { daemonDestroyCommand, DEFAULT_DAEMON_SOCKET } =
                  await import("./daemon/commands.js");
                await daemonDestroyCommand(
                  DEFAULT_DAEMON_SOCKET,
                  argv.sessionId as string,
                  {
                    removeWorktree: argv.removeWorktree as boolean | undefined,
                  },
                );
              },
            )
            .demandCommand(1, "Please specify a daemon subcommand");
        },
      )
      .command(
        "update",
        "Update WAVE Code to the latest version",
        {},
        async () => {
          const { updateCommand } = await import("./commands/update.js");
          await updateCommand();
        },
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

    const parseTools = (tools: string | undefined): string[] | undefined => {
      if (tools === undefined || tools === "default") return undefined;
      if (tools === "") return [];

      // Improved parsing to handle commas inside parentheses
      const result: string[] = [];
      let current = "";
      let depth = 0;
      for (let i = 0; i < tools.length; i++) {
        const char = tools[i];
        if (char === "(") depth++;
        else if (char === ")") depth--;

        if (char === "," && depth === 0) {
          result.push(current.trim());
          current = "";
        } else {
          current += char;
        }
      }
      if (current.trim()) {
        result.push(current.trim());
      }
      return result;
    };

    const tools = parseTools(argv.tools as string | undefined);
    const allowedTools = parseTools(argv.allowedTools as string | undefined);
    const disallowedTools = parseTools(
      argv.disallowedTools as string | undefined,
    );

    // Parse MCP server configuration from --mcp-config JSON string
    let mcpServers:
      | Record<string, import("wave-agent-sdk").McpServerConfig>
      | undefined;
    if (argv.mcpConfig) {
      try {
        const parsed = JSON.parse(argv.mcpConfig as string);
        mcpServers = parsed.mcpServers || parsed;
      } catch {
        console.error("Failed to parse --mcp-config as JSON");
        process.exit(1);
      }
    }

    // Resolve plugin directories to absolute paths before any worktree logic
    const pluginDirs = (argv.pluginDir as string[] | undefined)?.map((dir) =>
      path.resolve(originalCwd, dir),
    );

    // Resolve additional directories to absolute paths (relative to the
    // original working directory, before any worktree change)
    const additionalDirectories = (argv.addDir as string[] | undefined)?.map(
      (dir) => path.resolve(originalCwd, dir),
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
      const baseRef = loadMergedWaveConfig(originalCwd)?.worktree?.baseRef;
      worktreeSession = await createWorktree(name, originalCwd, { baseRef });

      // Note: the full worktree session (originalCwd etc.) is injected into the
      // agent's DI container after the agent is created in useChat.tsx. This keeps
      // worktree state per-session instead of process-global.
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
      const { listWorktrees } = await import("./utils/worktree.js");
      const worktreePaths = await listWorktrees(process.cwd());
      const selection = await startSessionSelectorCli({
        workdir,
        worktreePaths,
      });
      if (!selection) {
        return;
      }

      // Resume a session from a sibling worktree of the same repo — chdir into
      // that worktree so the agent's workdir matches the session's origin
      // (mirrors Claude Code's worktree resume; projectRoot is not set, so
      // skills/history stay anchored to the original project).
      let resumeWorkdir = workdir;
      if (selection.resumeWorkdir) {
        resumeWorkdir = selection.resumeWorkdir;
        process.chdir(resumeWorkdir);
      }

      // Continue with the selected session
      return startCli({
        restoreSessionId: selection.sessionId,
        bypassPermissions: argv.dangerouslySkipPermissions as boolean,
        permissionMode: argv.permissionMode as PermissionMode | undefined,
        pluginDirs,
        additionalDirectories,
        tools,
        allowedTools,
        disallowedTools,
        worktreeSession,
        workdir: resumeWorkdir,
        originalCwd,
        version,
        model: argv.model as string | undefined,
        mcpServers,
      });
    }

    // Validate an explicitly-specified restore ID before entering the CLI —
    // loadSessionFromJsonl scans every project dir as a fallback, so a miss
    // here means the session truly does not exist. Fail fast with a clear
    // error instead of silently starting a fresh session.
    if (
      typeof argv.restore === "string" &&
      argv.restore !== "" &&
      !argv.print
    ) {
      const { loadSessionFromJsonl } = await import("wave-agent-sdk");
      const exists = await loadSessionFromJsonl(argv.restore, workdir);
      if (!exists) {
        console.error(`Session ${argv.restore} not found on disk.`);
        process.exit(1);
      }
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
        permissionMode: argv.permissionMode as PermissionMode | undefined,
        pluginDirs,
        additionalDirectories,
        tools,
        allowedTools,
        disallowedTools,
        worktreeSession,
        workdir,
        originalCwd,
        version,
        model: argv.model as string | undefined,
        mcpServers,
      });
    }

    // Handle stdio mode
    if (argv.stdio) {
      const { startStdioCli } = await import("./stdio-cli.js");
      return startStdioCli();
    }

    // Handle daemon mode (remote background sessions)
    if (typeof argv.daemon === "string") {
      const { startDaemonCli } = await import("./daemon-cli.js");
      return startDaemonCli(argv.daemon);
    }

    await startCli({
      restoreSessionId: argv.restore as string | undefined,
      continueLastSession: argv.continue as boolean | undefined,
      bypassPermissions: argv.dangerouslySkipPermissions as boolean | undefined,
      permissionMode: argv.permissionMode as PermissionMode | undefined,
      pluginDirs,
      additionalDirectories,
      tools,
      allowedTools,
      disallowedTools,
      worktreeSession,
      workdir,
      originalCwd,
      version,
      model: argv.model as string | undefined,
      mcpServers,
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

// Execute main function if this file is run directly. Compare via
// pathToFileURL: on Windows process.argv[1] keeps backslashes while
// import.meta.url is a forward-slash file:// URL, so a naive string
// concatenation never matches and main() silently never runs.
const entryFile = process.argv[1];
if (
  entryFile &&
  pathToFileURL(path.resolve(entryFile)).href === import.meta.url
) {
  main().catch((error) => {
    console.error("Failed to start WAVE Code:", error);
    process.exit(1);
  });
}
