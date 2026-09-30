#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import { execTool } from "../../src/tools/execTool.js";
import {
  EXEC_CATALOG_MARKER_PREFIX,
  EXEC_CATALOG_MARKER_SUFFIX,
  buildExecCatalogAnnouncement,
} from "../../src/exec/catalogAnnouncement.js";
import type { ExecCatalogMarker } from "../../src/exec/catalogAnnouncement.js";
import { renderToolSignature } from "../../src/exec/catalog.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";
import {
  catalogAnnouncements,
  catalogMarkerOf,
  section,
  startDemo,
  stopDemo,
  waitForServer,
} from "./harness.js";

/**
 * The whole lifecycle of the on-demand tool list, over real stdio servers and real
 * turns: announced once when the list first appears, silent while nothing moves, a
 * fresh full list each time the set changes (there is no delta to send), and — the
 * property the design turns on — never empty, because the deferred built-ins are in
 * it whether or not a single MCP server is connected.
 *
 * Every measured step reads the messages the agent actually appended. One section
 * exercises the closed-channel branch directly, because a real session reaches it
 * only when `Exec` itself is switched off; its input is the marker the previous
 * turn really wrote.
 *
 * The last step hands the model a list of names and watches it find the tool's
 * signature and call it through the sandbox, which is the only thing the mechanism
 * is for.
 *
 * Run from `packages/agent-sdk`:
 *
 *   WAVE_FAST_MODEL=<model> npx tsx examples/mcp/catalog-lifecycle.ts
 */

const BULK_SERVER = "bulk-demo";
const SMALL_SERVER = "oversized-demo";

const BULK_SCRIPT = fileURLToPath(
  new URL("./bulk-server.mjs", import.meta.url),
);
const SMALL_SCRIPT = fileURLToPath(
  new URL("./oversized-server.mjs", import.meta.url),
);

