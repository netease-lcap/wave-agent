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
 * Demonstrates usage_update notifications in ACP mode.
 *
 * As the agent processes a prompt, it periodically reports context window
 * usage via sessionUpdate with sessionUpdate="usage_update". Each update
 * contains `size` (max context window tokens) and `used` (current tokens).
 *
 * This example collects all usage_update notifications during a prompt and
 * prints the final context window utilization.
 */
async function runUsageUpdate() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-usage-"));
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

  const usageUpdates: Array<{ size: number; used: number }> = [];

  const client: Client = {
    requestPermission: async () => ({ outcome: "approved" }),
    sessionUpdate: async (notification: SessionNotification) => {
      const update = notification.update;
      if (update.sessionUpdate === "usage_update") {
        usageUpdates.push({ size: update.size, used: update.used });
        const pct =
          update.size > 0
            ? ((update.used / update.size) * 100).toFixed(1)
            : "0";
        console.log(
          `[Usage Update] ${update.used} / ${update.size} tokens (${pct}%)`,
        );
      } else if (
        update.sessionUpdate === "agent_message_chunk" &&
        update.content.type === "text"
      ) {
        process.stdout.write(update.content.text);
      }
    },
  };

  const connection = new ClientSideConnection(() => client, stream);

  try {
    console.log("Initializing connection...");
    await connection.initialize({
      protocolVersion: 1,
      clientInfo: { name: "usage-update-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);

    console.log('Sending prompt: "Write a short poem about tokens"\n');
    await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "Write a short poem about tokens" }],
    });

    console.log("\n\n--- Usage Update Summary ---");
    console.log(`Total usage_update notifications: ${usageUpdates.length}`);
    if (usageUpdates.length > 0) {
      const last = usageUpdates[usageUpdates.length - 1];
      console.log(`Final: ${last.used} / ${last.size} tokens`);
    } else {
      console.warn("No usage_update notifications received.");
    }

    console.log("\nUsage update demo completed!");
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

runUsageUpdate().catch(console.error);
