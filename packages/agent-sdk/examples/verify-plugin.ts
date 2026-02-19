import { PluginManager } from "../src/managers/pluginManager.js";
import { SkillManager } from "../src/managers/skillManager.js";
import { HookManager } from "../src/managers/hookManager.js";
import { LspManager } from "../src/managers/lspManager.js";
import { McpManager } from "../src/managers/mcpManager.js";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { TaskManager } from "../src/services/taskManager.js";
import { MessageManager } from "../src/managers/messageManager.js";
import { AIManager } from "../src/managers/aiManager.js";
import { HookMatcher } from "../src/utils/hookMatcher.js";
import type { Logger } from "../src/types/index.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workdir = path.resolve(__dirname, "complex-plugin");

async function verify() {
  const logger: Logger = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.log,
  };

  const skillManager = new SkillManager({ workdir, logger });
  const hookManager = new HookManager(workdir, new HookMatcher(), logger);
  const lspManager = new LspManager({ logger });
  const mcpManager = new McpManager({ logger });
  const slashCommandManager = new SlashCommandManager({
    messageManager: {
      addUserMessage: console.log,
      addErrorBlock: console.error,
      clearMessages: () => {},
    } as unknown as MessageManager,
    aiManager: {
      sendAIMessage: async () => {},
      abortAIMessage: () => {},
    } as unknown as AIManager,
    backgroundTaskManager: {
      getAllTasks: () => [],
    } as unknown as BackgroundTaskManager,
    taskManager: new TaskManager("test-task-list"),
    workdir,
    logger,
  });

  const pluginManager = new PluginManager({
    workdir,
    logger,
    skillManager,
    hookManager,
    lspManager,
    mcpManager,
    slashCommandManager,
  });

  console.log("Loading complex-plugin...");
  await pluginManager.loadPlugins([{ type: "local", path: "." }]);

  const plugins = pluginManager.getPlugins();
  console.log(`Loaded ${plugins.length} plugins`);

  if (plugins.length === 0) {
    console.error("Failed to load plugin");
    process.exit(1);
  }

  const plugin = plugins[0];
  console.log("Plugin components:");
  console.log(`- Commands: ${plugin.commands.length}`);
  console.log(`- Skills: ${plugin.skills.length}`);
  console.log(`- LSP Config: ${plugin.lspConfig ? "Yes" : "No"}`);
  console.log(`- MCP Config: ${plugin.mcpConfig ? "Yes" : "No"}`);
  console.log(`- Hooks Config: ${plugin.hooksConfig ? "Yes" : "No"}`);

  // Verify registration
  if (plugin.commands.length === 0) throw new Error("Commands not loaded");
  if (plugin.skills.length === 0) throw new Error("Skills not loaded");
  if (!plugin.lspConfig) throw new Error("LSP config not loaded");
  if (!plugin.mcpConfig) throw new Error("MCP config not loaded");
  if (!plugin.hooksConfig) throw new Error("Hooks config not loaded");

  console.log("Verification successful!");
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
