import { Agent } from "../src/index.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function demonstrateBackgrounding(): Promise<void> {
  console.log("🚀 Demonstrating Ctrl-B Backgrounding Feature\n");

  const workdir = path.join(__dirname, "temp-backgrounding-demo");

  let agent: Agent | undefined;

  try {
    // Create agent with bash tool enabled
    agent = await Agent.create({
      workdir,
      agentModel: "gemini-2.0-flash-exp",
      permissionMode: "bypassPermissions", // Ensure tools can run without permission prompts
      callbacks: {
        onAssistantContentUpdated: () => {
          // process.stdout.write(chunk);
        },
        onToolBlockUpdated: (params) => {
          const { name: toolName, stage, id: toolId } = params;
          if (
            stage === "running" &&
            (toolName === "Bash" || toolName === "Task")
          ) {
            console.log(
              `\n🔧 Tool ${toolName} (${toolId}) is running. Simulating Ctrl-B...`,
            );

            // Simulate Ctrl-B after a short delay
            setTimeout(async () => {
              if (agent) {
                console.log(
                  `\n⌨️  Simulating Ctrl-B for ${toolName} (${toolId})...`,
                );
                await agent.backgroundCurrentTask();
              }
            }, 500);
          } else if (stage === "end") {
            console.log(
              `\n🏁 Tool ${toolName} (${toolId}) ended. Success: ${params.success}`,
            );
          }
        },
        onTasksChange: (tasks) => {
          const runningTasks = tasks.filter((t) => t.status === "running");
          const completedTasks = tasks.filter((t) => t.status === "completed");
          if (runningTasks.length > 0 || completedTasks.length > 0) {
            console.log(
              `\n📋 Background Tasks Update: ${runningTasks.length} running, ${completedTasks.length} completed.`,
            );
            tasks.forEach((t) => {
              console.log(`   - [${t.id}] ${t.type}: ${t.status}`);
              if (t.status === "completed") {
                console.log(`     Output: ${t.stdout}`);
              }
            });
          }
        },
      },
    });

    console.log("📝 Sending a long-running command to background...");

    // We use a promise to wait for the agent to finish its turn
    // Note: In a real scenario, backgrounding unblocks the agent
    const response = await agent.sendMessage(
      "Run `sleep 10 && echo 'Finished sleep'`. Just run it and don't do anything else.",
    );
    console.log("\n🤖 Agent Response:", response);

    console.log(
      "\n✅ Agent turn completed. The task should still be running in the background.",
    );

    // Wait a bit to see background task updates
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } catch (error) {
    console.error("❌ Demo failed:", (error as Error).message);
  } finally {
    if (agent) {
      console.log("\n🧹 Cleaning up...");
      await agent.destroy();
    }
  }
}

// Run the demonstration
demonstrateBackgrounding().catch(console.error);
