#!/usr/bin/env node
/**
 * Aggregate the admission-gate probe results.
 *
 * Joins `runs-<tag>.jsonl` (one line per model turn) with
 * `server-calls-<tag>.jsonl` (one line per leaf call, written by the strict
 * server) and classifies each turn.
 *
 * Taxonomy (matches the gate definition):
 *   OK                first leaf call was accepted by the server
 *   MISSING_REQUIRED  缺必填
 *   TYPE_MISMATCH     类型错
 *   ENUM_INVALID      枚举越界
 *   NESTED_STRUCTURE  嵌套结构错
 *   UNKNOWN_FIELD     多余字段
 *   OTHER             参数不可解析 / 未调用目标工具 / 调错工具 / 超时 / 基础设施错误
 *
 * Run:
 *   node scripts/catalog-proxy-probe/analyze.mjs --outDir /tmp/... --tag r1-en
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** @param {string[]} argv */
function parseArgs(argv) {
  const out = {
    outDir: "/tmp/catalog-proxy-probe-results",
    tag: "run",
    json: true,
  };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const value = argv[i + 1];
    switch (argv[i].slice(2)) {
      case "outDir":
        out.outDir = value;
        break;
      case "tag":
        out.tag = value;
        break;
      default:
        break;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

/**
 * @param {string} path
 * @returns {any[]}
 */
function readJsonl(path) {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

const runs = readJsonl(join(args.outDir, `runs-${args.tag}.jsonl`));
const calls = readJsonl(join(args.outDir, `server-calls-${args.tag}.jsonl`));

/** @type {Map<string, any[]>} */
const callsByTag = new Map();
for (const call of calls) {
  const list = callsByTag.get(call.tag) ?? [];
  list.push(call);
  callsByTag.set(call.tag, list);
}

const KNOWN_CODES = new Set([
  "MISSING_REQUIRED",
  "TYPE_MISMATCH",
  "ENUM_INVALID",
  "NESTED_STRUCTURE",
  "UNKNOWN_FIELD",
]);

/** @param {any} run @param {any[]} runCalls */
function classify(run, runCalls) {
  if (run.error) return "OTHER";
  if (runCalls.length === 0) return "OTHER";
  const first = runCalls[0];
  if (first.ok) return "OK";
  if (KNOWN_CODES.has(first.code)) return first.code;
  return "OTHER";
}

/** @type {any[]} */
const evaluated = runs.map((run) => {
  const runCalls = callsByTag.get(run.tag) ?? [];
  return {
    ...run,
    calls: runCalls,
    first: runCalls[0] ?? null,
    outcome: classify(run, runCalls),
    retried: runCalls.length > 1,
    eventuallyOk: runCalls.some((call) => call.ok),
    firstCode:
      runCalls.length === 0
        ? null
        : runCalls[0].ok
          ? "OK"
          : KNOWN_CODES.has(runCalls[0].code)
            ? runCalls[0].code
            : "OTHER",
  };
});

const codes = [...KNOWN_CODES, "OTHER"];

/** @param {any[]} subset */
function summarize(subset) {
  const total = subset.length;
  const ok = subset.filter((run) => run.outcome === "OK").length;
  const eventuallyOk = subset.filter((run) => run.eventuallyOk).length;
  const taxonomy = Object.fromEntries(codes.map((code) => [code, 0]));
  for (const run of subset)
    taxonomy[run.outcome] = (taxonomy[run.outcome] ?? 0) + 1;
  return {
    total,
    ok,
    rate: total === 0 ? 0 : ok / total,
    eventuallyOk,
    eventuallyRate: total === 0 ? 0 : eventuallyOk / total,
    retried: subset.filter((run) => run.retried).length,
    taxonomy,
    infraErrors: subset.filter((run) => run.error && run.error !== "timeout")
      .length,
    timeouts: subset.filter((run) => run.error === "timeout").length,
  };
}

/** @param {number} value */
function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/** @param {Record<string, number>} taxonomy @param {number} total */
function taxonomyLine(taxonomy, total) {
  return codes
    .filter((code) => (taxonomy[code] ?? 0) > 0)
    .map(
      (code) =>
        `${code}=${taxonomy[code]}${total ? `(${pct(taxonomy[code] / total)})` : ""}`,
    )
    .join(" ");
}

const groups = [...new Set(evaluated.map((run) => run.group))];
const tools = [...new Set(evaluated.map((run) => run.tool))];
const report = {
  tag: args.tag,
  lang: evaluated[0]?.lang ?? "?",
  groups: {},
  byTool: {},
  samples: {},
};

process.stdout.write(
  `# Admission gate: tag=${args.tag} lang=${report.lang}\n\n`,
);

for (const group of groups) {
  const subset = evaluated.filter((run) => run.group === group);
  const summary = summarize(subset);
  report.groups[group] = summary;
  process.stdout.write(
    `${group.padEnd(8)} n=${String(summary.total).padEnd(4)} success=${summary.ok} ` +
      `(${pct(summary.rate)}) eventual=${summary.eventuallyOk} (${pct(summary.eventuallyRate)}) ` +
      `retried=${summary.retried} timeouts=${summary.timeouts} infra=${summary.infraErrors}\n` +
      `         taxonomy: ${taxonomyLine(summary.taxonomy, summary.total)}\n`,
  );
}

process.stdout.write(`\n## per tool\n`);
for (const tool of tools) {
  report.byTool[tool] = {};
  for (const group of groups) {
    const subset = evaluated.filter(
      (run) => run.group === group && run.tool === tool,
    );
    if (subset.length === 0) continue;
    const summary = summarize(subset);
    report.byTool[tool][group] = summary;
    process.stdout.write(
      `${tool.padEnd(16)} ${group.padEnd(8)} n=${String(summary.total).padEnd(3)} ` +
        `success=${pct(summary.rate)}  ${taxonomyLine(summary.taxonomy, summary.total)}\n`,
    );
  }
  const catalog = report.byTool[tool]?.catalog;
  const flat = report.byTool[tool]?.flat;
  if (catalog && flat) {
    report.byTool[tool].delta = catalog.rate - flat.rate;
    process.stdout.write(
      `${"".padEnd(16)} delta(catalog-flat) = ${(100 * (catalog.rate - flat.rate)).toFixed(1)}pp\n`,
    );
  }
}

process.stdout.write(`\n## failing samples (first attempt)\n`);
for (const group of groups) {
  const failures = evaluated.filter(
    (run) => run.group === group && run.outcome !== "OK",
  );
  if (failures.length === 0) {
    process.stdout.write(`${group}: none\n`);
    continue;
  }
  report.samples[group] = failures.slice(0, 12).map((run) => ({
    tag: run.tag,
    code: run.firstCode,
    error: run.error,
    args: run.first?.args ?? run.invocations?.[0]?.rawArgs ?? null,
    serverMessage: run.first?.message ?? run.invocations?.[0]?.leafText ?? null,
  }));
  for (const sample of report.samples[group]) {
    process.stdout.write(
      `${sample.tag}  ${sample.code}${sample.error ? ` (${sample.error})` : ""}\n` +
        `  args=${JSON.stringify(sample.args)}\n  server=${String(sample.serverMessage).slice(0, 300)}\n`,
    );
  }
}

if (args.json) {
  writeFileSync(
    join(args.outDir, `analysis-${args.tag}.json`),
    JSON.stringify(report, null, 2),
  );
  process.stdout.write(
    `\nwrote ${join(args.outDir, `analysis-${args.tag}.json`)}\n`,
  );
}
