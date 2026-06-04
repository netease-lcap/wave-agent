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
 * Test session/load conversation history replay.
 *
 * 1. Create a session, send a prompt, get a response
 * 2. Stop the agent process
 * 3. Start a new agent process and load the same session
 * 4. Verify the conversation history is replayed via session/update notifications
 */
async function runLoadReplayExample() {
  const agentCommand = [
    "tsx",
    "--tsconfig",
    path.join(process.cwd(), "tsconfig.dev.json"),
    path.join(process.cwd(), "src/index.ts"),
    "--acp",
  ];
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-load-replay-"));
  console.log(`Using temporary directory: ${tmpDir}`);

  let sessionId: string | undefined;

  // --- Phase 1: Create session and send a prompt ---
  console.log("\n=== Phase 1: Create session and send prompt ===\n");
  {
    const collectedUpdates: string[] = [];
    const client: Client = {
      requestPermission: async () => ({ outcome: "approved" }),
      sessionUpdate: async (notification: SessionNotification) => {
        const u = notification.update;
        if (
          u.sessionUpdate === "agent_message_chunk" &&
          u.content.type === "text"
        ) {
          collectedUpdates.push(u.content.text);
        }
      },
    };

    const { process: agentProcess, connection } = await startAgent(
      agentCommand,
      client,
    );

    try {
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: "load-replay-client", version: "1.0.0" },
      });

      const session = await connection.newSession({
        cwd: tmpDir,
        mcpServers: [],
      });
      sessionId = session.sessionId;
      console.log("Created session:", sessionId);

      console.log('Sending prompt: "say hello in one sentence"');
      const result = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: "say hello in one sentence" }],
      });
      console.log("Prompt result:", result.stopReason);
      console.log("Agent replied:", collectedUpdates.join("").slice(0, 100));
    } finally {
      agentProcess.kill();
    }
  }

  if (!sessionId) {
    throw new Error("No session ID from phase 1");
  }

  // --- Phase 2: Load the session and verify history replay ---
  console.log("\n=== Phase 2: Load session and verify replay ===\n");
  {
    const replayLog: Array<{
      type: string;
      text?: string;
      toolCallId?: string;
      status?: string;
    }> = [];

    const client: Client = {
      requestPermission: async () => ({ outcome: "approved" }),
      sessionUpdate: async (notification: SessionNotification) => {
        const u = notification.update;
        switch (u.sessionUpdate) {
          case "user_message_chunk":
            replayLog.push({
              type: "user_message_chunk",
              text: u.content.type === "text" ? u.content.text : undefined,
            });
            break;
          case "agent_message_chunk":
            replayLog.push({
              type: "agent_message_chunk",
              text: u.content.type === "text" ? u.content.text : undefined,
            });
            break;
          case "agent_thought_chunk":
            replayLog.push({
              type: "agent_thought_chunk",
              text: u.content.type === "text" ? u.content.text : undefined,
            });
            break;
          case "tool_call":
            replayLog.push({
              type: "tool_call",
              toolCallId: u.toolCallId,
              status: u.status,
            });
            break;
          case "tool_call_update":
            replayLog.push({
              type: "tool_call_update",
              toolCallId: u.toolCallId,
              status: u.status ?? undefined,
            });
            break;
          // Ignore other update types (available_commands_update, etc.)
        }
      },
    };

    const { process: agentProcess, connection } = await startAgent(
      agentCommand,
      client,
    );

    try {
      await connection.initialize({
        protocolVersion: 1,
        clientInfo: { name: "load-replay-client", version: "1.0.0" },
      });

      console.log("Loading session:", sessionId);
      const loadResult = await connection.loadSession({
        sessionId,
        cwd: tmpDir,
        mcpServers: [],
      });
      console.log("Load result modes:", loadResult.modes?.currentModeId);

      // Print the replayed history
      console.log("\n--- Replayed conversation history ---");
      for (const entry of replayLog) {
        if (entry.type === "user_message_chunk") {
          console.log(`[USER] ${entry.text}`);
        } else if (entry.type === "agent_message_chunk") {
          console.log(`[AGENT] ${entry.text}`);
        } else if (entry.type === "agent_thought_chunk") {
          console.log(`[THINK] ${entry.text}`);
        } else if (entry.type === "tool_call") {
          console.log(
            `[TOOL_START] id=${entry.toolCallId} status=${entry.status}`,
          );
        } else if (entry.type === "tool_call_update") {
          console.log(
            `[TOOL_UPDATE] id=${entry.toolCallId} status=${entry.status}`,
          );
        }
      }
      console.log("--- End of replay ---\n");

      // Verify we got user_message_chunk and agent_message_chunk
      const userChunks = replayLog.filter(
        (e) => e.type === "user_message_chunk",
      );
      const agentChunks = replayLog.filter(
        (e) => e.type === "agent_message_chunk",
      );

      if (userChunks.length === 0) {
        throw new Error(
          "No user_message_chunk replayed — conversation history replay failed!",
        );
      }
      if (agentChunks.length === 0) {
        throw new Error(
          "No agent_message_chunk replayed — conversation history replay failed!",
        );
      }

      console.log(
        `Replay verified: ${userChunks.length} user chunks, ${agentChunks.length} agent chunks`,
      );

      // Also verify we can continue the conversation after loading
      console.log('\nSending follow-up prompt: "what did I just ask you?"');
      const followUpResult = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: "what did I just ask you?" }],
      });
      console.log("Follow-up result:", followUpResult.stopReason);

      console.log("\nLoad-replay example completed successfully!");
    } finally {
      agentProcess.kill();
    }
  }

  // Cleanup
  if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function startAgent(
  command: string[],
  client: Client,
): Promise<{
  process: ReturnType<typeof spawn>;
  connection: ClientSideConnection;
}> {
  return new Promise((resolve, reject) => {
    const agentProcess = spawn(command[0], [...command.slice(1)], {
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
    const connection = new ClientSideConnection(() => client, stream);

    agentProcess.on("error", reject);

    // Give the process a moment to start
    setTimeout(() => resolve({ process: agentProcess, connection }), 500);
  });
}

runLoadReplayExample().catch(console.error);
