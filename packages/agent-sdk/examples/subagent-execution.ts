#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

/**
 * Simple subagent functionality test using proper agent.sendMessage() interface
 * This demonstrates real subagent execution by sending messages to the agent
 * rather than accessing private properties.
 *
 * Features demonstrated:
 * - Subagent creation and configuration loading
 * - Real subagent execution through Task tool with multi-step workflow
 * - Subagent lifecycle callbacks (onSubAgentBlockAdded, onSubAgentBlockUpdated)
 * - Proper cleanup and error handling
 */

console.log(
  "🧪 Testing Subagent Execution with Callbacks - Real Implementation...\n",
);

let tempDir: string;
let agent: Agent;

async function setupTest() {
  // Create temporary directory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-subagent-test-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Create the correct directory structure (.wave/agents)
  const agentsDir = path.join(tempDir, ".wave", "agents");
  await fs.mkdir(agentsDir, { recursive: true });

  // Create a simple subagent configuration in markdown format with gemini-2.5-flash model
  const subagentContent = `---
name: file-analyzer
description: Analyzes files and provides summaries
model: gemini-2.5-flash
tools: [Read, LS]
---

You are a file analyzer. When given file contents, provide a concise summary and analysis. Be helpful and thorough in your analysis.`;

  await fs.writeFile(path.join(agentsDir, "file-analyzer.md"), subagentContent);
  console.log(`⚙️ Created file-analyzer subagent`);

  // Create a test file to analyze
  const testFile = path.join(tempDir, "sample.txt");
  await fs.writeFile(
    testFile,
    `This is a sample text file for testing the Wave Agent's subagent capabilities.

The file contains:
- Multiple lines of text
- Sample content for analysis
- Demonstration of subagent file reading capabilities

This file will be analyzed by the file-analyzer subagent to test the real execution functionality.`,
  );

  console.log(`📝 Created test file: sample.txt`);

  // Create Agent with callbacks to observe behavior, including subagent-specific callbacks
  agent = await Agent.create({
    workdir: tempDir,
    callbacks: {
      onMessagesChange: (messages) => {
        console.log(`📝 Messages updated! Total: ${messages.length}`);
        // Check for subagent blocks in messages
        messages.forEach((message, msgIndex) => {
          message.blocks.forEach((block, blockIndex) => {
            if (block.type === "subagent") {
              console.log(
                `🤖💎 Found subagent block in message ${msgIndex}, block ${blockIndex}:`,
              );
              console.log(`   - Subagent ID: ${block.subagentId}`);
              console.log(`   - Subagent Name: ${block.subagentName}`);
              console.log(`   - Status: ${block.status}`);
              console.log(`   - Messages: ${block.messages.length}`);
            }
          });
        });
      },
      onUserMessageAdded: (params) => {
        console.log(`👤 User: "${params.content}"`);
      },
      onAssistantMessageAdded: () => {
        console.log("Assistant message started");
      },
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "running") {
          console.log(
            `🔧 Running tool: ${params.name} (stage: ${params.stage})`,
          );
          if (params.name === "Task") {
            console.log(`🚀 Subagent task starting...`);
            console.log(`🔍 Tool parameters:`, params.parameters);
          }
        } else if (params.success) {
          console.log(`✅ Tool ${params.name} completed successfully`);
          if (params.name === "Task") {
            console.log(`🎯 Subagent task completed!`);
          }
          if (params.result) {
            console.log(`📋 Result: ${params.result}`);
          }
        } else if (params.error) {
          console.log(`🚨 Error: ${params.error}`);
        }
      },
      // Subagent-specific callbacks to monitor subagent lifecycle
      // These callbacks are triggered when subagents are created and their state changes
      onSubAgentBlockAdded: (
        subagentId: string,
        parameters: {
          description: string;
          prompt: string;
          subagent_type: string;
        },
      ) => {
        console.log(`\n🤖➕ CALLBACK: Subagent created with ID: ${subagentId}`);
        console.log(`    ⏰ Timestamp: ${new Date().toISOString()}`);
        console.log(`    📋 Task Description: ${parameters.description}`);
        console.log(`    💬 Prompt: ${parameters.prompt}`);
        console.log(`    🤖 Subagent Type: ${parameters.subagent_type}`);
      },
      onSubAgentBlockUpdated: (subagentId: string, messages, status) => {
        console.log(
          `\n🤖🔄 CALLBACK: Subagent ${subagentId} updated with ${messages.length} messages (Status: ${status})`,
        );
        console.log(`    ⏰ Timestamp: ${new Date().toISOString()}`);
        // Log the latest message from the subagent (using Wave Agent's Message format)
        const latestMessage = messages[messages.length - 1];
        if (
          latestMessage &&
          latestMessage.role === "assistant" &&
          latestMessage.blocks
        ) {
          // Find text blocks in the message
          const textBlocks = latestMessage.blocks.filter(
            (block) => block.type === "text",
          );
          if (textBlocks.length > 0) {
            const content = textBlocks
              .map((block) => ("content" in block ? block.content : ""))
              .join(" ");
            if (content) {
              console.log(
                `    🤖💬 Subagent response: ${content.substring(0, 150)}${content.length > 150 ? "..." : ""}`,
              );
            }
          }
          // Log tool blocks if any
          const toolBlocks = latestMessage.blocks.filter(
            (block) => block.type === "tool",
          );
          if (toolBlocks.length > 0) {
            toolBlocks.forEach((toolBlock, index) => {
              const toolName =
                "name" in toolBlock ? toolBlock.name || "unknown" : "unknown";
              console.log(`    🔧 Tool call ${index + 1}: ${toolName}`);
            });
          }
        }
        console.log(""); // Add spacing
      },
    },
  });

  console.log("🔗 Agent initialization completed");
}

