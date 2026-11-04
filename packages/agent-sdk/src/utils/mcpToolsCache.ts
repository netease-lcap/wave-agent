/**
 * Machine-local tool-snapshot cache for MCP servers
 * (`~/.wave/mcp-tools-cache.json`).
 *
 * Why it exists: servers are dialed lazily (spec ecosystem/mcp.md「按需连接 MCP
 * 服务器」), so a conversation that never used MCP has no process and no tool
 * list to show. "Nothing is running" must not turn into "nothing is
 * configured", so the last successful connection leaves a snapshot behind and
 * `/mcp` / the settings page can still say what a server brings.
 *
 * Boundaries (spec scenarios 9-15):
 * - Display only. `McpManager` never reads tools back out of here for the
 *   model — a tool declared (or callable) from a stale snapshot would be a tool
 *   the server no longer exposes. Only name/description are stored, so even an
 *   accidental read cannot produce a callable tool.
 * - Entries are keyed by server name **+ config fingerprint**, so editing a
 *   server's command/args/env/url (or opening the same name in another workdir,
 *   which changes the spawn cwd) invalidates the snapshot instead of showing
 *   tools the new config never had.
 * - Missing, unreadable or corrupted file = "no cache". Startup must never fail
 *   because of a display cache.
 * - No credentials: env values and headers are folded into the fingerprint
 *   hash, never stored.
 */

import { promises as fs } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { atomicWriteFile } from "./atomicWrite.js";
import type { McpServerConfig, McpTool } from "../types/index.js";

/** One tool as the panel shows it — deliberately not an `McpTool`. */
export interface McpCachedTool {
  name: string;
  description?: string;
}

export interface McpToolsCacheEntry {
  name: string;
  fingerprint: string;
  /**
   * The project the server was configured in. Used only to scope pruning: one
   * `wave --stdio` process hosts every session at once, so a session in project
   * B must not delete project A's entries just because A's servers are not in
   * B's config. Same privacy boundary as the config file itself.
   */
  workdir: string;
  tools: McpCachedTool[];
  /** When the snapshot was captured (ms since epoch). */
  cachedAt: number;
}

interface McpToolsCacheFile {
  version: 1;
  servers: Record<string, McpToolsCacheEntry>;
}

/** Descriptions are display-only; a cache file shouldn't grow with prose. */
const MAX_CACHED_DESCRIPTION = 200;

/** Serializes this process's cache writes (see `saveCachedTools`). */
let writeChain: Promise<void> = Promise.resolve();

export function mcpToolsCachePath(): string {
  return join(homedir(), ".wave", "mcp-tools-cache.json");
}

export function mcpToolsCacheKey(name: string, fingerprint: string): string {
  return `${name}|${fingerprint}`;
}

function sortedEntries(
  record: Record<string, string> | undefined,
): Array<[string, string]> | null {
  if (!record) return null;
  return Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Fingerprint of everything that decides what a server exposes.
 *
 * `workdir` counts as part of it: it is the spawned process's cwd, so the same
 * name configured identically in two projects must not share one snapshot.
 * Values are hashed, never written out.
 */
export function mcpConfigFingerprint(
  config: McpServerConfig,
  workdir: string,
): string {
  const canonical = JSON.stringify({
    type: config.type ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    url: config.url ?? null,
    headers: sortedEntries(config.headers),
    env: sortedEntries(config.env),
    cwd: workdir,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function emptyCache(): McpToolsCacheFile {
  return { version: 1, servers: {} };
}

function isEntry(value: unknown): value is McpToolsCacheEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<McpToolsCacheEntry>;
  return (
    typeof entry.name === "string" &&
    typeof entry.fingerprint === "string" &&
    typeof entry.workdir === "string" &&
    typeof entry.cachedAt === "number" &&
    Array.isArray(entry.tools) &&
    entry.tools.every(
      (tool) =>
        typeof tool === "object" &&
        tool !== null &&
        typeof (tool as McpCachedTool).name === "string",
    )
  );
}

/**
 * Read the whole cache. Never throws: a missing/unreadable/corrupt file is
 * indistinguishable from "never cached anything" (scenario 14).
 */
export async function readMcpToolsCache(): Promise<McpToolsCacheFile> {
  let raw: string;
  try {
    raw = await fs.readFile(mcpToolsCachePath(), "utf-8");
  } catch {
    return emptyCache();
  }
  try {
    const parsed = JSON.parse(raw) as Partial<McpToolsCacheFile>;
    if (!parsed || typeof parsed !== "object" || !parsed.servers) {
      return emptyCache();
    }
    const servers: Record<string, McpToolsCacheEntry> = {};
    for (const [key, entry] of Object.entries(parsed.servers)) {
      // One broken entry must not discard the healthy ones.
      if (isEntry(entry)) servers[key] = entry;
    }
    return { version: 1, servers };
  } catch {
    return emptyCache();
  }
}

/**
 * Record (or overwrite — an empty list clears it, scenario 13) one server's
 * snapshot, dropping entries for servers that are no longer configured in *this*
 * project (scenario 12).
 *
 * `configuredNames` is the caller's current server list and `workdir` its
 * project: only entries from the same project are judged against it, because one
 * process hosts every session at once and project B's write must not delete
 * project A's snapshots. Best-effort: a cache write failure only costs the next
 * panel some information, so it never propagates — the returned entry still
 * describes what this session should show.
 *
 * Writes are serialized in-process (a lazy dial connects several servers at
 * once, and a read-modify-write of the same file would otherwise drop one).
 * Two *processes* writing at the same moment can still lose an entry; the
 * snapshot comes back on that server's next connect, which is the price of a
 * display-only cache that must never block a connection.
 */
export async function saveCachedTools(params: {
  name: string;
  fingerprint: string;
  workdir: string;
  tools: McpTool[];
  configuredNames: Iterable<string>;
}): Promise<McpToolsCacheEntry> {
  const { name, fingerprint, workdir, tools, configuredNames } = params;
  const live = new Set(configuredNames);
  const entry: McpToolsCacheEntry = {
    name,
    fingerprint,
    workdir,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description?.slice(0, MAX_CACHED_DESCRIPTION),
    })),
    cachedAt: Date.now(),
  };

  // Chain onto the previous write so two servers dialed in the same turn cannot
  // interleave read-modify-write and drop one of the two entries.
  writeChain = writeChain.then(async () => {
    try {
      const cachePath = mcpToolsCachePath();
      const cache = await readMcpToolsCache();
      for (const [key, existing] of Object.entries(cache.servers)) {
        if (existing.workdir === workdir && !live.has(existing.name)) {
          delete cache.servers[key];
        }
      }
      cache.servers[mcpToolsCacheKey(name, fingerprint)] = entry;
      await fs.mkdir(dirname(cachePath), { recursive: true });
      await atomicWriteFile(cachePath, JSON.stringify(cache, null, 2));
    } catch {
      // Display-only cache; never let it break a connection or a turn.
    }
  });
  await writeChain;
  return entry;
}
