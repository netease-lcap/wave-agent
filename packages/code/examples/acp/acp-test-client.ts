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

async function runTest() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    "tsconfig.dev.json",
    "src/acp-cli.ts",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-test-"));
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

  let thoughtChunks = 0;
  let messageChunks = 0;
  let toolCallReceived = false;
  let toolCallCompleted = false;

  const client: Client = {
    requestPermission: async (params) => {
      console.log("Received permission request:", params);
      return { outcome: "approved" };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      // console.log('Received session update:', JSON.stringify(notification, null, 2));
      if (notification.update.sessionUpdate === "agent_thought_chunk") {
        thoughtChunks++;
      } else if (notification.update.sessionUpdate === "agent_message_chunk") {
        messageChunks++;
      } else if (notification.update.sessionUpdate === "tool_call") {
        toolCallReceived = true;
      } else if (
        notification.update.sessionUpdate === "tool_call_update" &&
        notification.update.status === "completed"
      ) {
        toolCallCompleted = true;
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    // A. Handshake & Initialization
    console.log("Initializing connection...");
    const initResult = await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "test-client", version: "1.0.0" },
    });
    console.log("Initialization result:", initResult);
    if (initResult.protocolVersion !== 1) {
      throw new Error(
        `Expected protocolVersion 1, got ${initResult.protocolVersion}`,
      );
    }
    if (initResult.agentInfo.name !== "wave-agent") {
      throw new Error(
        `Expected agent name 'wave-agent', got ${initResult.agentInfo.name}`,
      );
    }

    // B. Session Management
    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);
    if (!sessionId) {
      throw new Error("Failed to get sessionId");
    }

    // C. Prompt & Streaming (Move this before loadSession to ensure session is saved)
    console.log("Sending prompt: Hello, who are you?");
    const promptResult = await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "Hello, who are you?" }],
    });
    console.log("Prompt result:", promptResult);

    // if (thoughtChunks === 0) {
    //   throw new Error('No thought chunks received');
    // }
    if (messageChunks === 0) {
      throw new Error("No message chunks received");
    }
    if (thoughtChunks === 0) {
      console.warn(
        "Warning: No thought chunks received (this is expected if the model does not support thinking)",
      );
    }
    if (promptResult.stopReason !== "end_turn") {
      throw new Error(
        `Expected stopReason 'end_turn', got ${promptResult.stopReason}`,
      );
    }

    console.log("Loading session...");
    await connection.loadSession({
      sessionId,
      cwd: tmpDir,
      mcpServers: [],
    });

    // D. Tool Execution (Optional)
    console.log(
      "Testing tool execution: What files are in the current directory?",
    );
    const toolPromptResult = await connection.prompt({
      sessionId,
      prompt: [
        { type: "text", text: "What files are in the current directory?" },
      ],
    });
    console.log("Tool prompt result:", toolPromptResult);

    if (!toolCallReceived) {
      throw new Error("No tool_call notification received");
    }
    if (!toolCallCompleted) {
      throw new Error("No tool_call_update (completed) notification received");
    }

    console.log("All tests passed!");
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  } finally {
    console.log("Cleaning up...");
    agentProcess.kill();
    // connection.closed might not resolve if the process is killed abruptly
    // but we want to exit anyway
  }
}

runTest();
