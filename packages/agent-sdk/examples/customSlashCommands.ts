#!/usr/bin/env node

/**
 * Example demonstrating custom slash commands functionality
 *
 * This example shows how to:
 * 1. Create custom command files in a temporary directory
 * 2. Load and execute them through the Agent
 * 3. Handle bash command execution in custom commands
 * 4. Clean up the temporary directory after demonstration
 */

import { Agent } from "../src/index.js";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

async function createExampleCommands(tempDir: string) {
  // Create .wave/commands directory in temp dir
  const commandsDir = join(tempDir, ".wave", "commands");
  await mkdir(commandsDir, { recursive: true });

  // Create refactor.md command
  const refactorCommand = `Refactor the selected code to improve readability and maintainability.
Focus on clean code principles and best practices.`;

  await writeFile(join(commandsDir, "refactor.md"), refactorCommand);

  // Create security-check.md command with frontmatter
  const securityCommand = `---
allowed-tools: Read, Grep, Glob
model: claude-3-5-sonnet-20241022
---

Analyze the codebase for security vulnerabilities including:
- SQL injection risks
- XSS vulnerabilities  
- Exposed credentials
- Insecure configurations`;

  await writeFile(join(commandsDir, "security-check.md"), securityCommand);

  // Create list-files.md command with bash execution for file system analysis
  const lsCommand = `---
allowed-tools: Bash
---

## Context

- Current directory: !\`pwd\`

## Task

- list files in current directory
`;

  await writeFile(join(commandsDir, "list-files.md"), lsCommand);

  console.log(`✅ Created example custom commands in ${commandsDir}`);
  return commandsDir;
}

async function demonstrateCustomCommands() {
  let tempDir: string | null = null;
  let originalCwd: string | null = null;

  try {
    // Create temporary directory
    tempDir = join(tmpdir(), `wave-demo-${randomUUID()}`);
    await mkdir(tempDir, { recursive: true });
    console.log(`🗂️  Created temporary directory: ${tempDir}`);

    // Save original working directory and change to temp dir
    originalCwd = process.cwd();
    process.chdir(tempDir);
    console.log(`📁 Changed working directory to: ${tempDir}`);

    // Create example command files
    await createExampleCommands(tempDir);

    // Initialize agent in the temporary directory
    const agent = await Agent.create({
      callbacks: {
        onSubAgentMessageAdded: (commandName, subMessages) => {
          console.log(
            `\n🤖 Sub-agent '${commandName}' added with ${subMessages.length} messages`,
          );
        },
        onSubAgentMessageUpdated: (commandName, subMessages) => {
          console.log(
            `\n🔄 Sub-agent '${commandName}' updated - now has ${subMessages.length} messages`,
          );
          console.log(
            "LastMessage: \n",
            JSON.stringify(subMessages[subMessages.length - 1], null, 2),
          );
        },
      },
    });

    // List all available commands
    console.log("\n📝 Available slash commands:");
    const commands = agent.getSlashCommands();
    commands.forEach((cmd) => {
      const isCustom = agent.getCustomCommand(cmd.id) ? "🔧" : "⚙️";
      console.log(
        `  ${isCustom} /${cmd.name} - ${cmd.description.substring(0, 80)}${cmd.description.length > 80 ? "..." : ""}`,
      );
    });

    // List custom commands with details
    console.log("\n🔧 Custom commands details:");
    const customCommands = agent.getCustomCommands();
    customCommands.forEach((cmd) => {
      console.log(`  /${cmd.name} - ${cmd.filePath}`);
      if (cmd.config?.allowedTools) {
        console.log(
          `    📋 Allowed tools: ${cmd.config.allowedTools.join(", ")}`,
        );
      }
      if (cmd.config?.model) {
        console.log(`    🤖 Model: ${cmd.config.model}`);
      }
    });

    // Execute a custom command
    console.log("\n🚀 Executing /list-files command...");
    const success = await agent.executeSlashCommand("list-files");

    if (success) {
      console.log("✅ Custom command executed successfully");

      // Show the resulting messages
      const messages = agent.messages;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage?.role === "subAgent") {
        console.log(
          `📄 Sub-agent conversation had ${lastMessage.messages?.length || 0} messages`,
        );

        // Show a preview of the sub-agent conversation
        if (lastMessage.messages && lastMessage.messages.length > 0) {
          console.log("📋 Sub-agent conversation preview:");
          lastMessage.messages.forEach((msg, index) => {
            const content = msg.blocks
              .filter((block) => block.type === "text")
              .map((block) => block.content)
              .join(" ");
            const preview =
              content.substring(0, 100) + (content.length > 100 ? "..." : "");
            console.log(`  ${index + 1}. [${msg.role}] ${preview}`);
          });
        }
      }
    } else {
      console.log("❌ Custom command execution failed");
    }

    // Demonstrate reloading commands
    console.log("\n🔄 Reloading custom commands...");
    agent.reloadCustomCommands();
    console.log("✅ Custom commands reloaded");

    // Clean up agent
    await agent.destroy();
    console.log("🧹 Agent destroyed");
  } catch (error) {
    console.error("❌ Example failed:", error);
  } finally {
    // Always clean up: restore working directory and remove temp directory
    if (originalCwd) {
      process.chdir(originalCwd);
      console.log(`📁 Restored working directory to: ${originalCwd}`);
    }

    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
        console.log(`🗑️  Deleted temporary directory: ${tempDir}`);
      } catch (error) {
        console.warn(
          `⚠️  Failed to delete temporary directory ${tempDir}:`,
          error,
        );
      }
    }

    console.log("✨ Demonstration completed");
  }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  demonstrateCustomCommands();
}

export { demonstrateCustomCommands };
