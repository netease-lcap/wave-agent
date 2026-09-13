#!/usr/bin/env node
/**
 * Self-test for the probe scaffold: strict validator, catalog renderer and the
 * stdio MCP server protocol. Run with:
 *
 *   pnpm exec tsx scripts/catalog-proxy-probe/selftest.mjs
 *
 * (tsx is required because the token estimator is imported from SDK source.)
 *
 * This is the "fail-without-fix" guard for the gate: if the validator stopped
 * rejecting bad arguments, or the catalog renderer stopped being deterministic,
 * every measurement produced by this directory would be meaningless.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateTokens } from "../../packages/agent-sdk/src/utils/tokenEstimate.ts";
import {
  buildEntries,
  makeSyntheticTool,
  renderCatalog,
  renderEntry,
  renderSignature,
} from "./catalog.mjs";
import { createClient } from "./mcpClient.mjs";
import {
  BUILD_PIPELINE,
  COMPOSE_CONFIG,
  PROBE_TOOLS,
  SIMPLE_REPORT,
  validateArgs,
} from "./schemas.mjs";

let failures = 0;
let checks = 0;

/**
 * @param {string} label
 * @param {() => void | Promise<void>} run
 */
async function test(label, run) {
  checks++;
  try {
    await run();
    process.stdout.write(`ok   ${label}\n`);
  } catch (error) {
    failures++;
    process.stdout.write(
      `FAIL ${label}\n     ${String(error && error.message ? error.message : error)}\n`,
    );
  }
}

/**
 * @param {Record<string, unknown>} schema
 * @param {unknown} args
 */
function codeOf(schema, args) {
  const result = validateArgs(schema, args);
  return result.ok ? "OK" : result.error.code;
}

