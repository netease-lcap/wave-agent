import { Agent } from "../../src/agent.js";
import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, "..");
const logFile = path.join(projectDir, "background_task.log");

async function main() {
  console.log("Starting Async Hook Example...");

  // Ensure log file doesn't exist
  try {
    await fs.unlink(logFile);
  } catch {
    // Ignore
  }

  const agent = await Agent.create({
    model: "gemini-2.0-flash",
    workdir: projectDir,
    // We'll manually trigger the hook by simulating an Edit tool use
  });

  try {
    console.log("Simulating PostToolUse hook for 'Edit' tool...");

    // The HookManager is internal to the Agent, but we can trigger hooks
    // by using the agent's internal hook manager if we had access,
    // or by performing an action that triggers it.
    // Since we want to test the ASYNC nature, we'll use the hookManager directly if possible
    // or simulate the event.

    const hookManager = (
      agent as unknown as {
        hookManager: {
          loadConfiguration: (
            userHooks: unknown,
            projectHooks: unknown,
          ) => void;
          executeHooks: (event: string, context: unknown) => Promise<unknown[]>;
        };
      }
    ).hookManager;

    // Manually load the configuration for this test
    const settingsPath = path.join(__dirname, "async-hook-settings.json");
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
    hookManager.loadConfiguration(undefined, settings.hooks);

    const context = {
      event: "PostToolUse",
      toolName: "Edit",
      projectDir: projectDir,
      timestamp: new Date(),
      sessionId: "test-session",
    };

    const startTime = Date.now();
    console.log("Executing hooks...");
    const results = await hookManager.executeHooks("PostToolUse", context);
    const duration = Date.now() - startTime;

    console.log(`Hook execution returned in ${duration}ms`);
    console.log(
      `Results length: ${results.length} (should be 0 for async hooks)`,
    );

    if (duration > 1000) {
      console.error("FAIL: Hook execution blocked for too long!");
    } else {
      console.log("SUCCESS: Hook execution was non-blocking.");
    }

    console.log("Waiting 6 seconds for background task to complete...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    try {
      const logContent = await fs.readFile(logFile, "utf-8");
      console.log(`Log file content: ${logContent.trim()}`);
      if (logContent.includes("Background task finished")) {
        console.log("SUCCESS: Background task completed successfully.");
      } else {
        console.error("FAIL: Background task output not found in log.");
      }
    } catch {
      console.error(
        "FAIL: Log file was not created. Background task might have failed.",
      );
    }
  } finally {
    await agent.destroy();
    // Cleanup
    try {
      await fs.unlink(logFile);
    } catch {
      // Ignore
    }
  }
}

main().catch(console.error);
