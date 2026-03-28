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
 * This example demonstrates how the AskUserQuestion tool call content
 * is formatted as Markdown in ACP events.
 */
async function runAskUserQuestionExample() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    "tsconfig.dev.json",
    "src/index.ts",
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-ask-user-"));
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

  const client: Client = {
    requestPermission: async (params) => {
      console.log("Received permission request:", params.toolCall.title);
      if (params.toolCall.content) {
        console.log(
          "Tool call content:",
          JSON.stringify(params.toolCall.content, null, 2),
        );
      }

      // Automatically answer the question
      if (params.toolCall.title === "AskUserQuestion") {
        return {
          outcome: {
            outcome: "selected",
            optionId: "allow_once",
          },
          message: JSON.stringify({ Library: "Option 1" }),
        };
      }

      return {
        outcome: {
          outcome: "selected",
          optionId: "allow_once",
        },
      };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      if (notification.update.sessionUpdate === "tool_call") {
        console.log(
          "✅ Received 'tool_call' event:",
          notification.update.title,
          JSON.stringify(notification.update.content, null, 2),
        );
      } else if (notification.update.sessionUpdate === "tool_call_update") {
        console.log(
          "Received 'tool_call_update' event, status:",
          notification.update.status,
          JSON.stringify(notification.update.content, null, 2),
        );
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "ask-user-test-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });

    console.log("\nSending prompt to trigger AskUserQuestion...");
    await connection.prompt({
      sessionId,
      prompt: [
        {
          type: "text",
          text: "Ask me which library I want to use for date formatting. Give me two options: 'Option 1' and 'Option 2'.",
        },
      ],
    });

    console.log("\nSUCCESS: AskUserQuestion workflow completed!");
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

runAskUserQuestionExample().catch(console.error);
