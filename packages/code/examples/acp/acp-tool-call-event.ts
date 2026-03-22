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
 * This example ensures that the 'tool_call' event (not 'tool_call_update')
 * is correctly triggered when the agent decides to use a tool.
 */
async function runToolCallEventTest() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    "tsconfig.dev.json",
    "src/index.ts",
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-tool-call-"));
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

  let toolCallReceived = false;
  let toolCallUpdateReceived = false;

  const client: Client = {
    requestPermission: async (params) => {
      console.log("Received permission request:", params);
      return { outcome: "approved" };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      if (notification.update.sessionUpdate === "tool_call") {
        console.log(
          "✅ Received 'tool_call' event:",
          notification.update.title,
        );
        toolCallReceived = true;
      } else if (notification.update.sessionUpdate === "tool_call_update") {
        console.log(
          "Received 'tool_call_update' event, status:",
          notification.update.status,
        );
        toolCallUpdateReceived = true;
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "tool-call-test-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });

    console.log(
      "Sending prompt to trigger a tool call: 'list files in the current directory'",
    );
    const promptResult = await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "list files in the current directory" }],
    });

    console.log("Prompt result stop reason:", promptResult.stopReason);

    if (!toolCallReceived) {
      throw new Error("FAILED: 'tool_call' event was NOT received.");
    }

    if (toolCallUpdateReceived) {
      console.log("Note: 'tool_call_update' was also received (as expected).");
    }

    console.log("SUCCESS: 'tool_call' event was correctly triggered!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    console.log("Cleaning up...");
    agentProcess.kill();
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

runToolCallEventTest().catch(console.error);
