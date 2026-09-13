#!/usr/bin/env node
/**
 * Admission-gate probe: can a model construct server-acceptable arguments from
 * a compact catalog signature instead of a full schema declaration?
 *
 * Two groups, identical tasks and identical MCP server:
 *   flat    - the three probe tools are declared flat (full JSON Schema), the
 *             way MCP tools are exposed today. Control group; runs through the
 *             SDK's own MCP client and tool loop.
 *   catalog - the same three tools are exposed as catalog lines inside one
 *             `ToolInvoke` tool (injected via AgentOptions.customTools, so no
 *             product code is involved). The leaf call is dispatched by this
 *             probe's own MCP client, because the leaf tools are deliberately
 *             denied to the SDK in this group (that is how "connected but not
 *             declared" is emulated without touching product code).
 *
 * Every leaf call is validated by `server.mjs` (strict) and appended to a JSONL
 * file, so "accepted by the server" is decided by the server, never by the model.
 *
 * Run:
 *   pnpm exec tsx scripts/catalog-proxy-probe/probe.mjs --groups flat,catalog \
 *     --rounds 2 --trials 20 --concurrency 4 --tag r1-en
 */

import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "../../packages/agent-sdk/src/index.ts";
import { estimateTokens } from "../../packages/agent-sdk/src/utils/tokenEstimate.ts";
import { buildEntries, renderCatalog } from "./catalog.mjs";
import { createClient } from "./mcpClient.mjs";
import { PROBE_TOOLS, TASKS } from "./schemas.mjs";

const NAMESPACE = "probe";
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(HERE, "server.mjs");

