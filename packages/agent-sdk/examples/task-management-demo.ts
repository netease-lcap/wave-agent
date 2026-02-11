import { Agent } from "../src/agent.js";

/**
 * This example demonstrates how to use the Task Management tools
 * by sending natural language messages to the Agent.
 */
async function main() {
  // 1. Create Agent instance
  const agent = await Agent.create({
    agentModel: "gemini-2.5-flash", // Use a fast model for testing
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n[Tool: ${params.name}]`);
        }
        if (params.result) {
          console.log(`\n[Result: ${params.result.slice(0, 100)}...]`);
        }
      },
    },
  });

  try {
    console.log("--- Task Management Agent Demo ---\n");

    // 2. Send a message to create a task
    console.log("Step 1: Asking agent to create a task...");
    await agent.sendMessage(
      "Please create a task to 'Refactor the database layer' with high priority.",
    );
    console.log("\n");

    // 3. Send a message to update the task
    console.log("Step 2: Asking agent to start the task...");
    await agent.sendMessage(
      "I've started working on the database refactor. Please update the task status to in_progress.",
    );
    console.log("\n");

    // 4. Send a message to list tasks
    console.log("Step 3: Asking agent to list all tasks...");
    await agent.sendMessage("What tasks do we have right now?");
    console.log("\n");
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // 5. Always destroy the agent to ensure the process exits
    await agent.destroy();
  }
}

main().catch(console.error);
