import { Agent } from "../src/index.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ToolExecutionTracker {
  toolName: string;
  startTime?: number;
  endTime?: number;
  duration?: number;
}

async function demonstrateParallelExecution(): Promise<void> {
  console.log("🚀 Demonstrating Parallel Tool Execution\n");

  const workdir = path.join(__dirname, "temp-parallel-demo");

  // Track tool execution timing
  const toolExecutions = new Map<string, ToolExecutionTracker>();
  let toolExecutionStartTime: number | null = null;
  let toolExecutionEndTime: number | null = null;

  try {
    // Create agent with bash tool enabled and callbacks for timing
    const agent = await Agent.create({
      workdir,
      agentModel: "gemini-2.0-flash-exp",
      callbacks: {
        onToolBlockUpdated: (params) => {
          const { id: toolId, name: toolName, isRunning } = params;

          if (!toolName) return;

          if (isRunning) {
            // Tool started
            console.log(
              `🔧 Tool ${toolName} (${toolId}) started at ${new Date().toLocaleTimeString()}`,
            );

            if (toolExecutionStartTime === null) {
              toolExecutionStartTime = Date.now();
              console.log("⏱️  Tool execution phase started!");
            }

            toolExecutions.set(toolId, {
              toolName,
              startTime: Date.now(),
            });
          } else {
            // Tool completed
            const tracker = toolExecutions.get(toolId);
            if (tracker && tracker.startTime) {
              const endTime = Date.now();
              tracker.endTime = endTime;
              tracker.duration = endTime - tracker.startTime;

              const status = params.success ? "✅" : "❌";
              console.log(
                `${status} Tool ${toolName} (${toolId}) completed at ${new Date().toLocaleTimeString()} - Duration: ${tracker.duration}ms`,
              );

              // Check if all tools are completed
              const allCompleted = Array.from(toolExecutions.values()).every(
                (t) => t.endTime,
              );
              if (allCompleted && toolExecutionStartTime !== null) {
                toolExecutionEndTime = Date.now();
                const totalToolTime =
                  toolExecutionEndTime - toolExecutionStartTime;
                console.log(
                  `\n🏁 All tools completed! Total tool execution time: ${totalToolTime}ms`,
                );

                // Show individual timings
                console.log("\n📊 Individual Tool Timings:");
                toolExecutions.forEach((tracker, toolId) => {
                  console.log(
                    `   ${tracker.toolName} (${toolId.slice(-8)}): ${tracker.duration}ms`,
                  );
                });

                // Calculate if parallel vs sequential
                const sumOfDurations = Array.from(
                  toolExecutions.values(),
                ).reduce((sum, t) => sum + (t.duration || 0), 0);
                console.log(`\n🔍 Analysis:`);
                console.log(
                  `   Sequential execution would take: ${sumOfDurations}ms`,
                );
                console.log(`   Parallel execution took: ${totalToolTime}ms`);
                console.log(
                  `   Performance improvement: ${(((sumOfDurations - totalToolTime) / sumOfDurations) * 100).toFixed(1)}%`,
                );
                console.log(
                  `   Speedup factor: ${(sumOfDurations / totalToolTime).toFixed(1)}x`,
                );
              }
            }
          }
        },
      },
    });

    console.log(
      "📝 Sending message that will trigger multiple Bash commands...",
    );
    console.log("⏱️  Watch the precise tool execution timing below!\n");

    await agent.sendMessage(`
Please run these three bash commands. Each command should execute in parallel:

1. Run: echo "Command 1 started" && sleep 2 && echo "Command 1 finished after 2 seconds"

2. Run: echo "Command 2 started" && sleep 1 && echo "Command 2 finished after 1 second"

3. Run: echo "Command 3 started" && sleep 3 && echo "Command 3 finished after 3 seconds"

Execute each as a separate Bash tool call so I can observe parallel execution timing.
`);

    console.log(`\n✅ Demo completed!`);
  } catch (error) {
    console.error("❌ Demo failed:", (error as Error).message);
  }
}

// Run the demonstration
demonstrateParallelExecution().catch(console.error);
