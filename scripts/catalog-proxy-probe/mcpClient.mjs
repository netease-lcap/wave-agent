/**
 * Minimal MCP stdio client (newline-delimited JSON-RPC).
 *
 * The probe needs a client of its own because the catalog group calls the leaf
 * tool *outside* the SDK's MCP layer: the leaf is deliberately denied to the
 * SDK (that is how "connected but not declared" is emulated without product
 * changes), so `mcpManager.executeMcpTool` cannot be used for it.
 *
 * Used by both `selftest.mjs` and `probe.ts`.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_PATH = join(dirname(fileURLToPath(import.meta.url)), "server.mjs");

/**
 * @param {{lang?: "en"|"zh", logPath?: string, tag?: string, env?: Record<string, string>}} [options]
 */
export function createClient(options = {}) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      PROBE_DESC_LANG: options.lang ?? "en",
      PROBE_LOG: options.logPath ?? "",
      PROBE_TAG: options.tag ?? "",
      ...(options.env ?? {}),
    },
  });

  let buffer = "";
  /** @type {Map<number, {resolve: (value: any) => void, reject: (reason: Error) => void}>} */
  const pending = new Map();
  let nextId = 1;
  let closed = false;

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const entry = pending.get(message.id);
          if (entry) {
            pending.delete(message.id);
            if (message.error)
              entry.reject(new Error(JSON.stringify(message.error)));
            else entry.resolve(message.result);
          }
        } catch {
          // ignore malformed frames; the server logs diagnostics on stderr
        }
      }
      index = buffer.indexOf("\n");
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) =>
    process.stderr.write(`[probe-server] ${chunk}`),
  );
  child.on("exit", (code) => {
    closed = true;
    for (const entry of pending.values()) {
      entry.reject(new Error(`probe server exited with code ${code}`));
    }
    pending.clear();
  });

  /** @param {Record<string, unknown>} message */
  function send(message) {
    if (closed) throw new Error("probe server is not running");
    child.stdin.write(JSON.stringify(message) + "\n");
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} params
   */
  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ jsonrpc: "2.0", id, method, params });
    });
  }

  return {
    child,
    async init() {
      await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "catalog-proxy-probe", version: "1.0.0" },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
    },
    /** @returns {Promise<{tools: Array<{name: string, description?: string, inputSchema: Record<string, unknown>}>}>} */
    listTools() {
      return request("tools/list", {});
    },
    /**
     * @param {string} name
     * @param {Record<string, unknown>} args
     */
    callTool(name, args) {
      return request("tools/call", { name, arguments: args });
    },
    close() {
      if (!closed) child.kill();
    },
  };
}
