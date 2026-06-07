import { Agent } from "../src/index.js";

/**
 * This example demonstrates the /goal command which sets an autonomous goal
 * for the agent. Once set, the agent works across multiple turns without user
 * input, evaluating after each turn whether the goal condition has been met.
 *
 * The agent uses the fast model to evaluate the goal after each turn.
 * Circuit breakers prevent runaway execution:
 *   - Max 50 turns
 *   - Max 30 minutes
 *   - 3 consecutive evaluation failures
 *
 * Usage:
 *   WAVE_FAST_MODEL=<model> pnpm exec tsx examples/goal-demo.ts
 */
async function main() {
  let goalAchieved = false;

  const agent = await Agent.create({
    workdir: process.cwd(),
    model: process.env.WAVE_FAST_MODEL,
    permissionMode: "bypassPermissions",
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onGoalStateChange: (active, condition, elapsed) => {
        if (active) {
          console.log(
            `\n[Goal] Active: "${condition}" (${elapsed || "0m"} elapsed)`,
          );
        } else {
          console.log("\n[Goal] Cleared");
          goalAchieved = true;
        }
      },
    },
  });

  try {
    // --- Set a goal via slash command ---
    console.log("=== Setting a goal ===\n");
    await agent.sendMessage(
      "/goal create a file called goal-test.txt with hello world",
    );

    // Wait for the autonomous loop to complete
    // The agent will continue working turns until the goal is met or a circuit breaker fires
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (goalAchieved || !agent.isGoalActive) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });

    // --- Check goal status ---
    console.log("\n=== Checking goal status ===\n");
    await agent.sendMessage("/goal");

    // --- Goal should be cleared after achievement ---
    console.log("\n=== Final state ===");
    console.log(`Goal active: ${agent.isGoalActive}`);
    console.log(`Goal status: ${agent.goalStatus}`);
  } catch (error) {
    console.error("Error in example:", error);
  } finally {
    await agent.destroy();
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
