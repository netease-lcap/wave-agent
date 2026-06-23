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
 * Demonstrates per-turn token usage and userMessageId echo in ACP mode.
 *
 * After each prompt completes, the PromptResponse includes:
 * - `usage`: per-turn token counts (inputTokens, outputTokens, totalTokens,
 *   and optionally cachedReadTokens/cachedWriteTokens)
 * - `userMessageId`: echoes back the messageId provided in the PromptRequest
 *
 * This example sends a prompt with a custom messageId and prints the
 * returned usage breakdown.
 */
async function runPromptUsage() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-prompt-usage-"));
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
    requestPermission: async () => ({ outcome: "approved" }),
    sessionUpdate: async (notification: SessionNotification) => {
      const update = notification.update;
      if (
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
      clientInfo: { name: "prompt-usage-client", version: "1.0.0" },
    });

    console.log("Creating new session...");
    const { sessionId } = await connection.newSession({
      cwd: tmpDir,
      mcpServers: [],
    });
    console.log("New session ID:", sessionId);

    const messageId = "client-msg-001";
    console.log(`\nSending prompt with messageId="${messageId}"...`);
    const promptResult = await connection.prompt({
      sessionId,
      prompt: [{ type: "text", text: "Say hello in one sentence." }],
      messageId,
    });

    console.log("\n\n--- PromptResponse ---");
    console.log("stopReason:", promptResult.stopReason);
    console.log("userMessageId:", promptResult.userMessageId);
    if (promptResult.usage) {
      const u = promptResult.usage;
      console.log("usage:");
      console.log(`  inputTokens:       ${u.inputTokens}`);
      console.log(`  outputTokens:      ${u.outputTokens}`);
      console.log(`  totalTokens:       ${u.totalTokens}`);
      if (u.cachedReadTokens !== undefined) {
        console.log(`  cachedReadTokens:  ${u.cachedReadTokens}`);
      }
      if (u.cachedWriteTokens !== undefined) {
        console.log(`  cachedWriteTokens: ${u.cachedWriteTokens}`);
      }
    } else {
      console.log("usage: (none reported)");
    }

    console.log("\nPrompt usage demo completed!");
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

runPromptUsage().catch(console.error);
