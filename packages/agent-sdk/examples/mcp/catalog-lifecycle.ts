#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import { execTool } from "../../src/tools/execTool.js";
import {
  EXEC_CATALOG_MARKER_PREFIX,
  EXEC_CATALOG_MARKER_SUFFIX,
} from "../../src/exec/catalogAnnouncement.js";
import {
  catalogAnnouncements,
  catalogMarkerOf,
  section,
  startDemo,
  stopDemo,
  waitForServer,
} from "./harness.js";

/**
 * The whole lifecycle of the live catalog, over real stdio servers and real turns:
 * announced once when the pool appears, silent while nothing moves, a namespace
 * delta when a server arrives or leaves, the empty-pool notice when the last one
 * goes, and a full re-announcement when one comes back.
 *
 * Every step reads the messages the agent actually appended — nothing here calls the
 * announcement builder directly, and nothing reimplements the decision. The last
 * step hands a truncated catalog to the model and watches it find the tool through
 * the sandbox, which is the only thing the mechanism is for.
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

/** The state one announcement carries: `k` kind, `h` hash, `t` truncated, `ns` counts. */
interface CatalogMarker {
  k: "full" | "delta" | "removed";
  h?: string;
  t?: number;
  ns?: Record<string, number>;
  bh?: string;
}

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** Count maps compared order-insensitively: only the numbers are the point. */
function sameCounts(
  left: Record<string, number> | undefined,
  right: Record<string, number>,
): boolean {
  const sorted = (value: Record<string, number>) =>
    JSON.stringify(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)));
  return sorted(left ?? {}) === sorted(right);
}

/** The pool as the agent builds it: one entry per tool of every connected server. */
function poolCounts(agent: Agent): Record<string, number> {
  return Object.fromEntries(
    agent
      .getMcpServers()
      .filter((server) => (server.tools ?? []).length > 0)
      .map((server) => [server.name, (server.tools ?? []).length]),
  );
}

/** Connections settle asynchronously — wait for the pool the next turn will read. */
async function waitForPool(agent: Agent, expected: number): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const total = Object.values(poolCounts(agent)).reduce((a, b) => a + b, 0);
    if (total === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `the pool never settled at ${expected} tools, saw ${JSON.stringify(poolCounts(agent))}`,
  );
}

/**
 * Nothing half-connected, which is what `poolCounts` alone cannot tell: a server
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

/** The marker payload of one announcement. */
function markerOf(text: string): CatalogMarker {
  const line = catalogMarkerOf(text) ?? "";
  return JSON.parse(
    line.slice(
      EXEC_CATALOG_MARKER_PREFIX.length,
      line.length - EXEC_CATALOG_MARKER_SUFFIX.length,
    ),
  ) as CatalogMarker;
}

