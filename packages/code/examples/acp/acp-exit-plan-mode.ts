import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  type Client,
  type SessionNotification,
} from "@agentclientprotocol/sdk";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

/**
 * This example demonstrates how to exit plan mode using the ExitPlanMode tool.
 * It shows the transition from 'plan' mode to 'acceptEdits' mode.
 */
async function runExitPlanModeExample() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-exit-plan-"));
  console.log(`Using temporary directory: ${tmpDir}`);

  console.log("Starting agent process...");
  const agentProcess = spawn(agentCommand[0], [...agentCommand.slice(1)], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, NODE_ENV: "integration-test" },
  });

  const stdin = Writable.toWeb(
    agentProcess.stdin!,
  ) as WritableStream<Uint8Array>;
  const stdout = Readable.toWeb(
    agentProcess.stdout!,
  ) as ReadableStream<Uint8Array>;

  const stream = ndJsonStream(stdin, stdout);

  let currentMode = "default";

  const client: Client = {
    requestPermission: async (params) => {
      console.log("Received permission request:", params.toolCall.title);

      // Automatically approve ExitPlanMode with 'allow_always' to transition to 'acceptEdits' mode
      if (params.toolCall.title.includes("ExitPlanMode")) {
        if (params.toolCall.content) {
          console.log(
            "Tool call content:",
            JSON.stringify(params.toolCall.content, null, 2),
          );
        }
        console.log("Approving ExitPlanMode with 'allow_always'...");
        return {
          outcome: {
            outcome: "selected",
            optionId: "allow_always",
          },
        };
      }

      // Approve other tools (like Write for the plan file)
      return {
        outcome: {
          outcome: "selected",
          optionId: "allow_once",
        },
      };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      if (notification.update.sessionUpdate === "current_mode_update") {
        console.log("Mode updated to:", notification.update.currentModeId);
        currentMode = notification.update.currentModeId;
      } else if (
        notification.update.sessionUpdate === "agent_message_chunk" &&
        notification.update.content.type === "text"
      ) {
        process.stdout.write(notification.update.content.text);
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "exit-plan-test-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);

    console.log("Setting mode to 'plan'...");
    await connection.setSessionMode({
      sessionId,
      modeId: "plan",
    });

    console.log("\nSending prompt to trigger ExitPlanMode...");
    // We ask the agent to create a plan and then call ExitPlanMode.
    // We explicitly tell it not to search or perform other actions to focus on the workflow.
    await connection.prompt({
      sessionId,
      prompt: [
        {
          type: "text",
          text: "Write a plan to create a 'hello.txt' file with 'hello' content. Write the plan to the plan file and then call ExitPlanMode immediately. Do not search or run any other tools.",
        },
      ],
    });

    console.log("\nFinal mode:", currentMode);
    if (currentMode === "acceptEdits") {
      console.log(
        "SUCCESS: Successfully transitioned from 'plan' to 'acceptEdits' mode!",
      );
    } else {
      console.log(`FAILED: Mode is ${currentMode}, expected 'acceptEdits'.`);
    }
  } catch (error) {
    console.error("Example failed:", error);
    process.exit(1);
  } finally {
    console.log("Cleaning up...");
    agentProcess.kill();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

runExitPlanModeExample().catch(console.error);
