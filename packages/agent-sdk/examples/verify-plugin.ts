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
import type {} from "../src/types/index.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";
import * as path from "path";
import { fileURLToPath } from "url";
import { Container } from "../src/utils/container.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workdir = path.resolve(__dirname, "complex-plugin");

async function verify() {
  const container = new Container();

  const skillManager = new SkillManager(container, { workdir });
  const hookManager = new HookManager(container, workdir, new HookMatcher());
  const lspManager = new LspManager(container);
  const mcpManager = new McpManager(container);

  const messageManager = {
    addUserMessage: console.log,
    addErrorBlock: console.error,
    clearMessages: () => {},
    triggerSlashCommandsChange: () => {},
  } as unknown as MessageManager;
  const aiManager = {
    sendAIMessage: async () => {},
    abortAIMessage: () => {},
  } as unknown as AIManager;
  const backgroundTaskManager = {
    getAllTasks: () => [],
  } as unknown as BackgroundTaskManager;
  const taskManager = new TaskManager(container, "test-task-list");

  container.register("MessageManager", messageManager);
  container.register("AIManager", aiManager);
  container.register("BackgroundTaskManager", backgroundTaskManager);
  container.register("TaskManager", taskManager);
  container.register("SkillManager", skillManager);
  container.register("HookManager", hookManager);
  container.register("LspManager", lspManager);
  container.register("McpManager", mcpManager);

  const slashCommandManager = new SlashCommandManager(container, {
    workdir,
  });
  container.register("SlashCommandManager", slashCommandManager);

  const pluginManager = new PluginManager(container, {
    workdir,
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
