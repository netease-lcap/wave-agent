#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import { buildReplCatalogAnnouncement } from "../../src/repl/catalogAnnouncement.js";
import {
  renderSearchCallForm,
  renderSearchSignature,
  renderToolSignature,
  searchTools,
} from "../../src/repl/catalog.js";
import type { ReplPoolEntry } from "../../src/repl/catalog.js";
import { replTool } from "../../src/tools/replTool.js";
import {
  catalogAnnouncements,
  section,
  startDemo,
  stopDemo,
  waitForServer,
} from "./harness.js";

/**
 * What the model actually reads about its on-demand tools, from a real connection:
 * the tail announcement `REPL` appends for that pool (server names for the MCP half,
 * names for the deferred built-ins), then the shapes it pulls out of `searchTools`
 * when it is ready to call one.
 *
 * The announcement is built here the way the agent builds it each turn
 * (`buildReplCatalogAnnouncement` with no prior history) so its shape can be
 * asserted without spending a turn; the last section then reads the announcement a
 * real turn actually appended, which is also where the built-in half of the list
 * shows up (they are in the same set — this demo's MCP tools are just the readable
 * half of it). `REPL`'s own description is printed to show it stays pool-independent.
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

/** The MCP half of the pool, flattened the way `buildReplPool` does. */
function flatten(agent: Agent): ReplPoolEntry[] {
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
function announcementFor(pool: ReplPoolEntry[]): string {
  return (
    buildReplCatalogAnnouncement(
      null,
      pool.map((entry) => entry.name),
    ) ?? ""
  );
}

/**
 * One pooled entry, reached the way a script reaches it: an exact name handed to the
 * search entry point. The hit is the confirmation; the entry is what carries the
 * schema, so the signature below is rendered from the pool rather than from the
 * bounded text the hit carries.
 */
function find(pool: ReplPoolEntry[], name: string): ReplPoolEntry {
  const hit = searchTools(pool, name)[0];
  if (hit?.name !== name) throw new Error(`search did not return "${name}"`);
  const entry = pool.find((candidate) => candidate.name === name);
  if (!entry) throw new Error(`the pool has no "${name}"`);
  return entry;
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

    // The deployed text: what the model is handed for this exact pool. This
    // reconstruction is MCP-only (see `flatten`), so the whole of it lands in tier 3.
    const note = announcementFor(pool);
    check(note !== "", "no announcement was rendered for a non-empty pool");
    check(
      !(replTool.config.function.description ?? "").includes("mcp__"),
      "the REPL description names a tool: it must stay independent of the pool",
    );

    section("the REPL description teaches the entry point its own shape");
    // Every pool tool's shape is reachable *through* `searchTools`, which is why the
    // announcement never carries one. `searchTools` is not in the pool, so its own
    // shape has no other channel: left out of the description, the model can only
    // guess a parameter name and wait for the error to correct it.
    const description = replTool.config.function.description ?? "";
    const from = description.indexOf("- `await tools.");
    const to = description.indexOf("- `self.log(");
    if (from >= 0 && to > from)
      console.log(description.slice(from, to).trimEnd());
    // Indented under its bullet, so this is the signature's own bytes plus two spaces.
    check(
      description.replace(/^ {2}/gm, "").includes(renderSearchSignature()),
      "the REPL description does not carry searchTools' own signature",
    );
    const lean =
      typeof replTool.leanPrompt === "string" ? replTool.leanPrompt : "";
    check(
      lean.includes(renderSearchCallForm()),
      "the lean prompt does not carry the one-line call form",
    );
    check(!/^- - /m.test(lean), "the lean prompt doubles its bullet marker");

    section("the announcement — servers, not their tools");
    console.log(note);
    const serversInNote = [
      ...new Set(pool.map((entry) => entry.name.split("__")[1])),
    ];
    check(
      serversInNote.every((server) => note.includes(`\`${server}\``)),
      "a connected server is missing from the announcement",
    );
    // A server can bring dozens of tools, so listing them would make the body grow
    // with every connection made. The server name is the whole of what tier 3 owes.
    check(
      serversInNote.every((server) => !note.includes(`mcp__${server}__`)),
      "the announcement lists MCP tools instead of their server",
    );
    check(
      !note.includes("Also callable as"),
      "an MCP-only pool produced a tier-2 line",
    );
    // Sorted, so the body — and the comparison that decides whether to announce
    // at all — is a function of the set of servers rather than of connection order.
    const orderedServers = [...serversInNote].sort();
    const positions = orderedServers.map((server) =>
      note.indexOf(`\`${server}\``),
    );
    check(
      positions.every(
        (at, index) => at >= 0 && (index === 0 || at > positions[index - 1]),
      ),
      "the server names are not sorted, so connection order leaks into the body",
    );

    section("the announcement — no signature, no prose, no budget");
    // The body is a map of what is reachable. Everything the model needs to *call*
    // one lives in search, `describeTool` and the signatures of tier 1, so a schema
    // can appear in exactly one place.
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
      note.includes("searchTools"),
      "the announcement does not point at the search entry",
    );

    section("the signature channel — a non-identifier name, in bracket form");
    const deep = find(pool, `mcp__${CATALOG_SERVER}__deep_lookup`);
    const deepSignature = renderToolSignature(deep);
    console.log(deepSignature);
    check(
      deepSignature.startsWith('tools["mcp__catalog-demo__deep_lookup"]('),
      "the non-identifier name is not rendered in bracket form",
    );
    check(
      deepSignature.includes("unknown"),
      "the depth guard did not render `unknown`",
    );
    check(
      !deepSignature.includes("innermost value"),
      "the renderer descended past the depth guard",
    );

    section("wide enum — every variant rendered");
    const channel = find(pool, `mcp__${CATALOG_SERVER}__set_channel`);
    const channelSignature = renderToolSignature(channel);
    const variants = (channelSignature.match(/"[a-z]+"/g) ?? []).length;
    console.log(channelSignature);
    console.log(`${variants} variants rendered`);
    check(
      variants === 12,
      `expected all 12 enum variants, rendered ${variants}`,
    );
    check(
      channelSignature.includes('"sunset"'),
      "the last enum variant was dropped",
    );

    section("field docs — verbatim, multi-line, uncapped");
    console.log(
      channelSignature
        .split("\n")
        .filter((line) => line.includes("*"))
        .join("\n"),
    );
    check(
      channelSignature.includes("for a pre-release build."),
      "a multi-line field description was cut off",
    );

    section("tool description — beside the signature, whole");
    // The description is its own field rather than a clamped first line spliced into
    // the signature: the model asked for this tool, so nothing about it is hidden,
    // and the call it copies out stays parseable.
    const registry = find(pool, `mcp__${CATALOG_SERVER}__describe_registry`);
    console.log(registry.description ?? "(no description)");
    check(
      (registry.description ?? "").includes(
        "This second line is kept, not clamped.",
      ),
      "the second description line was dropped",
    );
    check(
      !renderToolSignature(registry).includes("Registers a component"),
      "a description was spliced into the signature",
    );

    section("return type — from the server's own output schema");
    const reverse = find(pool, `mcp__${CATALOG_SERVER}__reverse_text`);
    const reverseSignature = renderToolSignature(reverse);
    console.log(reverseSignature);
    check(
      reverseSignature.includes("Promise<{"),
      "a declared output schema did not reach the signature",
    );
    check(
      reverseSignature.includes("reversed: string,"),
      "the declared output schema was not rendered field by field",
    );
    // The tools that declare nothing still get a return type: leaving it out
    // would read as "this call returns nothing".
    check(
      renderToolSignature(
        find(pool, `mcp__${CATALOG_SERVER}__word_count`),
      ).includes("): Promise<unknown>"),
      "an undeclared output schema did not fall back to `unknown`",
    );

    section("union — how many anyOf variants survive?");
    const engine = find(pool, `mcp__${CATALOG_SERVER}__pick_engine`);
    const engineSignature = renderToolSignature(engine);
    const rendered = (engineSignature.match(/kind/g) ?? []).length;
    console.log(engineSignature);
    console.log(`rendered ${rendered} of the 6 declared variants`);
    if (rendered !== 6) {
      findings.push(
        `anyOf is sliced to ${rendered} variants with no marker, while the spec says the depth guard is the only silent reduction (docs/specs/core/repl-tool.md, scenario 2)`,
      );
    }

    section("ranking — name matches before descriptions");
    const ranked = searchTools(pool, "channel");
    console.log(ranked.map((hit) => hit.name).join("\n") || "(no match)");
    check(
      ranked[0]?.name === `mcp__${CATALOG_SERVER}__set_channel`,
      "a name match did not outrank a description match",
    );

    section("the cap — a hit list, not a count of what it hid");
    const capped = searchTools(pool, "text", 2);
    console.log(
      `shown ${capped.length}: ${capped.map((hit) => hit.name).join(", ")}`,
    );
    check(capped.length === 2, "a positive `max` did not cap the hit list");
    check(
      searchTools(pool, "text").length > 2,
      "the cap did not actually narrow anything",
    );
    check(
      searchTools(pool, "text", 999).length <= 25,
      "a `max` above the ceiling was not clamped",
    );

    section("a hit carries its own shape — name, about, input");
    const shape = ranked[0];
    check(
      shape !== undefined &&
        Object.keys(shape).sort().join(",") === "about,input,name",
      "a hit is not exactly { name, about, input }",
    );
    // The input type only: a return type here would invite the model to read a hit
    // as a substitute for `describeTool`.
    check(
      !(capped[0]?.input ?? "").includes("Promise<"),
      "a hit's `input` carries a return type",
    );

    section("an `mcp__` query is a server prefix, not keywords");
    const bulk = searchTools(pool, `mcp__${BULK_SERVER}__`);
    console.log(`${bulk.length} tools on \`${BULK_SERVER}\``);
    check(
      bulk.length > 0 &&
        bulk.every((hit) => hit.name.startsWith(`mcp__${BULK_SERVER}__`)),
      "a server-prefix query reached tools on other servers",
    );

    section("search validation");
    let shapeError = "";
    try {
      searchTools(pool, "");
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

    section("the entry point's shape, as the turn actually used it");
    // The payoff of putting the signature in the description: the call is built the
    // first time. Without it the transcript carries the correction round-trip
    // instead — a guessed parameter name, then the error that names the right one.
    const searches = agent.messages.flatMap((message) =>
      message.blocks.flatMap((block) =>
        block.type === "tool" &&
        (block.parameters ?? "").includes("searchTools")
          ? [block.parameters ?? ""]
          : [],
      ),
    );
    const toolResults = agent.messages.reduce(
      (count, message) =>
        count +
        message.blocks.filter((block) => block.type === "tool" && block.result)
          .length,
      0,
    );
    const corrected = agent.messages.reduce(
      (count, message) =>
        count +
        message.blocks.filter(
          (block) =>
            block.type === "tool" &&
            /does not take "|expects "(query|max_results)"/.test(
              block.result ?? "",
            ),
        ).length,
      0,
    );
    if (searches.length > 0) {
      console.log("— the script it wrote:");
      console.log(searches[searches.length - 1]);
    }
    console.log(
      `searchTools calls: ${searches.length}; tool results scanned: ${toolResults}; ` +
        `shape errors: ${corrected}`,
    );
    // A soft signal on purpose: one sample of one model. Zero reads as "the call was
    // built without guessing"; it only means anything because something was scanned.
    if (searches.length > 0 && toolResults > 0 && corrected > 0) {
      findings.push(
        `${corrected} searchTools shape error(s) — a parameter name was guessed, which the signature in the description exists to prevent`,
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
