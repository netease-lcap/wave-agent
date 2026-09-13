#!/usr/bin/env node
/**
 * Strict stdio MCP server used by the catalog-proxy admission-gate probe.
 *
 * Dependency-free on purpose: it is spawned by both the SDK's MCP client (flat
 * group) and the probe's minimal client (catalog group), and must resolve no
 * bare specifiers from this directory.
 *
 * Strictness is the point of the experiment: every argument object is checked
 * against the tool's schema and rejected with a machine-readable error code, so
 * "the server accepted the arguments" is decidable without trusting the model.
 *
 * Env:
 *   PROBE_DESC_LANG  en | zh   (which description set tools/list returns)
 *   PROBE_LOG        path to append one JSONL line per tools/call outcome
 *   PROBE_TAG        opaque tag echoed into each log line (group/tool/trial)
 */

import { appendFileSync } from "node:fs";
import { PROBE_TOOLS, validateArgs } from "./schemas.mjs";

const LANG = process.env.PROBE_DESC_LANG === "zh" ? "zh" : "en";
const LOG_PATH = process.env.PROBE_LOG || "";
const TAG = process.env.PROBE_TAG || "";

/**
 * @param {unknown} payload
 */
function respond(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

/**
 * @param {string | number} id
 * @param {unknown} result
 */
function respondResult(id, result) {
  respond({ jsonrpc: "2.0", id, result });
}

/**
 * @param {string | number} id
 * @param {number} code
 * @param {string} message
 */
function respondError(id, code, message) {
  respond({ jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * @param {Record<string, unknown>} outcome
 */
function logOutcome(outcome) {
  if (!LOG_PATH) return;
  appendFileSync(
    LOG_PATH,
    JSON.stringify({ tag: TAG, ts: Date.now(), ...outcome }) + "\n",
  );
}

/**
 * @param {Record<string, unknown>} message
 */
function handle(message) {
  const { id, method, params } = /** @type {any} */ (message);

  if (method === "initialize") {
    respondResult(id, {
      protocolVersion: params?.protocolVersion || "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "catalog-proxy-probe", version: "1.0.0" },
    });
    return;
  }

  if (typeof method === "string" && method.startsWith("notifications/")) {
    return;
  }

  if (method === "ping") {
    respondResult(id, {});
    return;
  }

  if (method === "tools/list") {
    respondResult(id, {
      tools: PROBE_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description[LANG],
        inputSchema: tool.inputSchema,
      })),
    });
    return;
  }

  if (method === "tools/call") {
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = PROBE_TOOLS.find((candidate) => candidate.name === name);
    if (!tool) {
      logOutcome({ tool: name, args, ok: false, code: "UNKNOWN_TOOL" });
      respondResult(id, {
        content: [{ type: "text", text: `unknown tool: ${name}` }],
        isError: true,
      });
      return;
    }
    const validation = validateArgs(tool.inputSchema, args);
    if (!validation.ok) {
      const { code, path, message } = validation.error;
      logOutcome({ tool: name, args, ok: false, code, path, message });
      respondResult(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              error: "INVALID_ARGUMENTS",
              code,
              path,
              message,
            }),
          },
        ],
        isError: true,
      });
      return;
    }
    logOutcome({ tool: name, args, ok: true, normalized: validation.value });
    respondResult(id, {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            tool: name,
            accepted: validation.value,
            summary: `${name} accepted`,
          }),
        },
      ],
      isError: false,
    });
    return;
  }

  if (id !== undefined) {
    respondError(id, -32601, `method not found: ${method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf("\n");
  while (index >= 0) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) {
      try {
        handle(JSON.parse(line));
      } catch (error) {
        process.stderr.write(`[probe-server] bad message: ${String(error)}\n`);
      }
    }
    index = buffer.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
