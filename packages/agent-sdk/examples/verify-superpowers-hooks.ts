#!/usr/bin/env tsx

/**
 * Verify that the superpowers plugin hooks work correctly with Wave.
 *
 * This example:
 * 1. Loads the superpowers plugin from ~/github/superpowers
 * 2. Registers the hooks with HookManager
 * 3. Executes SessionStart hooks and verifies additionalContext output
 * 4. Logs each step for debugging
 */

import { PluginManager } from "../src/managers/pluginManager.js";
import { HookManager } from "../src/managers/hookManager.js";
import { SkillManager } from "../src/managers/skillManager.js";
import { LspManager } from "../src/managers/lspManager.js";
import { McpManager } from "../src/managers/mcpManager.js";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { TaskManager } from "../src/services/taskManager.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";
import type { MessageManager } from "../src/managers/messageManager.js";
import type { AIManager } from "../src/managers/aiManager.js";
import { HookMatcher } from "../src/utils/hookMatcher.js";
import { Container } from "../src/utils/container.js";
import * as path from "path";
import * as os from "os";

const SUPERPOWERS_PATH = path.join(os.homedir(), "github", "superpowers");

async function main() {
  const container = new Container();
  const workdir = process.cwd();

  // Create minimal mock managers
  const skillManager = new SkillManager(container, { workdir });
  const hookManager = new HookManager(container, workdir, new HookMatcher());
  const lspManager = new LspManager(container);
  const mcpManager = new McpManager(container);

  const messageManager = {
    addUserMessage: (msg: unknown) =>
      console.log("[MessageManager] addUserMessage:", msg),
    addErrorBlock: (msg: unknown) =>
      console.log("[MessageManager] addErrorBlock:", msg),
    clearMessages: () => {},
    triggerSlashCommandsChange: () => {},
    getSessionId: () => "test-session-id",
    getTranscriptPath: () => "/tmp/test-transcript.jsonl",
  } as unknown as MessageManager;

  const aiManager = {} as unknown as AIManager;
  const backgroundTaskManager = {
    getAllTasks: () => [],
  } as unknown as BackgroundTaskManager;
  const taskManager = new TaskManager(container, "test-task-list");

  // Register in container
  container.register("MessageManager", messageManager);
  container.register("AIManager", aiManager);
  container.register("BackgroundTaskManager", backgroundTaskManager);
  container.register("TaskManager", taskManager);
  container.register("SkillManager", skillManager);
  container.register("HookManager", hookManager);
  container.register("LspManager", lspManager);
  container.register("McpManager", mcpManager);

  const slashCommandManager = new SlashCommandManager(container, { workdir });
  container.register("SlashCommandManager", slashCommandManager);

  const pluginManager = new PluginManager(container, { workdir });

  // Step 1: Load the superpowers plugin
  console.log(`\n📦 Loading superpowers plugin from: ${SUPERPOWERS_PATH}`);
  await pluginManager.loadPlugins([{ type: "local", path: SUPERPOWERS_PATH }]);

  const plugins = pluginManager.getPlugins();
  console.log(`   Loaded ${plugins.length} plugin(s)`);

  if (plugins.length === 0) {
    console.error("   ❌ Failed to load superpowers plugin");
    process.exit(1);
  }

  const plugin = plugins[0];
  console.log(`   Plugin: ${plugin.name} v${plugin.version}`);
  console.log(`   Commands: ${plugin.commands.length}`);
  console.log(`   Skills: ${plugin.skills.length}`);
  console.log(`   Hooks: ${plugin.hooksConfig ? "Yes" : "No"}`);

  if (!plugin.hooksConfig) {
    console.error("   ❌ No hooks configuration found in superpowers plugin");
    process.exit(1);
  }

  // Step 2: Verify hooks were registered
  console.log("\n🔧 Verifying hook registration...");
  const hasSessionStartHooks = hookManager.hasHooks("SessionStart");
  console.log(
    `   SessionStart hooks registered: ${hasSessionStartHooks ? "✅" : "❌"}`,
  );

  if (!hasSessionStartHooks) {
    console.error("   ❌ SessionStart hooks not registered");
    process.exit(1);
  }

  // Step 3: Execute SessionStart hooks
  console.log("\n🚀 Executing SessionStart hooks...");
  const sessionStartResult = await hookManager.executeSessionStartHooks(
    "startup",
    "test-session-id",
    "/tmp/test-transcript.jsonl",
  );

  console.log(`   Hook results: ${sessionStartResult.results.length}`);

  for (let i = 0; i < sessionStartResult.results.length; i++) {
    const result = sessionStartResult.results[i];
    console.log(`\n   Hook #${i + 1}:`);
    console.log(`     Success: ${result.success ? "✅" : "❌"}`);
    console.log(`     Duration: ${result.duration}ms`);
    console.log(`     Timed out: ${result.timedOut}`);

    if (result.exitCode !== undefined) {
      console.log(`     Exit code: ${result.exitCode}`);
    }

    if (result.stdout?.trim()) {
      const preview = result.stdout.trim().substring(0, 100);
      console.log(`     Stdout preview: ${preview}...`);
    }

    if (result.stderr?.trim()) {
      console.log(`     Stderr: ${result.stderr.trim().substring(0, 200)}`);
    }
  }

  // Step 4: Verify additionalContext
  console.log("\n📝 Verifying additionalContext...");

  if (sessionStartResult.additionalContext) {
    console.log("   ✅ additionalContext received");
    console.log("\n   Content preview:");
    const preview = sessionStartResult.additionalContext.substring(0, 300);
    console.log(`   ${preview}...`);

    // Check for key markers from superpowers
    const hasSuperpowers =
      sessionStartResult.additionalContext.includes("superpowers");
    const hasUsingSkills =
      sessionStartResult.additionalContext.includes("using-superpowers") ||
      sessionStartResult.additionalContext.includes("SKILL");

    console.log(`\n   Contains 'superpowers': ${hasSuperpowers ? "✅" : "⚠️"}`);
    console.log(`   Contains skill content: ${hasUsingSkills ? "✅" : "⚠️"}`);
  } else {
    console.log("   ⚠️  No additionalContext from hooks");

    // Check if any hook had stdout that should have been parsed
    const hadStdout = sessionStartResult.results.some(
      (r) => r.success && r.stdout?.trim(),
    );
    if (hadStdout) {
      console.log("   (Hooks had stdout but no additionalContext was parsed)");
    }
  }

  // Step 5: Check initialUserMessage
  if (sessionStartResult.initialUserMessage) {
    console.log(
      `\n📨 initialUserMessage: ${sessionStartResult.initialUserMessage.substring(0, 100)}...`,
    );
  }

  // Final summary
  console.log("\n" + "=".repeat(50));
  const allSuccess = sessionStartResult.results.every((r) => r.success);
  if (allSuccess && sessionStartResult.additionalContext) {
    console.log("✅ All superpowers hooks verified successfully!");
    process.exit(0);
  } else if (allSuccess) {
    console.log("⚠️  Hooks executed but no additionalContext produced");
    process.exit(0);
  } else {
    console.log("❌ Some hooks failed - check stderr above");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
