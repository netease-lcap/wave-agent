#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import { buildExecCatalogAnnouncement } from "../../src/exec/catalogAnnouncement.js";
import {
  renderSearchCallForm,
  resolveSearchArgs,
  searchPool,
} from "../../src/exec/catalog.js";
import type { ExecPoolEntry, ExecSearchHit } from "../../src/exec/catalog.js";
import { execTool } from "../../src/tools/execTool.js";
import {
  catalogAnnouncements,
  section,
  startDemo,
  stopDemo,
  waitForServer,
} from "./harness.js";

/**
 * What the model actually reads about its on-demand tools, from a real connection:
 * the tail announcement `Exec` appends for that pool (names only), then the
 * signatures it pulls out of `search` when it is ready to call one.
 *
 * The announcement is built here the way the agent builds it each turn
 * (`buildExecCatalogAnnouncement` with no prior history) so its shape can be
 * asserted without spending a turn; the last section then reads the announcement a
 * real turn actually appended, which is also where the built-in half of the list
 * shows up (they are in the same set — this demo's MCP tools are just the readable
 * half of it). `Exec`'s own description is printed to show it stays pool-independent.
 *
 * Run from `packages/agent-sdk`:
 *
 *   npx tsx examples/mcp/catalog-example.ts
 */

const CATALOG_SERVER = "catalog-demo";
const BULK_SERVER = "bulk-demo";
const CATALOG_SCRIPT = fileURLToPath(
  new URL("./catalog-server.mjs", import.meta.url),
);
/**
 * A second server with 24 tools, none of whose names occur in the first: the list
 * has to hold more than one server, and a large one is what makes the size
 * comparison below mean something. (Its names must stay distinct — two servers
 * declaring the same tool name collapse into one flattened name, since the
 * host attributes a tool to the first server it finds by that name.)
 */
const BULK_SCRIPT = fileURLToPath(
  new URL("./bulk-server.mjs", import.meta.url),
);

const failures: string[] = [];
const findings: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** The MCP half of the pool, flattened the way `buildExecPool` does. */
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

/** The announcement a session with no prior list receives for this pool. */
function announcementFor(pool: ExecPoolEntry[]): string {
  return (
    buildExecCatalogAnnouncement(
      null,
      pool.map((entry) => entry.name),
    ) ?? ""
  );
}

/** One hit, fetched by exact name — the `select:` form, not a keyword guess. */
function find(pool: ExecPoolEntry[], name: string): ExecSearchHit {
  const { matches } = searchPool(
    pool,
    resolveSearchArgs({ query: `select:${name}` }),
  );
  const hit = matches.find((candidate) => candidate.name === name);
  if (!hit) throw new Error(`search did not return "${name}"`);
  return hit;
}

