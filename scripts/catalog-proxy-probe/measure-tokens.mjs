#!/usr/bin/env node
/**
 * Catalog size measurement (token-denominated, CJK-aware).
 *
 * Uses the repo's own estimator (`estimateTokens`: CJK 1 char/token, other
 * 4 chars/token, 2 for JSON payloads) instead of the borrowed "8000 chars /
 * 2000 est tokens" rule of thumb.
 *
 * Measures, for a realistic pool (all built-in tools + a few MCP tools):
 *   - flat declaration cost  = the `tools[]` payload as declared today
 *   - catalog cost           = the compact-signature catalog for the same pool
 *   - compression ratio      = flat / catalog
 * and finds where the resident catalog starts truncating (PARTIAL) as the MCP
 * tool count grows, for both an English and a Chinese description pool.
 *
 * Run:
 *   pnpm exec tsx scripts/catalog-proxy-probe/measure-tokens.mjs --outDir /tmp/...
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../../packages/agent-sdk/src/index.ts";
import { estimateTokens } from "../../packages/agent-sdk/src/utils/tokenEstimate.ts";
import { buildEntries, makeSyntheticTool, renderCatalog } from "./catalog.mjs";
import { PROBE_TOOLS } from "./schemas.mjs";

const NAMESPACE = "probe";
const HERE = dirname(fileURLToPath(import.meta.url));
void HERE;

/** @param {string[]} argv */
function parseArgs(argv) {
  const out = { outDir: "/tmp/catalog-proxy-probe-results", mcpTools: 5 };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    if (argv[i].slice(2) === "outDir") out.outDir = argv[i + 1];
    if (argv[i].slice(2) === "mcpTools") out.mcpTools = Number(argv[i + 1]);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.outDir, { recursive: true });
const HOME = join(args.outDir, "home");
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.WAVE_DISABLE_AUTO_MEMORY = "true";

const workdir = mkdtempSync(join(tmpdir(), "catalog-tokens-"));
// No `tools` option: the pool under measurement is "all built-in tools".
const agent = await Agent.create({ workdir });
// Reach into the container: there is no public accessor for "the tools that
// would be declared", and the point of this measurement is to use the real
// built-in declarations, not a hand-written approximation.
const toolManager = agent.container.get("ToolManager");
const staticConfigs = toolManager.getTools().map((plugin) => plugin.config);
const resolvedConfigs = toolManager.getToolsConfig({ workdir });
await agent.destroy();
rmSync(workdir, { recursive: true, force: true });

const flatTokensWith = (configs, ext) =>
  estimateTokens(
    JSON.stringify(
      configs.map((config) => ({
        type: "function",
        function: {
          name: config.function.name,
          description: config.function.description,
          parameters: config.function.parameters,
        },
      })),
    ),
    ext,
  );

// The SDK's own convention is ext="json" for JSON payloads (tokenCalculation.ts);
// report the plain ratio too, since the catalog side is plain text and the two
// sides must be comparable.
const flatTokens = (configs) => flatTokensWith(configs, "json");

const catalogTokens = (entries, budgetTokens = 1000000) =>
  renderCatalog(entries, { budgetTokens, estimateTokens });

const report = {
  model: process.env.WAVE_MODEL,
  builtInToolCount: staticConfigs.length,
  staticFlatTokens: flatTokens(staticConfigs),
  resolvedFlatTokens: flatTokens(resolvedConfigs),
};

process.stdout.write(
  `built-in tools: ${report.builtInToolCount}\n` +
    `flat declaration, static descriptions : ${report.staticFlatTokens} tokens\n` +
    `flat declaration, prompt() overrides   : ${report.resolvedFlatTokens} tokens\n` +
    `avg per built-in tool                 : ${(report.staticFlatTokens / report.builtInToolCount).toFixed(1)} tokens\n\n`,
);

/** @param {number} count @param {"en"|"zh"} lang */
function syntheticPool(count, lang) {
  return Array.from({ length: count }, (_, index) =>
    makeSyntheticTool(index + 1, lang),
  );
}

