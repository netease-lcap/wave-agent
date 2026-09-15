#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import { section, startDemo, stopDemo, waitForServer } from "./harness.js";

/**
 * What an `Exec` row says it did: the count of nested MCP calls on the first line,
 * then the last two calls by name. The row is the only thing a reader sees once
 * the script is collapsed, so the check is that its text is derived from the calls
 * the sandbox actually issued — including while the script is still running.
 *
 * Run from `packages/agent-sdk`:
 *
 *   npx tsx examples/mcp/exec-result-row.ts
 */

const SERVER_NAME = "catalog-demo";
const SERVER_PATH = fileURLToPath(
  new URL("./catalog-server.mjs", import.meta.url),
);

const failures: string[] = [];

/** Names in call order, as they appear in the script the model wrote. */
function callsIn(script: string): string[] {
  const pattern = /mcp__[A-Za-z0-9_.-]+|\$codemode"?\]?\.search/g;
  return (script.match(pattern) ?? []).map((match) =>
    match.startsWith("$codemode") ? "$codemode.search" : match,
  );
}

/** The summary shape the row is supposed to have for `count` calls. */
function expectedSummary(calls: string[]): string {
  const count = calls.length;
  return [
    `${count > 2 ? "... " : ""}${count} tool call${count === 1 ? "" : "s"}`,
    ...calls.slice(-2),
  ].join("\n");
}

async function main(): Promise<void> {
  let agent: Agent | undefined;
  let workDir: string | undefined;
  /** Live `shortResult` writes, one entry per update, in the order they arrived. */
  const live: string[] = [];

  try {
    const demo = await startDemo({
      workdirPrefix: "wave-exec-row-",
      servers: [{ name: SERVER_NAME, script: SERVER_PATH }],
      callbacks: {
        onToolBlockUpdated: (params) => {
          if (params.stage === "running" && params.shortResult) {
            live.push(params.shortResult.split("\n")[0]);
          }
          if (params.stage !== "end") return;
          console.log(
            `\n[tool] ${params.name} → ${JSON.stringify(params.shortResult)}`,
          );
        },
      },
    });
    agent = demo.agent;
    workDir = demo.workDir;
    await waitForServer(agent, SERVER_NAME);

    section("turn 1 — one script, three nested calls");
    await agent.sendMessage(
      "Call the Exec tool exactly once. The script must await these three calls " +
        "in this order, each with a literal argument and no loops, and must not " +
        'search the pool: tools["mcp__catalog-demo__reverse_text"]({ text: "abc" }), ' +
        'then tools["mcp__catalog-demo__word_count"]({ text: "a b c" }), then ' +
        'tools["mcp__catalog-demo__shout"]({ text: "abc" }). ' +
        "Return the three results.",
    );

    section("turn 2 — one script, one nested call");
    await agent.sendMessage(
      "Call the Exec tool exactly once more. The script must await exactly one " +
        'MCP call, and no others: tools["mcp__catalog-demo__shout"]({ text: "x" }). ' +
        "Return the result.",
    );

    const blocks = agent.messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === "tool"),
    );
    section(`the ${blocks.length} Exec rows`);
    for (const block of blocks) {
      const script = block.parameters ?? "";
      const calls = callsIn(script);
      const expected = expectedSummary(calls);
      console.log(
        `\nrow name:   ${block.name}\n` +
          `calls:      ${calls.join(", ") || "(none)"}\n` +
          `shortResult ${JSON.stringify(block.shortResult)}\n` +
          `expected    ${JSON.stringify(expected)}`,
      );
      if (block.name !== "Exec") {
        failures.push(`a row is named "${block.name}" instead of "Exec"`);
      }
      if (block.shortResult !== expected) {
        failures.push(
          `summary for ${calls.length} call(s) is ${JSON.stringify(block.shortResult)}, expected ${JSON.stringify(expected)}`,
        );
      }
      if (script.trim() === "" || (block.shortResult ?? "").includes(script)) {
        failures.push("the collapsed row carries the script text");
      }
    }

    section("live updates — the row fills in while the script runs");
    console.log(live.join("  |  ") || "(none)");
    if (live.length === 0) {
      failures.push("no shortResult was reported before the script finished");
    }
    if (new Set(live).size < 2 && blocks.length > 1) {
      failures.push("the row never changed while the script was running");
    }

    section("counts");
    const firstLines = blocks.map(
      (block) => (block.shortResult ?? "").split("\n")[0],
    );
    console.log(firstLines.join("  /  "));
    if (!firstLines.some((line) => /^\.\.\. \d+ tool calls$/.test(line))) {
      failures.push("no row showed the `... N tool calls` shape");
    }
    if (!firstLines.includes("1 tool call")) {
      failures.push("no row showed the singular `1 tool call`");
    }
    if (blocks.some((block) => (block.shortResult ?? "").includes("Exec"))) {
      failures.push("a summary repeats the `Exec` prefix");
    }
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