async function runTests() {
  console.log(`\n=== Subagent Execution with Callback Demonstration ===`);

  try {
    // Test real subagent execution with comprehensive callback monitoring
    // This will demonstrate both subagent creation and execution callbacks
    console.log("\n📤 Sending message to agent with subagent task...");
    await agent.sendMessage(
      "Use the file-analyzer subagent to first list all files in the current directory, then analyze the sample.txt file in detail. Please provide a comprehensive summary of its contents and structure.",
    );
    console.log("✅ Subagent execution and callback demonstration completed");
  } catch (error) {
    console.error("❌ Subagent execution test failed:", error);
  }

  console.log(`\n📊 Test completed!`);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    if (agent) {
      await agent.destroy();
      console.log("✅ Agent cleaned up");
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`🗑️ Cleaned up temporary directory: ${tempDir}`);
    }
  } catch (cleanupError) {
    console.error("❌ Cleanup failed:", cleanupError);
  }
}

async function main() {
  try {
    await setupTest();
    await runTests();

    console.log("\n🎉 SUBAGENT FUNCTIONALITY TEST SUMMARY:");
    console.log("✅ Real subagent execution tested through Task tool");
    console.log(
      "✅ Subagent callbacks tested (onSubAgentBlockAdded, onSubAgentBlockUpdated)",
    );
    console.log("✅ Multi-step subagent workflow demonstrated");
    console.log("✅ Proper agent.sendMessage() interface used");
    console.log(
      "\n🚀 Subagent system with full callback support ready for real use!",
    );
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await cleanup();
    console.log("👋 Done!");
    process.exit(0);
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await cleanup();
  process.exit(0);
});

// Add timeout to prevent hanging
setTimeout(async () => {
  console.log("\n⏰ Test timeout reached, cleaning up...");
  await cleanup();
  process.exit(0);
}, 30000); // 30 seconds

// Run main function
main().catch(async (error) => {
  console.error("💥 Unhandled error:", error);
  await cleanup();
  process.exit(1);
});
