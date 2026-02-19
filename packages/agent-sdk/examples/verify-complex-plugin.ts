import { PluginManager } from "../src/managers/pluginManager.js";
import { SkillManager } from "../src/managers/skillManager.js";
import { HookManager } from "../src/managers/hookManager.js";
import { LspManager } from "../src/managers/lspManager.js";
import { McpManager } from "../src/managers/mcpManager.js";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { TaskManager } from "../src/services/taskManager.js";
import { MessageManager } from "../src/managers/messageManager.js";
import { AIManager } from "../src/managers/aiManager.js";
import { Logger, LspConfig, McpServerStatus } from "../src/types/index.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function verify() {
  const workdir = path.resolve(__dirname, "complex-plugin");
  const logger: Logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log,
  };

  const skillManager = new SkillManager({ workdir, logger });
  (skillManager as unknown as { initialized: boolean }).initialized = true; // Force initialized for verification
  const hookManager = new HookManager(workdir, undefined, logger);
  const lspManager = new LspManager({ logger });
  const mcpManager = new McpManager({ logger });

  // Mock managers that are not fully implemented or needed for simple verification
  const slashCommandManager = new SlashCommandManager({
    messageManager: {} as unknown as MessageManager,
    aiManager: {} as unknown as AIManager,
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

  console.log("\n--- Verification ---");

  // Verify Commands
  const customCommands = slashCommandManager.getCustomCommands();
  const hasHello = customCommands.some((c) => c.name === "hello");
  console.log(`Commands loaded: ${hasHello ? "✅" : "❌"}`);

  // Verify Skills
  const skills = skillManager.getAvailableSkills();
  const hasTestSkill = skills.some((s) => s.name === "test-skill");
  console.log(`Skills loaded: ${hasTestSkill ? "✅" : "❌"}`);

  // Verify Hooks
  const hasHooks = hookManager.hasHooks("UserPromptSubmit");
  console.log(`Hooks loaded: ${hasHooks ? "✅" : "❌"}`);

  // Verify LSP
  const lspConfig = (lspManager as unknown as { config: LspConfig }).config;
  const hasLsp = lspConfig && lspConfig["testlang"];
  console.log(`LSP loaded: ${hasLsp ? "✅" : "❌"}`);

  // Verify MCP
  const mcpServers = (
    mcpManager as unknown as { servers: Map<string, McpServerStatus> }
  ).servers;
  const hasMcp = mcpServers && mcpServers.has("test-server");
  console.log(`MCP loaded: ${hasMcp ? "✅" : "❌"}`);

  if (hasHello && hasTestSkill && hasHooks && hasLsp && hasMcp) {
    console.log("\nAll components loaded successfully! 🎉");
    process.exit(0);
  } else {
    console.error("\nSome components failed to load.");
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error(err);
  process.exit(1);
});
