#!/usr/bin/env tsx

import { SkillManager } from "../src/managers/skillManager.js";
import { SlashCommandManager } from "../src/managers/slashCommandManager.js";
import { Container } from "../src/utils/container.js";
import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

/**
 * This example demonstrates the real-time skill discovery and slash command refresh.
 * It shows how SkillManager watches for file system changes and notifies SlashCommandManager
 * to update available commands without a restart.
 */
async function main() {
  const tempDir = join(tmpdir(), `skill-watcher-demo-${Date.now()}`);
  const skillsDir = join(tempDir, ".wave", "skills");

  try {
    // Setup temp skills directory
    await mkdir(skillsDir, { recursive: true });
    console.log(`📁 Created temp skills directory: ${skillsDir}`);

    // --- Part 1: Demonstrating the Mechanism ---
    console.log("\n🔍 Part 1: Demonstrating the Mechanism");

    // Initialize container and managers
    const container = new Container();

    // 1. Initialize SkillManager with watch: true
    const skillManager = new SkillManager(container, {
      workdir: tempDir,
      watch: true,
    });
    container.register("SkillManager", skillManager);

    // 2. Initialize SlashCommandManager (it will listen to SkillManager's 'refreshed' event)
    const slashCommandManager = new SlashCommandManager(container, {
      workdir: tempDir,
    });
    slashCommandManager.initialize();

    // 3. Initialize SkillManager
    await skillManager.initialize();
    console.log("🚀 SkillManager initialized with watcher.");

    // Helper to wait for a refresh event with a timeout
    const waitForRefresh = (label: string) =>
      new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          console.log(
            `⚠️ Timeout waiting for refresh event (${label}), checking manually...`,
          );
          resolve();
        }, 5000);
        skillManager.once("refreshed", () => {
          clearTimeout(timeout);
          console.log(`✅ SkillManager refreshed (${label})!`);
          resolve();
        });
      });

    // --- Step 1: Add a new skill ---
    console.log("\n✨ Step 1: Adding a new skill...");
    const skillPath = join(skillsDir, "dynamic-skill");

    // Wait for the 'refreshed' event from SkillManager
    const refreshedPromise1 = waitForRefresh("Step 1");

    await mkdir(skillPath, { recursive: true });
    // Small delay to ensure directory is recognized
    await new Promise((r) => setTimeout(r, 500));

    await writeFile(
      join(skillPath, "SKILL.md"),
      `---
name: dynamic-skill
description: A skill added at runtime
---
Initial content`,
    );

    // Wait for the event
    await refreshedPromise1;

    // If it timed out, wait a bit more and check again
    if (!skillManager.getSkillMetadata("dynamic-skill")) {
      console.log("⏳ Still waiting for skill to be discovered...");
      await new Promise((r) => setTimeout(r, 1000));
    }

    let skills = skillManager.getAvailableSkills();
    let commands = slashCommandManager.getCommands();
    console.log(`Found ${skills.length} skills.`);
    console.log(`Slash commands: ${commands.map((c) => c.id).join(", ")}`);

    if (commands.some((c) => c.id === "dynamic-skill")) {
      console.log("🎯 Success: dynamic-skill is available as a slash command!");
    } else {
      console.log("❌ dynamic-skill is NOT available as a slash command yet.");
    }

    // --- Step 2: Modify the skill ---
    console.log("\n📝 Step 2: Modifying the skill...");
    const refreshedPromise2 = waitForRefresh("Step 2");

    await writeFile(
      join(skillPath, "SKILL.md"),
      `---
name: dynamic-skill
description: An UPDATED skill added at runtime
---
Updated content`,
    );

    await refreshedPromise2;
    // Give a tiny bit of time for SlashCommandManager to process the event
    await new Promise((r) => setTimeout(r, 100));

    const updatedSkill = skillManager.getSkillMetadata("dynamic-skill");
    console.log(`Updated description: ${updatedSkill?.description}`);

    // --- Step 3: Deleting the skill ---
    console.log("\n🗑️ Step 3: Deleting the skill...");
    const refreshedPromise3 = waitForRefresh("Step 3");

    await rm(skillPath, { recursive: true, force: true });

    await refreshedPromise3;
    // Give a tiny bit of time for SlashCommandManager to process the event
    await new Promise((r) => setTimeout(r, 100));

    skills = skillManager.getAvailableSkills();
    commands = slashCommandManager.getCommands();
    console.log(`Found ${skills.length} skills.`);
    if (!commands.some((c) => c.id === "dynamic-skill")) {
      console.log("🎯 Success: dynamic-skill was removed from slash commands!");
    }

    // Cleanup watcher
    await skillManager.destroy();

    // --- Part 2: Real-world usage with Agent ---
    console.log("\n🤖 Part 2: Real-world usage with Agent");
    const agent = await Agent.create({
      workdir: tempDir,
      watchSkills: true, // Enabled by default
    });

    console.log("Agent initialized with skill watching enabled.");
    console.log(
      "Any changes to .wave/skills will be automatically picked up by the agent.",
    );

    await agent.destroy();
  } catch (error) {
    console.error("❌ Demo failed:", error);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
    console.log("\n🧹 Demo complete");
  }
}

main().catch(console.error);