/** The wire payload of a marker: `k` kind, `h` hash of the name list. */
interface MarkerPayload {
  k?: "full" | "removed";
  h?: string;
}

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** The MCP half of the pool, for measuring it against the announced name list. */
function flatten(agent: Agent): ExecPoolEntry[] {
  return agent.getMcpServers().flatMap((server) =>
    (server.tools ?? []).map((tool) => ({
      name: `mcp__${server.name}__${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      isMcp: true,
    })),
  );
}

/** The names one announcement lists. */
function listedNames(text: string): string[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("- `"))
    .map((line) => line.slice(3, -1));
}

/** MCP tools connected right now — the half of the pool this demo can move. */
function mcpToolCount(agent: Agent): number {
  return flatten(agent).length;
}

/** Connections settle asynchronously — wait for the pool the next turn will read. */
async function waitForPool(agent: Agent, expected: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (mcpToolCount(agent) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `the pool never settled at ${expected} MCP tools, saw ${mcpToolCount(agent)}`,
  );
}

/**
 * Nothing half-connected, which is what a tool count alone cannot tell: a server
 * mid-handshake reports zero tools and lands in the pool a moment later.
 */
async function settle(agent: Agent): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const pending = agent
      .getMcpServers()
      .filter(
        (server) =>
          server.status === "connecting" || server.status === "reconnecting",
      );
    if (pending.length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("an MCP server never finished connecting");
}

/** The marker payload of one announcement, in the shape the decision function takes. */
function markerOf(text: string): ExecCatalogMarker {
  const line = catalogMarkerOf(text) ?? "";
  const payload = JSON.parse(
    line.slice(
      EXEC_CATALOG_MARKER_PREFIX.length,
      line.length - EXEC_CATALOG_MARKER_SUFFIX.length,
    ),
  ) as MarkerPayload;
  return {
    kind: payload.k === "removed" ? "removed" : "full",
    ...(payload.h !== undefined ? { hash: payload.h } : {}),
  };
}

/** The body under the marker, for display: long lists are clipped. */
function bodyOf(text: string, limit = 6): string {
  const lines = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .filter((line) => catalogMarkerOf(line) === undefined)
    .map((line) => line.replace(/<\/?system-reminder>/g, "").trim())
    .filter((line) => line !== "");
  const head = lines.slice(0, limit);
  return lines.length > limit
    ? `${head.join("\n")}\n   … ${lines.length - limit} more lines`
    : head.join("\n");
}

/**
 * One real turn. Returns only what this turn added, plus whether everything that was
 * already in the history came out of it byte-identical — the property the whole
 * design exists for.
 */
async function turn(agent: Agent, prompt: string) {
  const had = catalogAnnouncements(agent);
  const history = agent.messages.map((message) => JSON.stringify(message));
  await agent.sendMessage(prompt);
  const all = catalogAnnouncements(agent);
  const added = all.slice(had.length);
  const now = agent.messages.map((message) => JSON.stringify(message));
  return {
    added,
    prefixIntact: history.every((snapshot, index) => now[index] === snapshot),
  };
}

const IDLE = "Reply with exactly: OK. Do not call any tool.";

async function main(): Promise<void> {
  let agent: Agent | undefined;
  let workDir: string | undefined;
  const seen: string[] = [];
  let spent = 0;
  let turns = 0;

  try {
    const demo = await startDemo({
      workdirPrefix: "wave-catalog-lifecycle-",
      servers: [
        { name: BULK_SERVER, script: BULK_SCRIPT },
        { name: SMALL_SERVER, script: SMALL_SCRIPT },
      ],
      model: process.env.WAVE_FAST_MODEL,
      callbacks: {
        onToolBlockUpdated: (params) => {
          if (params.stage !== "end") return;
          console.log(`\n[tool] ${params.name} → ${params.shortResult ?? ""}`);
        },
      },
    });
    agent = demo.agent;
    workDir = demo.workDir;

    await waitForServer(agent, BULK_SERVER);
    await waitForServer(agent, SMALL_SERVER);
    await settle(agent);

    // This machine's user-level config may already declare MCP servers, and they
    // would land in the pool mid-demo (a server that is still handshaking reports
    // zero tools and connects a second later). They belong to the environment, not
    // to the demo, so drop them — this agent only, the config files are untouched.
    const ambient = agent
      .getMcpServers()
      .filter(
        (server) => server.name !== BULK_SERVER && server.name !== SMALL_SERVER,
      );
    if (ambient.length > 0) {
      section(
        "isolating the demo — servers this machine configured on its own",
      );
      for (const server of ambient) {
        await agent.disconnectMcpServer(server.name);
        console.log(
          `dropped \`${server.name}\` (${server.scope ?? "unknown"} scope)`,
        );
      }
      await settle(agent);
    }
    await waitForPool(agent, 25);

    /** Send a turn, report what it appended, and keep score. */
    async function step(title: string, prompt = IDLE) {
      section(title);
      turns += 1;
      const { added, prefixIntact } = await turn(agent!, prompt);
      check(prefixIntact, `"${title}": an existing message was rewritten`);
      spent += added.reduce((total, text) => total + text.length, 0);
      if (added.length === 0) {
        console.log("(nothing announced this turn)");
        seen.push("—");
        return [];
      }
      for (const text of added) {
        const marker = markerOf(text);
        console.log(`${catalogMarkerOf(text)}\n${bodyOf(text)}`);
        console.log(
          `   ${text.length} chars, ${listedNames(text).length} names`,
        );
        seen.push(marker.kind);
      }
      return added.map(markerOf);
    }

    section("the declaration it is NOT in");
    const declaration = execTool.config.function.description ?? "";
    console.log(`${declaration.split("\n")[0]} …`);
    console.log(`${declaration.length} chars, pool-independent`);
    check(
      !declaration.includes("mcp__") &&
        !declaration.includes("PARTIAL") &&
        !declaration.includes("tools.mcp__"),
      "the Exec declaration names the pool: connecting a server would rewrite tools[]",
    );

    section("names instead of signatures — what the list costs, measured");
    const pool = flatten(agent);
    const signatureChars = pool.reduce(
      (total, entry) => total + renderToolSignature(entry).length,
      0,
    );
    const nameChars = pool.reduce(
      (total, entry) => total + entry.name.length + 4,
      0,
    );
    console.log(
      `the MCP half of the pool: ${pool.length} tools\n` +
        `  rendered as signatures: ${signatureChars} chars\n` +
        `  listed as names:        ${nameChars} chars`,
    );
    check(
      nameChars * 3 < signatureChars,
      "listing names is not meaningfully cheaper than rendering every schema",
    );

    const declared = agent.getAvailableToolNames();
    check(
      !declared.includes(`mcp__${BULK_SERVER}__bulk_step_0`),
      "a pooled MCP tool is also declared flat: the sandbox would be redundant",
    );
    check(
      !declared.includes("WebFetch"),
      "a deferred built-in is also declared flat: it would be in two places at once",
    );

    const [first] = await step(
      "turn 1 — the list appears, announced in the conversation",
    );
    check(
      first?.kind === "full",
      `the first announcement is not a full list: ${first?.kind}`,
    );
    const firstNote = catalogAnnouncements(agent)[0] ?? "";
    const firstNames = listedNames(firstNote);
    check(
      firstNames.includes(`mcp__${BULK_SERVER}__bulk_step_23`) &&
        firstNames.includes(`mcp__${SMALL_SERVER}__word_count`),
      "the announced list is missing a tool of a connected server",
    );
    // The half that cannot be switched off: deferred built-ins ride the same list.
    check(
      firstNames.includes("WebFetch") && firstNames.includes("EnterWorktree"),
      "deferred built-ins are missing from the announced list",
    );
    check(
      declared.every((name) => !firstNames.includes(name)),
      "the announced list names a tool that is also declared flat",
    );

    await step("turn 2 — nothing moved, so nothing is said");

    section(`the set changes — ${SMALL_SERVER} goes away`);
    await agent.disconnectMcpServer(SMALL_SERVER);
    await waitForPool(agent, 24);
    const [second] = await step(
      "turn 3 — a server leaves: a fresh list, not a delta",
    );
    check(second?.kind === "full", `expected a full list, got ${second?.kind}`);
    const secondNote = catalogAnnouncements(agent).at(-1) ?? "";
    check(
      !listedNames(secondNote).includes(`mcp__${SMALL_SERVER}__word_count`),
      "the departed server's tool is still listed",
    );
    check(
      !secondNote.includes(`mcp__${SMALL_SERVER}`),
      "the departure notice names the server instead of just dropping its tools",
    );

    section(`the set changes back — ${SMALL_SERVER} returns`);
    await agent.connectMcpServer(SMALL_SERVER);
    await waitForServer(agent, SMALL_SERVER);
    await waitForPool(agent, 25);
    const [third] = await step("turn 4 — a server arrives: a fresh list again");
    check(third?.kind === "full", `expected a full list, got ${third?.kind}`);
    check(
      listedNames(catalogAnnouncements(agent).at(-1) ?? "").includes(
        `mcp__${SMALL_SERVER}__word_count`,
      ),
      "the returning server's tool is not listed again",
    );

    section(`the set shrinks — ${BULK_SERVER} goes away`);
    await agent.disconnectMcpServer(BULK_SERVER);
    await waitForPool(agent, 1);
    const [small] = await step("turn 5 — a much shorter list");
    check(small?.kind === "full", `expected a full list, got ${small?.kind}`);
    const smallNote = catalogAnnouncements(agent).at(-1) ?? "";
    check(
      !smallNote.includes(`mcp__${BULK_SERVER}`),
      "the 24 departed tools are still listed",
    );
    check(
      listedNames(smallNote).length > 1,
      "the list lost the deferred built-ins along with the server",
    );

    await step("turn 6 — nothing moved again, so nothing is said");

    section(`the set cannot empty — ${SMALL_SERVER} goes away too`);
    await agent.disconnectMcpServer(SMALL_SERVER);
    await waitForPool(agent, 0);
    // The motivating property: the pool is never empty, so `Exec` stays declared
    // and `tools[]` stops churning whenever an MCP server connects or drops.
    check(
      agent.getAvailableToolNames().includes("Exec"),
      "Exec is no longer declared although the deferred built-ins remain",
    );
    const [builtinsOnly] = await step(
      "turn 7 — no MCP server left, and the list is still there",
    );
    check(
      builtinsOnly?.kind === "full",
      `expected a full list, got ${builtinsOnly?.kind}`,
    );
    const builtinsNote = catalogAnnouncements(agent).at(-1) ?? "";
    check(
      !builtinsNote.includes("mcp__"),
      "an MCP tool is still listed although no server is connected",
    );
    check(
      listedNames(builtinsNote).includes("WebFetch"),
      "the built-ins-only list does not name the deferred built-ins",
    );

    section("the channel closing — the branch a real session rarely reaches");
    // Only `Exec` being switched off (or denied, or excluded) closes the channel:
    // the pool itself cannot empty. The input here is the marker the last turn
    // really wrote, so this is the deployed decision function, not a mock.
    const lastMarker = markerOf(catalogAnnouncements(agent).at(-1) ?? "");
    const closed = buildExecCatalogAnnouncement(lastMarker, undefined) ?? "";
    console.log(closed);
    check(
      markerOf(closed).kind === "removed",
      "closing the channel did not write a `removed` marker",
    );
    check(
      closed.includes("no longer available"),
      "the closing notice does not say the list no longer applies",
    );
    check(
      buildExecCatalogAnnouncement(markerOf(closed), undefined) === null,
      "closing the channel twice announces twice",
    );
    check(
      buildExecCatalogAnnouncement(markerOf(closed), []) === null,
      "an empty pool is treated as something to announce",
    );

    section("the point of the exercise — a list of names, used");
    await agent.connectMcpServer(BULK_SERVER);
    await waitForServer(agent, BULK_SERVER);
    await waitForPool(agent, 24);
    const beforeUse = catalogAnnouncements(agent).length;
    await agent.sendMessage(
      "Your on-demand tool list names the tools, not their parameters. Find the " +
        "one that runs bulk step 7 and call it with target `orders`. Then report " +
        "the tool name.",
    );
    check(
      catalogAnnouncements(agent).length === beforeUse + 1,
      "the returning server did not produce exactly one announcement",
    );
    const used = agent.messages.some((message) =>
      message.blocks.some(
        (block) =>
          block.type === "tool" &&
          (block.parameters ?? "").includes(`mcp__${BULK_SERVER}__bulk_step_7`),
      ),
    );
    console.log(`reached the tool from its name alone: ${used ? "yes" : "no"}`);
    if (!used) {
      console.log(
        "   (the model did not get there — the mechanism is what was under test, not the model)",
      );
    }

    section("what the whole lifecycle cost");
    console.log(
      `announcements: ${seen.length} over ${turns} turns — ${seen.join(", ")}`,
    );
    console.log(
      `added to the conversation: ${spent} chars (~${(spent / 4).toFixed(0)} estimated tokens)`,
    );
    check(
      seen.join(",") === "full,—,full,full,full,—,full",
      `unexpected announcement sequence: ${seen.join(",")}`,
    );
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