// ---------------------------------------------------------------- validator
await test("valid args pass and defaults are filled", () => {
  const result = validateArgs(COMPOSE_CONFIG.inputSchema, {
    name: "web-gateway",
    target: { os: "macos", arch: "arm64" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.target, {
    os: "macos",
    arch: "arm64",
    retries: 3,
  });
  assert.equal(result.value.dryRun, false);
});

await test("missing required (top level) -> MISSING_REQUIRED", () => {
  assert.equal(
    codeOf(SIMPLE_REPORT.inputSchema, { title: "abc", count: 1 }),
    "MISSING_REQUIRED",
  );
});

await test("missing required (nested) -> MISSING_REQUIRED", () => {
  assert.equal(
    codeOf(COMPOSE_CONFIG.inputSchema, { name: "x", target: { os: "linux" } }),
    "MISSING_REQUIRED",
  );
});

await test("wrong scalar type -> TYPE_MISMATCH", () => {
  assert.equal(
    codeOf(SIMPLE_REPORT.inputSchema, {
      title: "abc",
      count: "12",
      enabled: true,
    }),
    "TYPE_MISMATCH",
  );
});

await test("enum violation -> ENUM_INVALID", () => {
  assert.equal(
    codeOf(COMPOSE_CONFIG.inputSchema, {
      name: "x",
      target: { os: "solaris", arch: "arm64" },
    }),
    "ENUM_INVALID",
  );
});

await test("extra field -> UNKNOWN_FIELD", () => {
  assert.equal(
    codeOf(SIMPLE_REPORT.inputSchema, {
      title: "abc",
      count: 1,
      enabled: true,
      priority: "high",
    }),
    "UNKNOWN_FIELD",
  );
});

await test("nested shape violation -> NESTED_STRUCTURE", () => {
  assert.equal(
    codeOf(BUILD_PIPELINE.inputSchema, {
      artifactName: "x.tar.gz",
      pipeline: { stages: [] },
    }),
    "NESTED_STRUCTURE",
  );
});

await test("nested array item type violation -> NESTED_STRUCTURE", () => {
  assert.equal(
    codeOf(BUILD_PIPELINE.inputSchema, {
      artifactName: "x.tar.gz",
      pipeline: { stages: [{ id: 7, kind: "build", env: "dev" }] },
    }),
    "NESTED_STRUCTURE",
  );
});

await test("map-style additionalProperties accepted", () => {
  const result = validateArgs(COMPOSE_CONFIG.inputSchema, {
    name: "x",
    target: { os: "linux", arch: "x64" },
    labels: { team: "core", tier: "a" },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.labels, { team: "core", tier: "a" });
});

await test("map-style additionalProperties rejects wrong value type", () => {
  assert.equal(
    codeOf(COMPOSE_CONFIG.inputSchema, {
      name: "x",
      target: { os: "linux", arch: "x64" },
      labels: { team: 3 },
    }),
    "TYPE_MISMATCH",
  );
});

// ------------------------------------------------------------------ catalog
await test("entry render is stable and carries required/optional/enum/defaults", () => {
  const first = renderEntry(COMPOSE_CONFIG, "probe", { lang: "en" });
  const second = renderEntry(COMPOSE_CONFIG, "probe", { lang: "en" });
  assert.equal(first, second);
  assert.match(first, /^probe\.compose_config\(/);
  assert.match(first, /name: string/);
  assert.match(first, /target: \{os: "linux"\|"macos"\|"windows"/);
  assert.match(first, /retries\?: integer\(min=0,max=10\)=3/);
  assert.match(first, /dryRun\?: boolean=false/);
});

await test("budget truncation is explicit and keeps one line per namespace", () => {
  const entries = [
    ...buildEntries(PROBE_TOOLS, "probe", { lang: "en", estimateTokens }),
    ...buildEntries(
      [makeSyntheticTool(1, "en"), makeSyntheticTool(2, "en")],
      "other",
      {
        lang: "en",
        estimateTokens,
      },
    ),
  ];
  const full = renderCatalog(entries, { budgetTokens: 100000, estimateTokens });
  assert.equal(full.truncated, false);
  assert.match(full.text, /COMPLETE/);
  assert.equal(full.shown, 5);

  const tight = renderCatalog(entries, { budgetTokens: 60, estimateTokens });
  assert.equal(tight.truncated, true);
  assert.match(tight.text, /PARTIAL - \d+ of 5 shown/);
  assert.match(
    tight.text,
    /other\.query_resource_1/,
    "second namespace keeps at least one line",
  );
  assert.match(tight.text, /probe\.simple_report/);
});

// ------------------------------------------------------------------- server
await test("server handshake, tools/list and strict tools/call over stdio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "catalog-probe-selftest-"));
  const logPath = join(dir, "calls.jsonl");
  const client = createClient({ lang: "zh", logPath, tag: "selftest" });
  try {
    await client.init();
    const listed = await client.listTools();
    assert.equal(listed.tools.length, PROBE_TOOLS.length);
    assert.equal(listed.tools[0].description, SIMPLE_REPORT.description.zh);

    const ok = await client.callTool("simple_report", {
      title: "月度巡检",
      count: 12,
      enabled: true,
    });
    assert.equal(ok.isError, false);

    const bad = await client.callTool("compose_config", {
      name: "x",
      target: { os: "linux", arch: "x64" },
      dryRun: "yes",
    });
    assert.equal(bad.isError, true);
    const payload = JSON.parse(bad.content[0].text);
    assert.equal(payload.code, "TYPE_MISMATCH");
    assert.equal(payload.path, "$.dryRun");
  } finally {
    client.close();
  }

  const lines = readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].ok, true);
  assert.equal(lines[0].tag, "selftest");
  assert.equal(lines[1].ok, false);
  assert.equal(lines[1].code, "TYPE_MISMATCH");
});

await test("catalog signature survives the complex schema", () => {
  const signature = renderSignature(BUILD_PIPELINE.inputSchema);
  assert.match(signature, /artifactName: string\(minLength=3\)/);
  assert.match(signature, /kind: "build"\|"test"\|"deploy"\|"rollback"/);
  assert.match(signature, /maxItems=5/);
  assert.match(signature, /level\?: "info"\|"warn"\|"error"="warn"/);
  assert.match(signature, /parallelism\?: integer\(min=1,max=8\)=1/);
});

process.stdout.write(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures === 0 ? 0 : 1);
