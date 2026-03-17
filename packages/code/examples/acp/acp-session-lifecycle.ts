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

async function runSessionLifecycleExample() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    "tsconfig.dev.json",
    "src/index.ts",
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-lifecycle-"));
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
      console.log(
        "Received session update:",
        notification.update.sessionUpdate,
      );
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    const initResult = await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "lifecycle-client", version: "1.0.0" },
    });
    console.log("Initialization result:", JSON.stringify(initResult, null, 2));

    // 1. Create multiple sessions
    console.log("Creating session 1...");
    const { sessionId: id1 } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("Session 1 ID:", id1);

    console.log('Sending "hi" to session 1...');
    await connection.prompt({
      sessionId: id1,
      prompt: [{ type: "text", text: "hi" }],
    });

    console.log("Creating session 2...");
    const { sessionId: id2 } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("Session 2 ID:", id2);

    console.log('Sending "hi" to session 2...');
    await connection.prompt({
      sessionId: id2,
      prompt: [{ type: "text", text: "hi" }],
    });

    // 2. List sessions
    console.log("Listing active sessions...");
    const listResult = await connection.listSessions({ cwd: tmpDir });
    console.log(
      "Active sessions:",
      JSON.stringify(listResult.sessions, null, 2),
    );

    if (listResult.sessions.length < 2) {
      throw new Error(
        `Expected at least 2 sessions, got ${listResult.sessions.length}`,
      );
    }

    // 3. Stop a session
    console.log(`Stopping session 1 (${id1})...`);
    await connection.unstable_closeSession({ sessionId: id1 });
    console.log("Session 1 stopped.");

    // 4. List sessions again to verify
    console.log("Listing active sessions after stop...");
    const listResultAfter = await connection.listSessions({ cwd: tmpDir });
    console.log(
      "Active sessions:",
      JSON.stringify(listResultAfter.sessions, null, 2),
    );

    const remainingIds = listResultAfter.sessions.map(
      (s: { sessionId: string }) => s.sessionId,
    );
    if (remainingIds.includes(id1)) {
      throw new Error("Session 1 still exists after stop");
    }
    if (!remainingIds.includes(id2)) {
      throw new Error("Session 2 disappeared unexpectedly");
    }

    console.log("Session lifecycle example completed successfully!");
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

runSessionLifecycleExample();
