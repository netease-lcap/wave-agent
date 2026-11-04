import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  mcpConfigFingerprint,
  mcpToolsCacheKey,
  mcpToolsCachePath,
} from "../../src/utils/mcpToolsCache.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpServerConfig } from "../../src/types/index.js";

// Tool-snapshot cache (spec ecosystem/mcp.md 场景 9-15): because servers are
// dialed lazily, the panel has to be able to say what a server brings without a
// process. These tests pin both halves — the snapshot is shown while idle, and
// it is *never* a source of callable tools.

// Keep ~/.wave/mcp-tools-cache.json inside the temp dir: a suite must not read
// or overwrite the developer's real cache.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  const { join: joinPath } = await import("path");
  const tmpdir = actual.tmpdir;
  return {
    ...actual,
    homedir: () => joinPath(tmpdir(), "wave-mcp-cache-home"),
  };
});

const SERVER_SCRIPT = fileURLToPath(
  new URL("../fixtures/mcp-stub-server.cjs", import.meta.url),
);
const CACHE_PATH = mcpToolsCachePath();
const TMP_ROOT = process.env.TEMP ?? process.env.TMPDIR ?? "/tmp";

interface Harness {
  manager: McpManager;
  dir: string;
}

const stubServer = (env: Record<string, string> = {}): McpServerConfig => ({
  type: "stdio",
  command: process.execPath,
  args: [SERVER_SCRIPT],
  env,
});

/**
 * @param seed - runs after the workdir exists but before the manager loads, so a
 *   test can plant cache entries whose fingerprint includes that workdir.
 */
async function makeHarness(
  prefix: string,
  servers: Record<string, McpServerConfig>,
  seed?: (dir: string) => Promise<void>,
): Promise<Harness> {
  const dir = join(TMP_ROOT, `${prefix}-${process.pid}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
  await seed?.(dir);
  const manager = new McpManager(new Container());
  await manager.initialize(dir, false);
  await manager.loadConfig();
  return { manager, dir };
}

/** A cache entry as the manager would have written it on a past connect. */
function cacheEntry(
  name: string,
  config: McpServerConfig,
  workdir: string,
  tools: Array<{ name: string; description?: string }>,
  cachedAt = Date.now() - 60_000,
): [string, unknown] {
  const fingerprint = mcpConfigFingerprint(config, workdir);
  return [
    mcpToolsCacheKey(name, fingerprint),
    { name, fingerprint, workdir, tools, cachedAt },
  ];
}

async function writeCacheFile(
  entries: Array<[string, unknown]>,
): Promise<void> {
  await fs.mkdir(dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(
    CACHE_PATH,
    JSON.stringify({ version: 1, servers: Object.fromEntries(entries) }),
  );
}

async function readCacheFile(): Promise<{
  servers: Record<string, { name: string; tools: Array<{ name: string }> }>;
}> {
  return JSON.parse(await fs.readFile(CACHE_PATH, "utf-8"));
}

async function cachedEntryFor(name: string) {
  const cache = await readCacheFile();
  return Object.values(cache.servers).find((server) => server.name === name);
}

describe("McpManager tools cache", () => {
  beforeEach(async () => {
    await fs.rm(CACHE_PATH, { force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the cached tool list for a server that has not been dialed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const config = stubServer();
    const { manager, dir } = await makeHarness(
      "mcp-cache-hydrate",
      { weather: config },
      (workdir) =>
        writeCacheFile([
          cacheEntry("weather", config, workdir, [
            { name: "get_forecast", description: "forecast for a city" },
          ]),
        ]),
    );
    try {
      const server = manager.getServer("weather");
      // Still not connected — the snapshot is display data, not a connection…
      expect(server?.status).toBe("disconnected");
      expect(server?.toolsFromCache).toEqual([
        { name: "get_forecast", description: "forecast for a city" },
      ]);
      expect(server?.toolsCachedAt).toBeTypeOf("number");
      // …and it must never reach the model as a callable tool (scenario 15).
      expect(manager.getAllConnectedTools()).toEqual([]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not show a snapshot for a config that changed since it was taken", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cachedConfig = stubServer();
    const { manager, dir } = await makeHarness(
      "mcp-cache-changed",
      // Same name, different args: the old tool list is no longer trustworthy.
      { weather: { ...stubServer(), args: [SERVER_SCRIPT, "--other"] } },
      (workdir) =>
        writeCacheFile([
          cacheEntry("weather", cachedConfig, workdir, [{ name: "old_tool" }]),
        ]),
    );
    try {
      const server = manager.getServer("weather");
      expect(server?.status).toBe("disconnected");
      expect(server?.toolsFromCache).toBeUndefined();
      expect(server?.toolsCachedAt).toBeUndefined();
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("treats a corrupt cache file as no cache", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await fs.mkdir(dirname(CACHE_PATH), { recursive: true });
    await fs.writeFile(CACHE_PATH, "{ this is not json");

    const { manager, dir } = await makeHarness("mcp-cache-corrupt", {
      weather: stubServer(),
    });
    try {
      // Loading must succeed regardless (scenario 14).
      const server = manager.getServer("weather");
      expect(server?.status).toBe("disconnected");
      expect(server?.toolsFromCache).toBeUndefined();
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("records the tool snapshot on a successful dial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness("mcp-cache-record", {
      weather: stubServer(),
    });
    try {
      await manager.connectPendingServers();
      expect(manager.getServer("weather")?.status).toBe("connected");

      const entry = await cachedEntryFor("weather");
      expect(entry?.tools.map((tool) => tool.name)).toEqual(["echo"]);
      // The live session sees the snapshot too, so tearing the connection down
      // does not blank the panel afterwards.
      expect(
        manager.getServer("weather")?.toolsFromCache?.map((tool) => tool.name),
      ).toEqual(["echo"]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("overwrites an old snapshot when the server now exposes no tools", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const config = stubServer({ NO_TOOLS: "1" });
    const { manager, dir } = await makeHarness(
      "mcp-cache-empty",
      { weather: config },
      (workdir) =>
        writeCacheFile([
          cacheEntry("weather", config, workdir, [
            { name: "stale_one" },
            { name: "stale_two" },
          ]),
        ]),
    );
    try {
      expect(manager.getServer("weather")?.toolsFromCache).toHaveLength(2);

      await manager.connectPendingServers();

      // "No tools now" must clear, not keep, the old list (scenario 13).
      expect((await cachedEntryFor("weather"))?.tools).toEqual([]);
      expect(manager.getServer("weather")?.toolsFromCache).toEqual([]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("prunes snapshots of servers that are no longer configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A snapshot from this very project for a server that has since been removed
    // from its config, plus one belonging to another project — one process hosts
    // every session, so project B's write must not delete project A's entry.
    const otherProjectDir = join(TMP_ROOT, `mcp-cache-other-${process.pid}`);

    const { manager, dir } = await makeHarness(
      "mcp-cache-prune",
      { weather: stubServer() },
      (workdir) =>
        writeCacheFile([
          cacheEntry(
            "removed",
            { type: "stdio", command: "uvx", args: ["gone"] },
            workdir,
            [{ name: "gone" }],
          ),
          cacheEntry(
            "kept-elsewhere",
            { type: "stdio", command: "uvx", args: ["kept"] },
            otherProjectDir,
            [{ name: "kept" }],
          ),
        ]),
    );
    try {
      await manager.connectPendingServers();

      const cache = await readCacheFile();
      expect(
        Object.values(cache.servers)
          .map((server) => server.name)
          .sort(),
      ).toEqual(["kept-elsewhere", "weather"]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
