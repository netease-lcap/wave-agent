#!/usr/bin/env tsx

import { fileURLToPath } from "url";
import { Agent } from "../../src/agent.js";
import {
  renderCatalog,
  renderSearchCallForm,
  resolveSearchQuery,
} from "../../src/exec/catalog.js";
import type { RenderedCatalog, ExecPoolEntry } from "../../src/exec/catalog.js";
import { EXEC_DEFAULT_CATALOG_TOKENS } from "../../src/exec/constants.js";
import { buildExecCatalogAnnouncement } from "../../src/exec/catalogAnnouncement.js";
import { execTool } from "../../src/tools/execTool.js";
import { section, startDemo, stopDemo, waitForServer } from "./harness.js";

/**
 * What the model actually reads about its MCP tools, rendered from a real
 * connection: the tail announcement `Exec` produces for that pool (signatures +
 * field docs + the way back to a truncated catalog), then the truncation shape
 * under a budget too small to fit the pool.
 *
 * The first half is the deployed text. The announcement is built here the way the
 * agent builds it each turn (`buildExecCatalogAnnouncement` with no prior history);
 * `Exec`'s own description is printed to show it stays pool-independent. The second
 * half re-renders the same pool with a small budget because the deployed budget
 * (2000 estimated tokens) is far too generous to truncate nine tools.
 *
 * Run from `packages/agent-sdk`:
 *
 *   npx tsx examples/mcp/catalog-example.ts
 */

const CATALOG_SERVER = "catalog-demo";
const SIDE_SERVER = "side-demo";
const CATALOG_SCRIPT = fileURLToPath(
  new URL("./catalog-server.mjs", import.meta.url),
);
/** A second, single-tool server, so truncation has a server to starve. */
const SIDE_SCRIPT = fileURLToPath(
  new URL("./oversized-server.mjs", import.meta.url),
);

const failures: string[] = [];
const findings: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