/** Build a pseudo built-in tool entry set from the real built-in configs. */
function builtInAsTools() {
  return staticConfigs.map((config) => ({
    name: config.function.name,
    description: {
      en: config.function.description ?? "",
      zh: config.function.description ?? "",
    },
    inputSchema: config.function.parameters ?? {
      type: "object",
      properties: {},
    },
  }));
}

const builtIns = builtInAsTools();

for (const lang of /** @type {const} */ (["en", "zh"])) {
  // Typical pool per the gate definition: all built-in tools + 3-5 MCP tools.
  // Only three hand-written MCP tools exist, so pad the rest with synthetic
  // ones (same namespace, realistic description length) to reach --mcpTools.
  const mcpTools = [
    ...PROBE_TOOLS.slice(0, Math.min(PROBE_TOOLS.length, args.mcpTools)),
    ...(args.mcpTools > PROBE_TOOLS.length
      ? syntheticPool(args.mcpTools - PROBE_TOOLS.length, lang)
      : []),
  ];
  const poolTools = [...builtIns, ...mcpTools];
  const flat = flatTokens([
    ...staticConfigs,
    ...mcpTools.map((tool) => ({
      function: {
        name: `mcp__${NAMESPACE}__${tool.name}`,
        description: `${tool.description[lang]} (MCP: ${NAMESPACE})`,
        parameters: tool.inputSchema,
      },
    })),
  ]);
  const entries = [
    ...buildEntries(builtIns, "builtin", { lang, estimateTokens }),
    ...buildEntries(mcpTools, NAMESPACE, { lang, estimateTokens }),
  ];
  const catalog = catalogTokens(entries);
  const mcpEntries = entries.filter((entry) => entry.namespace === NAMESPACE);
  const mcpFlat = flatTokens(
    mcpTools.map((tool) => ({
      function: {
        name: `mcp__${NAMESPACE}__${tool.name}`,
        description: `${tool.description[lang]} (MCP: ${NAMESPACE})`,
        parameters: tool.inputSchema,
      },
    })),
  );

  report[`pool_${lang}`] = {
    tools: poolTools.length,
    flatTokens: flat,
    flatTokensPlain: flatTokensWith(
      [
        ...staticConfigs,
        ...mcpTools.map((tool) => ({
          function: {
            name: `mcp__${NAMESPACE}__${tool.name}`,
            description: `${tool.description[lang]} (MCP: ${NAMESPACE})`,
            parameters: tool.inputSchema,
          },
        })),
      ],
      undefined,
    ),
    catalogTokens: catalog.tokens,
    compression: flat / catalog.tokens,
    mcpOnly: {
      count: mcpTools.length,
      flatTokens: mcpFlat,
      catalogTokens: mcpEntries.reduce(
        (sum, entry) => sum + entry.tokens + 1,
        0,
      ),
      avgFlatPerTool: mcpFlat / mcpTools.length,
      avgCatalogPerTool:
        mcpEntries.reduce((sum, entry) => sum + entry.tokens + 1, 0) /
        mcpTools.length,
    },
  };

  const mcpOnly = report[`pool_${lang}`].mcpOnly;
  process.stdout.write(
    `pool[${lang}] ${poolTools.length} tools ` +
      `(built-ins ${builtIns.length} + MCP ${mcpTools.length})\n` +
      `  flat tools[]   : ${flat} tokens (ext=json) / ${report[`pool_${lang}`].flatTokensPlain} (plain)\n` +
      `  catalog        : ${catalog.tokens} tokens  (COMPLETE)\n` +
      `  compression    : ${(flat / catalog.tokens).toFixed(2)}x (ext=json) / ` +
      `${(report[`pool_${lang}`].flatTokensPlain / catalog.tokens).toFixed(2)}x (plain)\n` +
      `  MCP part only  : ${mcpOnly.flatTokens} -> ${mcpOnly.catalogTokens} tokens ` +
      `(${(mcpOnly.flatTokens / mcpOnly.catalogTokens).toFixed(2)}x, ` +
      `${mcpOnly.avgFlatPerTool.toFixed(1)} -> ${mcpOnly.avgCatalogPerTool.toFixed(1)} tokens/tool)\n\n`,
  );
}