/**
 * No server mid-handshake: a connection in flight reports zero tools and lands in
 * the pool a moment later, which would show up as one more announcement.
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

async function main(): Promise<void> {
  let agent: Agent | undefined;
  let workDir: string | undefined;

  try {
    const demo = await startDemo({
      workdirPrefix: "wave-exec-catalog-",
      servers: [
        { name: CATALOG_SERVER, script: CATALOG_SCRIPT },
        { name: BULK_SERVER, script: BULK_SCRIPT },
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

    await waitForServer(agent, CATALOG_SERVER);
    await waitForServer(agent, BULK_SERVER);
    // This machine's user-level config may declare MCP servers of its own, and one
    // connecting mid-demo would change the pool — which is exactly what the
    // announcement reports, so the numbers below would move under the demo's feet.
    // Drop them (this agent only; the config files are untouched).
    const ambient = agent
      .getMcpServers()
      .filter(
        (server) =>
          server.name !== CATALOG_SERVER && server.name !== BULK_SERVER,
      );
    if (ambient.length > 0) {
      section(
        "isolating the demo — servers this machine configured on its own",
      );
      for (const server of ambient) {
        await agent.disconnectMcpServer(server.name);
        console.log(`dropped \`${server.name}\``);
      }
    }
    await settle(agent);

    const pool = flatten(agent);
    section(`the pool — ${pool.length} tools over 2 servers`);
    for (const entry of pool) console.log(`  ${entry.name}`);

    // The deployed text: what the model is handed for this exact pool.
    const note = announcementFor(pool);
    const listed = note
      .split("\n")
      .filter((line) => line.startsWith("- `"))
      .map((line) => line.slice(3, -1));
    check(note !== "", "no announcement was rendered for a non-empty pool");
    check(
      !(execTool.config.function.description ?? "").includes("mcp__"),
      "the Exec description names a tool: it must stay independent of the pool",
    );

    section("the announcement — names, sorted, nothing else");
    console.log(note);
    check(
      listed.length === pool.length,
      `listed ${listed.length} names for a pool of ${pool.length}`,
    );
    // Sorted, so the body — and the hash that decides whether to announce at all —
    // is a function of the set of names rather than of connection order.
    check(
      listed.join("\n") === [...listed].sort().join("\n"),
      "the names are not sorted, so connection order leaks into the body",
    );
    check(
      listed.includes(`mcp__${BULK_SERVER}__bulk_step_23`),
      "a tool of the second server is missing from the list",
    );

    section("the announcement — no signature, no prose, no budget");
    // The list is a set of names. Everything the model needs to *call* one lives in
    // `search`, so a schema can appear in exactly one place.
    check(!note.includes("Promise<"), "the announcement carries a return type");
    check(!note.includes("inputSchema"), "the announcement carries a schema");
    check(
      !note.includes("Registers a component in the catalog"),
      "the announcement carries a tool description",
    );
    check(
      !note.includes("PARTIAL") && !/\b\d{3,}\b/.test(note),
      "the announcement carries a truncation notice or a budget number",
    );
    check(
      note.includes('tools["$codemode"].search'),
      "the announcement does not point at the search entry",
    );

    section("the signature channel — a non-identifier name, in bracket form");
    const deep = find(pool, `mcp__${CATALOG_SERVER}__deep_lookup`);
    console.log(deep.signature);
    check(
      deep.signature.startsWith('tools["mcp__catalog-demo__deep_lookup"]('),
      "the non-identifier name is not rendered in bracket form",
    );
    check(
      deep.signature.includes("unknown"),
      "the depth guard did not render `unknown`",
    );
    check(
      !deep.signature.includes("innermost value"),
      "the renderer descended past the depth guard",
    );

    section("wide enum — every variant rendered");
    const channel = find(pool, `mcp__${CATALOG_SERVER}__set_channel`);
    const variants = (channel.signature.match(/"[a-z]+"/g) ?? []).length;
    console.log(channel.signature);
    console.log(`${variants} variants rendered`);
    check(
      variants === 12,
      `expected all 12 enum variants, rendered ${variants}`,
    );
    check(
      channel.signature.includes('"sunset"'),
      "the last enum variant was dropped",
    );

    section("field docs — verbatim, multi-line, uncapped");
    console.log(
      channel.signature
        .split("\n")
        .filter((line) => line.includes("*"))
        .join("\n"),
    );
    check(
      channel.signature.includes("for a pre-release build."),
      "a multi-line field description was cut off",
    );

    section("tool description — beside the signature, whole");
    // A hit carries the description as its own field rather than splicing a clamped
    // first line into the signature: the model asked for this tool, so nothing about
    // it is hidden, and the call it copies out stays parseable.
    const registry = find(pool, `mcp__${CATALOG_SERVER}__describe_registry`);
    console.log(registry.description ?? "(no description)");
    check(
      (registry.description ?? "").includes(
        "This second line is kept, not clamped.",
      ),
      "the second description line was dropped",
    );
    check(
      !registry.signature.includes("Registers a component"),
      "a description was spliced into the signature",
    );

    section("return type — from the server's own output schema");
    const reverse = find(pool, `mcp__${CATALOG_SERVER}__reverse_text`);
    console.log(reverse.signature);
    check(
      reverse.signature.includes("Promise<{"),
      "a declared output schema did not reach the signature",
    );
    check(
      reverse.signature.includes("reversed: string,"),
      "the declared output schema was not rendered field by field",
    );
    // The tools that declare nothing still get a return type: leaving it out
    // would read as "this call returns nothing".
    check(
      find(pool, `mcp__${CATALOG_SERVER}__word_count`).signature.includes(
        "): Promise<unknown>",
      ),
      "an undeclared output schema did not fall back to `unknown`",
    );

    section("union — how many anyOf variants survive?");
    const engine = find(pool, `mcp__${CATALOG_SERVER}__pick_engine`);
    const rendered = (engine.signature.match(/kind/g) ?? []).length;
    console.log(engine.signature);
    console.log(`rendered ${rendered} of the 6 declared variants`);
    if (rendered !== 6) {
      findings.push(
        `anyOf is sliced to ${rendered} variants with no marker, while the spec says the depth guard is the only silent reduction (docs/specs/core/exec-tool.md, scenario 2)`,
      );
    }

    section("ranking — name matches before descriptions");
    const ranked = searchPool(pool, resolveSearchArgs({ query: "channel" }));
    console.log(
      ranked.matches.map((hit) => hit.name).join("\n") || "(no match)",
    );
    check(
      ranked.matches[0]?.name === `mcp__${CATALOG_SERVER}__set_channel`,
      "a name match did not outrank a description match",
    );

    section("the cap is visible — `total` counts what it hid");
    const capped = searchPool(
      pool,
      resolveSearchArgs({ query: "text", max_results: 2 }),
    );
    console.log(
      `shown ${capped.matches.length} of ${capped.total}: ` +
        capped.matches.map((hit) => hit.name).join(", "),
    );
    check(
      capped.matches.length === 2 && capped.total > 2,
      "the cap did not report the hits it hid",
    );

    section("`select:` names tools exactly, and passes the cap");
    const chosen = searchPool(
      pool,
      resolveSearchArgs({
        query: `select:mcp__${BULK_SERVER}__bulk_step_7,mcp__${CATALOG_SERVER}__shout`,
        max_results: 1,
      }),
    );
    console.log(chosen.matches.map((hit) => hit.name).join("\n"));
    check(
      chosen.matches.map((hit) => hit.name).join(",") ===
        `mcp__${BULK_SERVER}__bulk_step_7,mcp__${CATALOG_SERVER}__shout`,
      "`select:` did not return exactly the names given, in order",
    );

    section("search validation");
    let shapeError = "";
    try {
      resolveSearchArgs({ q: "text" });
    } catch (error) {
      shapeError = String(error);
    }
    console.log(shapeError || "(no error thrown)");
    check(
      shapeError.includes(renderSearchCallForm()),
      "the shape error does not name the expected call form",
    );

    section("a live turn — the model reads this text and acts on it");
    await agent.sendMessage(
      "Using one of the on-demand tools announced in your context, move the " +
        "release channel to `canary`. Report the tool name.",
    );
    const real = catalogAnnouncements(agent);
    // Not "exactly one": a server this machine configured on its own can finish
    // connecting mid-turn, and that appends a second announcement for the larger
    // pool. That is the mechanism working (one announcement per change), not a
    // failure — what matters is that the list the turn acted on names the tool.
    check(real.length >= 1, "the live turn produced no announcement at all");
    const realNote = real[0] ?? "";
    check(
      realNote.includes(`- \`mcp__${CATALOG_SERVER}__set_channel\``),
      "the announced list does not name the tool the turn needed",
    );
    // Built-ins are deferred by the same judgment, so they share the list — this is
    // the half the demo's own pool reconstruction cannot show.
    check(
      realNote.includes("- `WebFetch`"),
      "deferred built-ins are missing from the announced list",
    );
    const used = agent.messages.some((message) =>
      message.blocks.some(
        (block) =>
          block.type === "tool" &&
          (block.parameters ?? "").includes(
            `mcp__${CATALOG_SERVER}__set_channel`,
          ),
      ),
    );
    console.log(`called from the announced list: ${used ? "yes" : "no"}`);
    if (!used) {
      console.log(
        "   (the model did not get there — the mechanism is what was under test, not the model)",
      );
    }
  } catch (error) {
    console.error("\n❌ Error:", error);
    failures.push(String(error));
  } finally {
    if (findings.length > 0) {
      console.log("\n⚠️  findings (not a failure of the example):");
      for (const finding of findings) console.log(`   - ${finding}`);
    }
    await stopDemo(agent, workDir, failures);
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
