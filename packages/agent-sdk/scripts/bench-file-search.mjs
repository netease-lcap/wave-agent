/**
 * Benchmark the file index against the per-request search it replaces.
 *
 * Not a test and not a CI job — run it by hand when tuning the scoring or
 * checking a large workspace. It prints, for each query:
 *
 *   - the old cost (enumerate + derive directories + full fuzzysort)
 *   - the new cost (build the index once, then answer from memory)
 *   - how many of the old top-N paths survive in the new top-N
 *
 * A top-N overlap below 90% means the substring scoring is diverging from what
 * users are used to and should be revisited.
 *
 *   node packages/agent-sdk/scripts/bench-file-search.mjs <workdir> [query...]
 */

import { performance } from "node:perf_hooks";
import fuzzysort from "fuzzysort";
import {
  getAllFiles,
  deriveDirectories,
  getFileIndex,
  queryIndex,
  resetFileIndexCache,
} from "../dist/utils/fileIndex.js";

const TOP_N = 20;
const workdir = process.argv[2];
const queries =
  process.argv.length > 3
    ? process.argv.slice(3)
    : ["index", "test", "config", "src", "util"];

if (!workdir) {
  console.error(
    "usage: node packages/agent-sdk/scripts/bench-file-search.mjs <workdir> [query...]",
  );
  process.exit(1);
}

function ms(fn) {
  const started = performance.now();
  const value = fn();
  return { value, cost: performance.now() - started };
}

async function msAsync(fn) {
  const started = performance.now();
  const value = await fn();
  return { value, cost: performance.now() - started };
}

const files = await getAllFiles(workdir);
const enumerated = files.length;
console.log(`workdir : ${workdir}`);
console.log(`files   : ${enumerated}`);

// Old path: enumerate, derive directories, fuzzy-score everything, keep TOP_N.
const legacyTimes = [];
const legacyResults = new Map();
for (const query of queries) {
  const run = ms(() => {
    const directories = deriveDirectories(files);
    const items = [
      ...files.map((path) => ({ path, type: "file" })),
      ...directories.map((path) => ({ path, type: "directory" })),
    ];
    return fuzzysort
      .go(query, items, { key: "path", limit: TOP_N, threshold: 0 })
      .map((hit) => hit.obj.path);
  });
  legacyTimes.push(run.cost);
  legacyResults.set(query, run.value);
}
const deriveCost = ms(() => deriveDirectories(files)).cost;
console.log(
  `legacy  : derive ${deriveCost.toFixed(0)} ms + per query ${legacyTimes.map((t) => t.toFixed(0)).join("/")} ms (${TOP_N}-result fuzzysort)`,
);

// New path: one build, then per-query scans.
resetFileIndexCache();
const build = await msAsync(() => getFileIndex(workdir));
const index = build.value;
console.log(
  `index   : ${index.paths.length} entries in ${build.cost.toFixed(0)} ms`,
);

const newTimes = [];
for (const query of queries) {
  const run = ms(() => queryIndex(index, query, TOP_N).map((r) => r.path));
  newTimes.push(run.cost);
  // Compare sets, not positions: the two passes can rank the same paths
  // differently while still surfacing the same files.
  const legacy = legacyResults.get(query) ?? [];
  const fresh = new Set(run.value);
  const overlap = legacy.filter((p) => fresh.has(p)).length;
  const ratio = legacy.length === 0 ? 1 : overlap / legacy.length;
  console.log(
    `  ${query.padEnd(10)} new ${run.cost.toFixed(2)} ms   overlap ${overlap}/${legacy.length} (${(ratio * 100).toFixed(0)}%)`,
  );
}
console.log(
  `queries : ${newTimes.map((t) => t.toFixed(2)).join("/")} ms  (speedup ${(legacyTimes.reduce((a, b) => a + b, 0) / newTimes.reduce((a, b) => a + b, 0)).toFixed(0)}x)`,
);

// Keep the process honest about memory: an index is meant to be resident.
const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`heap    : ${heapMb.toFixed(0)} MB`);
