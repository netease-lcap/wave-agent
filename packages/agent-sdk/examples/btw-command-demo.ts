import { Agent } from "../src/agent.js";

/**
 * This example demonstrates how to use the `askBtw` method to ask a side question
 * without triggering tool executions or affecting the main conversation history.
 */
async function main() {
  // Initialize the agent with a cheap model for testing
  const agent = await Agent.create({
    workdir: process.cwd(),
    model: process.env.WAVE_FAST_MODEL,
    permissionMode: "bypassPermissions", // Allow memory access to keep history clean
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
    },
  });

  try {
    console.log("--- Main Conversation Start ---");
    await agent.sendMessage(
      "Hello! I'm working on a project. Please remember that my favorite color is blue.",
    );
    console.log("\n--- Main Conversation End ---\n");

    console.log("--- Side Question (BTW) ---");
    console.log("Asking: 'What is the capital of France?'");

    // askBtw is a direct call that returns the AI's response as a string
    const answer = await agent.askBtw("What is the capital of France?");

    console.log(`Answer: ${answer}`);
    console.log("--- Side Question End ---\n");

    console.log("--- Verifying Main Conversation Context ---");
    console.log("Asking: 'What is my favorite color?'");

    // This should still know the favorite color from the main conversation
    await agent.sendMessage("What is my favorite color?");

    console.log("\n--- Verification End ---");

    console.log(
      "\nNote: The side question about France was not added to the message history.",
    );
    console.log(
      `Current message count: ${agent.messages.length} (Expected: 4 - 2 user, 2 assistant)`,
    );
  } catch (error) {
    console.error("Error in example:", error);
  } finally {
    // Always destroy the agent to ensure the process exits cleanly
    await agent.destroy();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
