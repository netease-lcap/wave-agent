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
 * Simple hello world using @agentclientprotocol/sdk and wave --acp
 */
async function runHello() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-hello-"));
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
      console.log("Received permission request:", params);
      return { outcome: "approved" };
    },
    sessionUpdate: async (notification: SessionNotification) => {
      if (
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
      clientInfo: { name: "hello-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);

    console.log('Sending prompt: "hello"');
    const promptResult = await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "hello" }],
    });
    console.log("\nPrompt result:", promptResult);

    console.log("Hello example completed successfully!");
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

runHello().catch(console.error);