/** The pool as the agent sees it, flattened the way `buildExecPool` does. */
function flatten(agent: Agent): ExecPoolEntry[] {
  return agent.getMcpServers().flatMap((server) =>
    (server.tools ?? []).map((tool) => ({
      name: `mcp__${server.name}__${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
}

/** The announcement a session with no prior catalog receives for this pool. */
function announcementFor(catalog: RenderedCatalog): string {
  return (
    buildExecCatalogAnnouncement(
      { last: null, fullHashes: new Set<string>() },
      catalog,
    ) ?? ""
  );
}

/** One rendered catalog entry: its signature block plus the trailing description. */
function entryFor(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) =>
    line.includes(`mcp__catalog-demo__${name}`),
  );
  if (start < 0) return "";
  const entry = [lines[start]];
  for (let i = start + 1; i < lines.length; i += 1) {
    entry.push(lines[i]);
    // A signature closes at column 0; the description rides on that same line.
    if (lines[i].startsWith("}")) break;
  }
  return entry.join("\n");
}

async function main(): Promise<void> {
  let agent: Agent | undefined;
  let workDir: string | undefined;

  try {
    const demo = await startDemo({
      workdirPrefix: "wave-exec-catalog-",
      servers: [
        { name: CATALOG_SERVER, script: CATALOG_SCRIPT },
        { name: SIDE_SERVER, script: SIDE_SCRIPT },
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
    await waitForServer(agent, SIDE_SERVER);

    const pool = flatten(agent);
    section(`the pool — ${pool.length} tools over 2 servers`);
    for (const entry of pool) console.log(`  ${entry.name}`);

    // The deployed text: what the model is handed for this exact pool.
    const catalog = renderCatalog(pool, EXEC_DEFAULT_CATALOG_TOKENS);
    const prompt = announcementFor(catalog);
    check(
      prompt !== "",
      "no catalog announcement was rendered for a non-empty pool",
    );
    check(
      !(execTool.config.function.description ?? "").includes("mcp__"),
      "the Exec description names a tool: it must stay independent of the pool",
    );

    section("signature — a non-identifier name, in bracket form");
    const deep = entryFor(prompt, "deep_lookup");
    console.log(deep);
    check(
      prompt.includes('tools["mcp__catalog-demo__deep_lookup"]'),
      "the non-identifier name is not rendered in bracket form",
    );
    check(deep.includes("unknown"), "the depth guard did not render `unknown`");
    check(
      !deep.includes("innermost value"),
      "the renderer descended past the depth guard",
    );

    section("wide enum — every variant rendered");
    const channel = entryFor(prompt, "set_channel");
    const variants = (channel.match(/"[a-z]+"/g) ?? []).length;
    console.log(`${variants} variants rendered`);
    check(
      variants === 12,
      `expected all 12 enum variants, rendered ${variants}`,
    );
    check(channel.includes('"sunset"'), "the last enum variant was dropped");

    section("field docs — verbatim, multi-line, uncapped");
    console.log(
      channel
        .split("\n")
        .filter((line) => line.includes("*"))
        .join("\n"),
    );
    check(
      channel.includes("for a pre-release build."),
      "a multi-line field description was cut off",
    );

    section("tool description — first line only, clamped at 120");
    const registry = entryFor(prompt, "describe_registry");
    console.log(registry);
    check(
      registry.includes("..."),
      "the long tool description was not clamped",
    );
    check(
      !registry.includes("This second line is padding"),
      "the second description line survived the clamp",
    );

    section("union — how many anyOf variants survive?");
    const engine = entryFor(prompt, "pick_engine");
    const rendered = (engine.match(/kind/g) ?? []).length;
    console.log(engine);
    console.log(`rendered ${rendered} of the 6 declared variants`);
    if (rendered !== 6) {
      findings.push(
        `anyOf is sliced to ${rendered} variants with no marker, while the spec says the depth guard is the only silent reduction (docs/specs/core/exec-tool.md, scenario 2)`,
      );
    }

    section("search entry — advertised only while the catalog is truncated");
    const starved = renderCatalog(pool, 40);
    const starvedNote = announcementFor(starved);
    console.log(
      starvedNote
        .split("\n")
        .filter((line) => line.includes("search") || line.includes("pool"))
        .join("\n"),
    );
    check(
      starvedNote.includes(
        "Omit it (or pass an empty string) to list the entire pool.",
      ),
      "the truncated catalog does not document the empty query",
    );
    check(
      starvedNote.includes('tools["$codemode"].search('),
      "the search signature is not rendered from its schema",
    );
    check(
      !prompt.includes('tools["$codemode"].search('),
      "a complete catalog advertised a search anyway",
    );

    section("search validation");
    check(
      resolveSearchQuery({}) === "",
      "an empty call is not treated as listing the full pool",
    );
    check(
      resolveSearchQuery({ query: "  WORD  " }) === "word",
      "the query is not trimmed and case-folded",
    );
    let shapeError = "";
    try {
      resolveSearchQuery({ q: "text" });
    } catch (error) {
      shapeError = String(error);
    }
    console.log(shapeError || "(no error thrown)");
    check(
      shapeError.includes(renderSearchCallForm()),
      "the shape error does not name the expected call form",
    );

    section("the deployed budget does not truncate this pool");
    check(
      !catalog.text.includes("PARTIAL"),
      `9 tools should fit the default budget, but the catalog says: ${catalog.text.slice(-120)}`,
    );
    check(
      !/^- mcp__/m.test(catalog.text),
      "an untruncated catalog printed per-server summary lines",
    );

    section("a starved budget — one summary line per server");
    console.log(starved.text);
    console.log(
      `\nshown ${starved.shown}/${starved.total}, truncated=${starved.truncated}`,
    );
    check(starved.truncated, "a 40-token budget did not truncate");
    check(
      starved.text.includes(`- mcp__${CATALOG_SERVER} (8 tools, `),
      "the starved server has no summary line",
    );
    check(
      starved.text.includes(`- mcp__${SIDE_SERVER} (1 tool, none shown)`),
      "the server that got no seat is not named as `none shown`",
    );
    const partialLine =
      starved.text.split("\n").find((line) => line.startsWith("PARTIAL")) ?? "";
    check(
      /^PARTIAL — \d+ of 9 tools shown/.test(partialLine),
      `the PARTIAL line is missing or malformed: ${partialLine}`,
    );
    check(
      !partialLine.includes("40") && !partialLine.includes("2000"),
      "the PARTIAL line leaked a budget number",
    );

    section("a live turn — the model reads this text and acts on it");
    await agent.sendMessage(
      "Using one of the MCP tools announced in your context, move the release " +
        "channel to `canary`. Report the tool name.",
    );
    const execBlocks = agent.messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === "tool"),
    );
    const used = execBlocks.some((block) =>
      (block.parameters ?? "").includes("mcp__catalog-demo__set_channel"),
    );
    console.log(`called from the announced catalog: ${used ? "yes" : "no"}`);
    check(used, "the model did not reach the tool through the sandbox");
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