/** The body under the marker, for display: long catalogs are clipped. */
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
          `   ${text.length} chars, ${(text.length / 4).toFixed(0)} estimated tokens`,
        );
        seen.push(marker.k);
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
    console.log(
      `pool the model can reach: ${JSON.stringify(poolCounts(agent))}`,
    );

    const [first] = await step(
      "turn 1 — the pool appears, so the catalog is announced in the conversation",
    );
    check(
      first?.k === "full",
      `the first announcement is not a full catalog: ${first?.k}`,
    );
    check(first?.t === 1, "a 25-tool pool should not fit the catalog budget");
    check(
      sameCounts(first?.ns, poolCounts(agent)),
      `the announced counts ${JSON.stringify(first?.ns)} do not match the pool ${JSON.stringify(poolCounts(agent))}`,
    );
    const firstAnnouncement = catalogAnnouncements(agent)[0] ?? "";
    check(
      firstAnnouncement.includes('tools["$codemode"].search('),
      "a truncated catalog did not teach the search call form",
    );

    await step("turn 2 — nothing moved, so nothing is said");

    section(`the pool changes — ${SMALL_SERVER} goes away`);
    await agent.disconnectMcpServer(SMALL_SERVER);
    await waitForPool(agent, 24);
    const [delta] = await step(
      "turn 3 — a server leaves: a namespace delta, not a second catalog",
    );
    check(delta?.k === "delta", `expected a delta, got ${delta?.k}`);
    check(
      delta?.bh === first?.h,
      `the delta is not anchored to the catalog it is relative to: ${delta?.bh} vs ${first?.h}`,
    );
    const deltaText = catalogAnnouncements(agent).at(-1) ?? "";
    check(
      deltaText.includes(`\`mcp__${SMALL_SERVER}\` is no longer available`),
      "the delta does not name the departed server",
    );
    check(
      !deltaText.includes("tools.mcp__"),
      "the delta repeated entries instead of naming what moved",
    );

    section(`the pool changes back — ${SMALL_SERVER} returns`);
    await agent.connectMcpServer(SMALL_SERVER);
    await waitForServer(agent, SMALL_SERVER);
    await waitForPool(agent, 25);
    const [reDelta] = await step("turn 4 — a server arrives: a delta again");
    check(reDelta?.k === "delta", `expected a delta, got ${reDelta?.k}`);
    check(
      (catalogAnnouncements(agent).at(-1) ?? "").includes(
        `\`mcp__${SMALL_SERVER}\` is now available`,
      ),
      "the delta does not name the arriving server",
    );

    section(`the pool shrinks below the budget — ${BULK_SERVER} goes away`);
    await agent.disconnectMcpServer(BULK_SERVER);
    await waitForPool(agent, 1);
    const [small] = await step(
      "turn 5 — truncation flips, so the delta cannot express it: full catalog",
    );
    check(small?.k === "full", `expected a full catalog, got ${small?.k}`);
    check(small?.t === 0, "a one-tool catalog was announced as truncated");
    check(
      !(catalogAnnouncements(agent).at(-1) ?? "").includes(
        'tools["$codemode"].search(',
      ),
      "a complete catalog advertised a search it does not need",
    );

    section("the pool empties");
    await agent.disconnectMcpServer(SMALL_SERVER);
    await waitForPool(agent, 0);
    const [emptied] = await step("turn 6 — the last server goes away");
    check(emptied?.k === "full", `expected a full note, got ${emptied?.k}`);
    const emptiedText = catalogAnnouncements(agent).at(-1) ?? "";
    check(
      emptiedText.includes("No MCP tools are currently available"),
      "the emptied pool was not announced",
    );
    check(
      !emptiedText.includes("Exec"),
      "the empty-pool note names Exec, which is not declared while the pool is empty",
    );

    section("the pool comes back");
    await agent.connectMcpServer(BULK_SERVER);
    await waitForServer(agent, BULK_SERVER);
    await waitForPool(agent, 24);
    const [again] = await step("turn 7 — a full catalog again");
    check(again?.k === "full", `expected a full catalog, got ${again?.k}`);
    check(
      sameCounts(again?.ns, poolCounts(agent)),
      "the re-announced counts do not match the pool",
    );

    section("the point of the exercise — a truncated catalog, used");
    const beforeUse = catalogAnnouncements(agent).length;
    await agent.sendMessage(
      "Your catalog of MCP tools is partial. Find the tool that runs bulk step 7 " +
        "and call it with target `orders`. Then report the tool name.",
    );
    check(
      catalogAnnouncements(agent).length === beforeUse,
      "the last turn announced something although the pool had not moved",
    );
    const used = agent.messages.some((message) =>
      message.blocks.some(
        (block) =>
          block.type === "tool" &&
          (block.parameters ?? "").includes("mcp__bulk-demo__bulk_step_7"),
      ),
    );
    console.log(
      `reached the unlisted tool from inside the sandbox: ${used ? "yes" : "no"}`,
    );
    if (!used) {
      console.log(
        "   (the model did not get there — the mechanism is what was under test, not the model)",
      );
    }

    section("what the whole lifecycle cost");
    console.log(
      `announcements: ${seen.length} over 8 turns — ${seen.join(", ")}`,
    );
    console.log(
      `added to the conversation: ${spent} chars (~${(spent / 4).toFixed(0)} estimated tokens)`,
    );
    check(
      seen.join(",") === "full,—,delta,delta,full,full,full",
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