/** @param {string[]} argv */
function parseArgs(argv) {
  const out = {
    groups: ["flat", "catalog"],
    lang: "en",
    rounds: 2,
    trials: 20,
    concurrency: 4,
    tools: PROBE_TOOLS.map((tool) => tool.name),
    argsMode: "object",
    signature: "full",
    outDir: "/tmp/catalog-proxy-probe-results",
    timeoutMs: 180000,
    connectTimeoutMs: 60000,
    tag: "run",
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const value = argv[i + 1];
    switch (token.slice(2)) {
      case "groups":
        out.groups = value.split(",");
        break;
      case "lang":
        out.lang = value;
        break;
      case "rounds":
        out.rounds = Number(value);
        break;
      case "trials":
        out.trials = Number(value);
        break;
      case "concurrency":
        out.concurrency = Number(value);
        break;
      case "tools":
        out.tools = value.split(",");
        break;
      case "argsMode":
        out.argsMode = value;
        break;
      case "signature":
        out.signature = value;
        break;
      case "outDir":
        out.outDir = value;
        break;
      case "timeoutMs":
        out.timeoutMs = Number(value);
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

// Isolate from the real user profile: the SDK resolves ~/.wave via os.homedir().
const HOME = join(args.outDir, "home");
mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.WAVE_DISABLE_AUTO_MEMORY = "true";

mkdirSync(args.outDir, { recursive: true });
const RUNS_PATH = join(args.outDir, `runs-${args.tag}.jsonl`);
const CALLS_PATH = join(args.outDir, `server-calls-${args.tag}.jsonl`);

/**
 * The forwarding tool under test. In production this declaration is produced
 * inside `aiManager.resolveFilteredTools()`; here it arrives through
 * `AgentOptions.customTools`, which is the whole point of PR-1: the gate runs
 * before any product wiring exists.
 *
 * @param {{catalogText: string, argsMode: string, record: any}} options
 */
function makeToolInvoke(options) {
  const { catalogText, argsMode, record } = options;
  const argsSchema =
    argsMode === "json-string"
      ? {
          type: "string",
          description:
            "JSON string containing the arguments object for the target tool",
        }
      : {
          type: "object",
          description:
            "Arguments object for the target tool, matching its catalog signature",
          additionalProperties: true,
        };
  return {
    name: "ToolInvoke",
    config: {
      type: "function",
      function: {
        name: "ToolInvoke",
        description:
          "Invoke a tool that is not declared directly. Use the catalog below to find the " +
          `tool and its argument signature.\n\n${catalogText}`,
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["namespace", "tool", "args"],
          properties: {
            namespace: {
              type: "string",
              description: 'Namespace of the tool, e.g. "probe"',
            },
            tool: {
              type: "string",
              description: 'Tool name, e.g. "simple_report"',
            },
            args: argsSchema,
          },
        },
      },
    },
    /**
     * @param {Record<string, unknown>} input
     */
    async execute(input) {
      const entry = {
        namespace: input.namespace,
        tool: input.tool,
        rawArgs: input.args,
        parseError: null,
        leafOk: false,
        leafText: null,
      };
      record.invocations.push(entry);

      if (input.namespace !== NAMESPACE) {
        entry.leafText = `namespace not in catalog: ${String(input.namespace)}`;
        return { success: false, content: "", error: entry.leafText };
      }
      const tool = PROBE_TOOLS.find(
        (candidate) => candidate.name === input.tool,
      );
      if (!tool) {
        entry.leafText = `tool not in catalog: ${String(input.tool)}`;
        return { success: false, content: "", error: entry.leafText };
      }

      let leafArgs = input.args;
      if (argsMode === "json-string") {
        if (typeof leafArgs !== "string") {
          entry.leafText = "args must be a JSON string in this mode";
          return { success: false, content: "", error: entry.leafText };
        }
        try {
          leafArgs = JSON.parse(leafArgs);
        } catch (error) {
          entry.parseError = String(error);
          entry.leafText = `args is not parseable JSON: ${entry.parseError}`;
          return { success: false, content: "", error: entry.leafText };
        }
      }
      if (
        leafArgs === null ||
        typeof leafArgs !== "object" ||
        Array.isArray(leafArgs)
      ) {
        entry.leafText = `args must be an object, got ${typeof leafArgs}`;
        return { success: false, content: "", error: entry.leafText };
      }

      const client = createClient({
        lang: args.lang,
        logPath: CALLS_PATH,
        tag: record.tag,
      });
      try {
        await client.init();
        const result = await client.callTool(tool.name, leafArgs);
        entry.leafOk = !result.isError;
        entry.leafText = result.content?.[0]?.text ?? "";
        return {
          success: !result.isError,
          content: entry.leafText ?? "",
          ...(result.isError
            ? { error: entry.leafText ?? "invalid arguments" }
            : {}),
        };
      } catch (error) {
        entry.leafText = `leaf call failed: ${String(error)}`;
        return { success: false, content: "", error: entry.leafText };
      } finally {
        client.close();
      }
    },
  };
}

/**
 * @param {any} agent
 * @param {string} tag
 * @param {number} timeoutMs
 */
async function waitForMcp(agent, tag, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const server = agent
      .getMcpServers()
      .find((candidate) => candidate.name === "probe");
    if (server && server.status === "connected") return true;
    if (server && server.status === "error") {
      throw new Error(
        `MCP server failed to connect for ${tag}: ${server.error}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`MCP server connect timeout for ${tag}`);
}

/**
 * The agent goes idle between tool rounds, so a single "loading -> false"
 * transition is not the end of the turn. Treat the turn as finished once the
 * agent has been busy at least once and then stayed idle for `quietMs`.
 *
 * @param {any} agent
 * @param {() => boolean} busySeen
 * @param {number} quietMs
 */
async function waitForQuiet(agent, busySeen, quietMs = 1500) {
  const started = Date.now();
  let idleSince = null;
  while (Date.now() - started < args.timeoutMs) {
    if (agent.isLoading) {
      idleSince = null;
    } else if (busySeen()) {
      idleSince = idleSince ?? Date.now();
      if (Date.now() - idleSince >= quietMs) return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("turn did not settle before timeout");
}

/**
 * @param {{group: string, lang: string, toolName: string, round: number, trial: number}} job
 */
async function runTrial(job) {
  const { group, lang, toolName, round, trial } = job;
  const tag = `${args.tag}|${group}|${lang}|${toolName}|r${round}t${trial}`;
  const workdir = mkdtempSync(join(tmpdir(), "catalog-probe-wd-"));
  const record = {
    tag,
    group,
    lang,
    tool: toolName,
    round,
    trial,
    argsMode: args.argsMode,
    signature: args.signature,
    invocations: [],
    modelTokens: null,
    ms: 0,
    error: null,
  };
  const started = Date.now();
  let agent;
  let busySeen = false;
  const catalogGroup = group === "catalog";
  const catalog = catalogGroup
    ? renderCatalog(
        buildEntries(PROBE_TOOLS, NAMESPACE, {
          lang,
          estimateTokens,
          signature: args.signature,
        }),
        { budgetTokens: 100000, estimateTokens },
      )
    : null;

  try {
    agent = await Agent.create({
      workdir,
      tools: catalogGroup ? ["ToolInvoke"] : [],
      disallowedTools: catalogGroup
        ? PROBE_TOOLS.map((tool) => `mcp__${NAMESPACE}__${tool.name}`)
        : undefined,
      customTools: catalogGroup
        ? [
            makeToolInvoke({
              catalogText: catalog.text,
              argsMode: args.argsMode,
              record,
            }),
          ]
        : undefined,
      mcpServers: {
        probe: {
          type: "stdio",
          command: process.execPath,
          args: [SERVER_PATH],
          env: { PROBE_DESC_LANG: lang, PROBE_LOG: CALLS_PATH, PROBE_TAG: tag },
        },
      },
      canUseTool: async () => ({ behavior: "allow" }),
      callbacks: {
        onLoadingChange: (loading) => {
          if (loading) busySeen = true;
        },
      },
    });

    await waitForMcp(agent, tag, args.connectTimeoutMs);

    const timer = setTimeout(() => {
      record.error = "timeout";
      agent.abortMessage();
    }, args.timeoutMs);
    try {
      await agent.sendMessage(TASKS[toolName]);
      await waitForQuiet(agent, () => busySeen);
    } finally {
      clearTimeout(timer);
    }
    record.modelTokens = agent.latestTotalTokens ?? null;
  } catch (error) {
    record.error = record.error ?? `infra: ${String(error)}`;
  } finally {
    record.ms = Date.now() - started;
    try {
      if (agent) await agent.destroy();
    } catch {
      // ignore teardown noise
    }
    rmSync(workdir, { recursive: true, force: true });
  }
  appendFileSync(RUNS_PATH, JSON.stringify(record) + "\n");
  return record;
}

/**
 * @param {Array<object>} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} worker
 */
async function runPool(items, limit, worker) {
  let index = 0;
  const results = [];
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index++];
        const result = await worker(current);
        results.push(result);
        const verdict = result.error ? `ERR ${result.error}` : "done";
        process.stdout.write(
          `[${results.length}/${items.length}] ${result.tag} ${verdict} (${result.ms}ms)\n`,
        );
      }
    },
  );
  await Promise.all(runners);
  return results;
}

const jobs = [];
for (const group of args.groups) {
  for (let round = 1; round <= args.rounds; round++) {
    for (const toolName of args.tools) {
      for (let trial = 1; trial <= args.trials; trial++) {
        jobs.push({ group, lang: args.lang, toolName, round, trial });
      }
    }
  }
}

process.stdout.write(
  `catalog proxy probe: ${jobs.length} runs (${args.groups.join("+")}, lang=${args.lang}, ` +
    `rounds=${args.rounds}, trials=${args.trials}, argsMode=${args.argsMode}, ` +
    `signature=${args.signature}, concurrency=${args.concurrency})\n  model=${process.env.WAVE_MODEL}\n` +
    `  runs=${RUNS_PATH}\n  calls=${CALLS_PATH}\n`,
);

await runPool(jobs, args.concurrency, runTrial);

const runs = readFileSync(RUNS_PATH, "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const thisRun = runs.filter((run) => run.tag.startsWith(`${args.tag}|`));
process.stdout.write(
  `\nfinished: ${thisRun.length} runs, ${thisRun.filter((run) => run.error).length} infra errors\n`,
);
process.exit(0);
