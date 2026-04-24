/**
 * Verifies that plugin agents are loaded correctly and ${WAVE_PLUGIN_ROOT}
 * is substituted in agent system prompts.
 */
import { PluginManager } from "../src/managers/pluginManager.js";
import { SkillManager } from "../src/managers/skillManager.js";
import { HookManager } from "../src/managers/hookManager.js";
import { LspManager } from "../src/managers/lspManager.js";
import { McpManager } from "../src/managers/mcpManager.js";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { SubagentManager } from "../src/managers/subagentManager.js";
import { TaskManager } from "../src/services/taskManager.js";
import { MessageManager } from "../src/managers/messageManager.js";
import { AIManager } from "../src/managers/aiManager.js";
import { HookMatcher } from "../src/utils/hookMatcher.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";
import { NotificationQueue } from "../src/managers/notificationQueue.js";
import * as path from "path";
import { fileURLToPath } from "url";
import { Container } from "../src/utils/container.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginDir = path.resolve(__dirname, "plugin-agent-demo");
const workdir = path.resolve(__dirname);

async function verify() {
  const container = new Container();

  const skillManager = new SkillManager(container, { workdir });
  const hookManager = new HookManager(container, workdir, new HookMatcher());
  const lspManager = new LspManager(container);
  const mcpManager = new McpManager(container);
  const subagentManager = new SubagentManager(container, {
    workdir,
    stream: false,
  });

  // Initialize SubagentManager to load and cache configurations
  await subagentManager.initialize();

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
  const notificationQueue = new NotificationQueue();

  container.register("MessageManager", messageManager);
  container.register("AIManager", aiManager);
  container.register("BackgroundTaskManager", backgroundTaskManager);
  container.register("TaskManager", taskManager);
  container.register("SkillManager", skillManager);
  container.register("HookManager", hookManager);
  container.register("LspManager", lspManager);
  container.register("McpManager", mcpManager);
  container.register("SubagentManager", subagentManager);
  container.register("NotificationQueue", notificationQueue);

  const slashCommandManager = new SlashCommandManager(container, {
    workdir,
  });
  container.register("SlashCommandManager", slashCommandManager);

  const pluginManager = new PluginManager(container, {
    workdir,
  });

  console.log("Loading plugin-agent-demo plugin...");
  await pluginManager.loadPlugins([{ type: "local", path: pluginDir }]);

  const plugins = pluginManager.getPlugins();
  console.log(`Loaded ${plugins.length} plugins`);

  if (plugins.length === 0) {
    throw new Error("Failed to load plugin");
  }

  const plugin = plugins[0];
  console.log(`Plugin: ${plugin.name}`);
  console.log(`- Agents: ${plugin.agents.length}`);

  if (plugin.agents.length === 0) {
    throw new Error("Plugin agents not loaded");
  }

  // Verify agent was loaded from the agents/ directory
  const researcher = plugin.agents.find((a) => a.name === "researcher");
  if (!researcher) {
    throw new Error("researcher agent not found");
  }
  console.log(`- Agent name: ${researcher.name}`);
  console.log(`- Agent scope: ${researcher.scope}`);
  console.log(`- Agent pluginRoot: ${researcher.pluginRoot}`);

  // Verify ${WAVE_PLUGIN_ROOT} was substituted at parse time
  if (researcher.systemPrompt.includes("${WAVE_PLUGIN_ROOT}")) {
    throw new Error(
      "WAVE_PLUGIN_ROOT was not substituted in agent systemPrompt",
    );
  }
  const expectedPath = plugin.path + "/data";
  if (!researcher.systemPrompt.includes(expectedPath)) {
    throw new Error(
      `Expected systemPrompt to contain "${expectedPath}" but got: ${researcher.systemPrompt}`,
    );
  }
  console.log(`- System prompt contains correct path: ${expectedPath}`);

  // Verify agent is registered in SubagentManager with namespaced name
  const configs = subagentManager.getConfigurations();
  const namespacedAgent = configs.find(
    (c) => c.name === "plugin-agent-demo:researcher",
  );
  if (!namespacedAgent) {
    throw new Error("Plugin agent not found in SubagentManager configurations");
  }
  console.log(
    `✅ SubagentManager has namespaced agent: ${namespacedAgent.name}`,
  );

  // Verify WAVE_PLUGIN_ROOT substitution safety net in SubagentManager
  if (namespacedAgent.systemPrompt.includes("${WAVE_PLUGIN_ROOT}")) {
    throw new Error("WAVE_PLUGIN_ROOT not substituted in SubagentManager");
  }
  console.log(`✅ WAVE_PLUGIN_ROOT correctly substituted in SubagentManager`);

  // Verify findSubagent can find the plugin agent
  const found = await subagentManager.findSubagent(
    "plugin-agent-demo:researcher",
  );
  if (!found) {
    throw new Error("findSubagent could not find plugin agent");
  }
  console.log(`✅ findSubagent found: ${found.name}`);

  console.log("\nAll verifications passed!");
}

verify()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  });
