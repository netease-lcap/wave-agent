#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import {
  announcements,
  markers,
  section,
  startDemo,
  stopDemo,
  waitForServer,
} from "./harness.js";

/**
 * A local MCP server, end to end: wave connects over stdio, the server's own
 * `instructions` are announced in the conversation before the turn that can
 * already use it, and one of its tools actually runs.
 *
 * MCP tools are not declared one by one in the tool list — they are reached from
 * inside the `Exec` sandbox as `tools["mcp__<server>__<tool>"]`, which is why the
 * tool call below shows up as `Exec`.
 *
 * Nothing here needs an API key or the network except the model call itself —
 * the server is the sibling `instructions-server.mjs`. See the other examples in
 * this directory for the parts this one leaves out: the 2048-character cap and the
 * departure notice (`instructions-lifecycle.ts`), the catalog the model reads
 * (`catalog-example.ts`), and the result row (`exec-result-row.ts`).
 *
 * Run from `packages/agent-sdk`:
 *
 *   npx tsx examples/mcp/instructions-example.ts
 */

const SERVER_NAME = "instructions-demo";
const SERVER_PATH = fileURLToPath(
  new URL("./instructions-server.mjs", import.meta.url),
);

async function main(): Promise<void> {
  const failures: string[] = [];
  let agent: Agent | undefined;
  let workDir: string | undefined;

  try {
    const demo = await startDemo({
      workdirPrefix: "wave-mcp-demo-",
      servers: [{ name: SERVER_NAME, script: SERVER_PATH }],
      callbacks: {
        onAssistantContentUpdated: (params) =>
          process.stdout.write(params.chunk),
        onToolBlockUpdated: (params) => {
          if (params.stage !== "end") return;
          console.log(`\n[tool] ${params.name} ${params.parameters ?? ""}`);
          if (params.result) {
            console.log(`[result] ${params.result.trim()}`);
          }
        },
      },
    });
    agent = demo.agent;
    workDir = demo.workDir;

    section("connecting");
    console.log(`workdir: ${workDir}`);
    console.log(`server:  ${SERVER_PATH}`);

    const server = await waitForServer(agent, SERVER_NAME);
    section("server state");
    console.log(`status:       ${server.status}`);
    console.log(
      `tools:        ${server.tools?.map((t) => t.name).join(", ") || "(none)"}`,
    );
    console.log(
      `instructions: ${(server.instructions ?? "(none)").split("\n").join("\n              ")}`,
    );
    if (server.status !== "connected") {
      failures.push(
        `server status is "${server.status}": ${server.error ?? "no error"}`,
      );
    }
    if (!server.instructions) {
      failures.push("the server declared instructions but wave captured none");
    }

    section("turn 1 — ask for the tool");
    await agent.sendMessage(
      'Reverse the text "wave agent" with the reverse_text tool, then state the result.',
    );

    const afterTurn1 = announcements(agent);
    section("announcement in the conversation");
    console.log(afterTurn1.join("\n\n") || "(none)");
    if (afterTurn1.length !== 1) {
      failures.push(
        `expected exactly 1 announcement after turn 1, got ${afterTurn1.length}`,
      );
    }

    section("turn 2 — a second turn must not repeat it");
    await agent.sendMessage("Thanks. Just say OK — do not call any tool.");
    console.log(`state carried: ${markers(agent).join(" | ")}`);
    if (announcements(agent).length !== 1) {
      failures.push(
        `expected the announcement once, got ${announcements(agent).length} after turn 2`,
      );
    }

    section("summary");
    console.log(`messages:   ${agent.messages.length}`);
    console.log(`tokens:     ${agent.latestTotalTokens}`);
  } catch (error) {
    console.error("\n❌ Error:", error);
    failures.push(String(error));
  } finally {
    await stopDemo(agent, workDir, failures);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