// Truncation behaviour: how many MCP tools fit before PARTIAL shows up.
const budgets = [2000, 3000, 4000, 6000, 8000];
report.truncation = {};
report.descriptionClipping = {};

for (const lang of /** @type {const} */ (["en", "zh"])) {
  const builtInEntries = buildEntries(builtIns, "builtin", {
    lang,
    estimateTokens,
  });
  const builtInCatalog = catalogTokens(builtInEntries);
  report.truncation[lang] = {
    builtInCatalogTokens: builtInCatalog.tokens,
    shapes: {},
  };
  process.stdout.write(
    `truncation[${lang}] built-in-only catalog = ${builtInCatalog.tokens} tokens\n`,
  );

  for (const shape of /** @type {const} */ (["dense", "sharded"])) {
    report.truncation[lang].shapes[shape] = {};
    for (const budget of budgets) {
      let firstCut = null;
      const table = [];
      for (let count = 1; count <= 60; count++) {
        const synthetic = syntheticPool(count, lang);
        const entries = [...builtInEntries];
        if (shape === "dense") {
          entries.push(
            ...buildEntries(synthetic, "srv", { lang, estimateTokens }),
          );
        } else {
          // 5 tools per server, one namespace each: round-robin gives every
          // namespace at least one line before any namespace gets its second.
          for (let start = 0; start < synthetic.length; start += 5) {
            entries.push(
              ...buildEntries(
                synthetic.slice(start, start + 5),
                `srv${start / 5 + 1}`,
                {
                  lang,
                  estimateTokens,
                },
              ),
            );
          }
        }
        const rendered = catalogTokens(entries, budget);
        if (rendered.truncated && firstCut === null) firstCut = count;
        if (count === 60) {
          table.push({
            mcpTools: count,
            tokens: rendered.tokens,
            shown: rendered.shown,
          });
        }
      }
      report.truncation[lang].shapes[shape][budget] = {
        firstCut,
        at60: table[0],
      };
      process.stdout.write(
        `  ${shape.padEnd(7)} budget ${String(budget).padStart(4)} tokens -> ` +
          `first PARTIAL at ${firstCut ?? ">60"} MCP tools (60 tools = ${table[0].tokens} tokens, ` +
          `${table[0].shown} shown)\n`,
      );
    }
  }
  process.stdout.write("\n");

  // Description clipping: token-denominated caps, measured on the typical pool.
  report.descriptionClipping[lang] = {};
  for (const cap of [null, 200, 120, 60]) {
    const entries = [
      ...builtInEntries,
      ...buildEntries(PROBE_TOOLS, NAMESPACE, {
        lang,
        estimateTokens,
        descMaxTokens: cap ?? undefined,
      }),
    ];
    const rendered = catalogTokens(entries);
    report.descriptionClipping[lang][cap ?? "none"] = rendered.tokens;
    process.stdout.write(
      `descriptions[${lang}] cap=${cap ?? "none"}${cap ? " tokens" : ""} -> ` +
        `typical catalog = ${rendered.tokens} tokens\n`,
    );
  }
  process.stdout.write("\n");
}

for (const lang of /** @type {const} */ (["en", "zh"])) {
  report[`descLength_${lang}`] = Object.fromEntries(
    PROBE_TOOLS.map((tool) => [tool.name, tool.description[lang].length]),
  );
}
process.stdout.write(
  `description chars  en=${JSON.stringify(report.descLength_en)} zh=${JSON.stringify(report.descLength_zh)}\n`,
);

writeFileSync(
  join(args.outDir, "catalog-size.json"),
  JSON.stringify(report, null, 2),
);
process.stdout.write(`wrote ${join(args.outDir, "catalog-size.json")}\n`);
process.exit(0);
