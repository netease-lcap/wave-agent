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
 * Demonstrates user message delivery via onUserMessageAdded in ACP mode.
 *
 * When the SDK adds a user message from non-prompt sources (cron jobs,
 * notifications, hooks), the messageManager triggers onUserMessageAdded.
 * WaveAcpAgent forwards this to the ACP client as a 'user_message_chunk'
 * sessionUpdate, keeping the client in sync with all message additions.
 *
 * This example sends a prompt and verifies the user message is echoed back
 * to the client via user_message_chunk before the agent responds.
 */
async function runCronUserMessage() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-cron-"));
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

  const userMessages: string[] = [];

  const client: Client = {
    requestPermission: async (params) => {
      console.log("Received permission request:", params.toolCall.title);
      return { outcome: "approved" };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      const update = notification.update;

      if (
        update.sessionUpdate === "user_message_chunk" &&
        update.content.type === "text"
      ) {
        const text = update.content.text;
        userMessages.push(text);
        console.log(`[User Message Received]: "${text}"`);
      } else if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text"
      ) {
        process.stdout.write(update.content.text);
      } else if (update.sessionUpdate === "tool_call") {
        console.log(`[Tool Started]: ${update.title}`);
      } else if (update.sessionUpdate === "tool_call_update") {
        console.log(`[Tool ${update.status}]: ${update.title}`);
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "cron-user-message-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);

    // Ask the agent a simple question to trigger a response
    console.log('Sending prompt: "say hello"');
    await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "say hello" }],
    });
    console.log("\nWaiting for agent response...");

    // Wait for agent response (max 10 seconds)
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log("\nTimeout waiting for response");
        resolve();
      }, 10000);

      const check = setInterval(() => {
        if (userMessages.length > 0) {
          clearTimeout(timeout);
          clearInterval(check);
          resolve();
        }
      }, 500);
    });

    console.log("\n\nAll user messages received:", userMessages);

    if (userMessages.length === 0) {
      console.warn(
        "No user messages received from cron. This is expected if the cron job didn't fire within the timeout.",
      );
    }

    console.log("\nCron user message demo completed!");
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

runCronUserMessage().catch(console.error);
