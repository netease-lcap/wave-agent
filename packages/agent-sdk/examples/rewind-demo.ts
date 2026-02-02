#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";
import * as path from "path";
import os from "os";

/**
 * This example demonstrates the /rewind builtin command.
 * The /rewind command allows reverting the conversation and file changes to a previous user message.
 */

async function main() {
  // Create a temporary directory for file operations
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-rewind-demo-"));
  const testFile = path.join(tempDir, "demo.txt");

  console.log(`📁 Using temporary directory: ${tempDir}`);

  // Create Agent instance
  const agent = await Agent.create({
    workdir: tempDir,
    permissionMode: "bypassPermissions",
    callbacks: {
      onUserMessageAdded: (params) => {
        console.log(`👤 User: ${params.content}`);
      },
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onAssistantMessageAdded: () => {
        console.log("\n🤖 Assistant:");
      },
      onShowRewind: async () => {
        console.log("\n⏪ [UI] Rewind requested! Showing checkpoints...");

        // In a real UI, we would show a list of user messages.
        // Here we'll simulate selecting the first user message.
        const userMessages = agent.messages
          .map((m, i) => ({ index: i, message: m }))
          .filter((item) => item.message.role === "user");

        if (userMessages.length > 0) {
          const checkpoint = userMessages[0];
          console.log(
            `⏪ [UI] Selecting checkpoint: "${checkpoint.message.blocks[0].type === "text" ? checkpoint.message.blocks[0].content : ""}"`,
          );

          // Trigger the actual rewind
          // Note: In the SDK, the UI would call agent.truncateHistory(checkpoint.index)
          await agent.truncateHistory(checkpoint.index);
          console.log("\n✅ Rewind completed!");
          console.log(`📊 Current messages: ${agent.messages.length}`);
        }
      },
    },
  });

  try {
    // 1. First turn: Create a file
    console.log("\n--- Turn 1 ---");
    await agent.sendMessage(
      "Create a file named demo.txt with content 'Hello World'",
    );

    const exists1 = await fs
      .access(testFile)
      .then(() => true)
      .catch(() => false);
    console.log(`\n📄 File exists: ${exists1}`);
    if (exists1) {
      const content = await fs.readFile(testFile, "utf-8");
      console.log(`📄 File content: "${content.trim()}"`);
    }

    // 2. Second turn: Modify the file
    console.log("\n--- Turn 2 ---");
    await agent.sendMessage(
      "Change the content of demo.txt to 'Modified Content'",
    );

    const content2 = await fs.readFile(testFile, "utf-8");
    console.log(`\n📄 File content after modification: "${content2.trim()}"`);

    // 3. Trigger Rewind
    console.log("\n--- Triggering Rewind ---");
    console.log("Sending /rewind command...");
    await agent.sendMessage("/rewind");

    // Wait a bit for the async rewind to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 4. Verify file reversion
    console.log("\n--- Verifying Reversion ---");
    const existsFinal = await fs
      .access(testFile)
      .then(() => true)
      .catch(() => false);
    console.log(`📄 File exists: ${existsFinal}`);
    if (existsFinal) {
      const contentFinal = await fs.readFile(testFile, "utf-8");
      console.log(`📄 File content: "${contentFinal.trim()}"`);
      console.log(
        "❌ Reversion failed: File should have been deleted or reverted to initial state.",
      );
    } else {
      console.log(
        "✅ Success: File was deleted as part of the rewind to before it was created!",
      );
    }
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log("\n👋 Demo finished.");
  }
}

main().catch(console.error);
