import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpServerConfig } from "../../src/types/index.js";

// Real stdio child-process tests for the lazy dial (spec ecosystem/mcp.md
// 「按需连接 MCP 服务器」): a server is *registered* at create time but must not
// spawn a process until a turn actually needs it. Mocked-SDK suites cannot see
// the spawn lifecycle, so these drive a real stub server.

const SERVER_SCRIPT = fileURLToPath(
  new URL("../fixtures/mcp-stub-server.cjs", import.meta.url),
);

interface Harness {
  manager: McpManager;
  dir: string;
}

async function makeHarness(
  servers: Record<string, McpServerConfig>,
): Promise<Harness> {
  const dir = join(tmpdir(), `mcp-lazydial-${process.pid}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, ".mcp.json"),
    JSON.stringify({ mcpServers: servers }),
  );
  const manager = new McpManager(new Container());
  // The production shape: initialize without auto-connect, then read the config
  // so the server list is complete before anything is dialed.
  await manager.initialize(dir, false);
  await manager.loadConfig();
  return { manager, dir };
}

const stubServer = (env: Record<string, string> = {}): McpServerConfig => ({
  type: "stdio",
  command: process.execPath,
  args: [SERVER_SCRIPT],
  env,
});

function connectionPid(manager: McpManager, name: string): number | undefined {
  const connections = (
    manager as unknown as {
      connections: Map<string, { transport: { pid?: number } }>;
    }
  ).connections;
  return connections.get(name)?.transport.pid;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("McpManager lazy dial (real stdio child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers servers without spawning a process", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      const server = manager.getServer("weather");
      // Visible to `/mcp` and the settings page, but nothing is running yet…
      expect(server?.name).toBe("weather");
      expect(server?.status).toBe("disconnected");
      // …and no child process exists.
      expect(connectionPid(manager, "weather")).toBeUndefined();
      expect(manager.getAllConnectedTools()).toEqual([]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("dials on the first turn that needs the servers", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      await manager.connectPendingServers();

      expect(manager.getServer("weather")?.status).toBe("connected");
      const pid = connectionPid(manager, "weather");
      expect(pid).toBeTypeOf("number");
      expect(isAlive(pid as number)).toBe(true);
      // The tools the dial just fetched are what the turn will declare.
      expect(manager.getAllConnectedTools().map((tool) => tool.name)).toEqual([
        "echo",
      ]);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not retry a failed dial on later turns", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({
      broken: { type: "stdio", command: join(tmpdir(), "wave-no-such-binary") },
    });
    try {
      await manager.connectPendingServers();
      expect(manager.getServer("broken")?.status).toBe("error");

      // A second turn must not pay another dial timeout (and must not spawn
      // another process): only an explicit connect retries.
      const connectSpy = vi.spyOn(manager, "connectServer");
      await manager.connectPendingServers();
      expect(connectSpy).not.toHaveBeenCalled();
      expect(manager.getServer("broken")?.status).toBe("error");
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not resurrect a server the user disconnected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      await manager.connectPendingServers();
      expect(manager.getServer("weather")?.status).toBe("connected");

      await manager.disconnectServer("weather");
      expect(manager.getServer("weather")?.status).toBe("disconnected");

      // The next turn's dial must respect the user's decision.
      await manager.connectPendingServers();
      expect(manager.getServer("weather")?.status).toBe("disconnected");
      expect(connectionPid(manager, "weather")).toBeUndefined();

      // An explicit connect still wins.
      await manager.connectServer("weather", true);
      expect(manager.getServer("weather")?.status).toBe("connected");
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("never dials once the manager was destroyed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      // Teardown (Agent.destroy → cleanup) precedes any turn.
      await manager.cleanup();

      const connectSpy = vi.spyOn(manager, "connectServer");
      await manager.connectPendingServers();

      expect(connectSpy).not.toHaveBeenCalled();
      expect(connectionPid(manager, "weather")).toBeUndefined();
      expect(manager.getServer("weather")?.status).toBe("disconnected");
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  // The turn calls `beginPendingDials()` (not `connectPendingServers()`) so a
  // turn with nothing to dial gains no extra yield point: an MCP-less
  // conversation must behave exactly as before lazy dial existed.
  it("beginPendingDials() does nothing when there is nothing to dial", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({});
    try {
      expect(manager.beginPendingDials()).toBeUndefined();
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("beginPendingDials() hands back the dial, then reports nothing left", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      const dial = manager.beginPendingDials();
      expect(dial).toBeInstanceOf(Promise);
      await dial;
      expect(manager.getServer("weather")?.status).toBe("connected");

      // Everything is dialed (or attempted) — later turns must not await again.
      expect(manager.beginPendingDials()).toBeUndefined();
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: a connected server is reused, not redialed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { manager, dir } = await makeHarness({ weather: stubServer() });
    try {
      await manager.connectPendingServers();
      const pid = connectionPid(manager, "weather");

      await manager.connectPendingServers();

      expect(connectionPid(manager, "weather")).toBe(pid);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
