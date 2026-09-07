import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpServerStatus } from "../../src/types/index.js";

// Real stdio child-process tests for MCP disconnect. The other mcpManager
// tests mock the whole MCP SDK, so they cannot see the actual child-process
// lifecycle — this suite spawns a real stub server (tests/fixtures/
// mcp-stub-server.cjs) to exercise the disconnect behaviour end to end.

const SERVER_SCRIPT = fileURLToPath(
  new URL("../fixtures/mcp-stub-server.cjs", import.meta.url),
);

interface Harness {
  manager: McpManager;
  dir: string;
}

async function makeHarness(
  ignoreEof: boolean,
  pushes: McpServerStatus[][],
): Promise<Harness> {
  const dir = join(tmpdir(), `mcp-disconnect-${process.pid}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        weather: {
          type: "stdio",
          command: process.execPath,
          args: [SERVER_SCRIPT],
          env: { IGNORE_EOF: ignoreEof ? "1" : "0" },
        },
      },
    }),
  );
  const manager = new McpManager(new Container(), {
    callbacks: {
      onMcpServersChange: (servers) => pushes.push([...servers]),
    },
  });
  await manager.initialize(dir, true); // auto-connect
  return { manager, dir };
}

async function waitForStatus(
  manager: McpManager,
  name: string,
  status: string,
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(manager.getServer(name)?.status).toBe(status);
    },
    { timeout: 5000, interval: 50 },
  );
}

describe("McpManager disconnect (real stdio child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("terminates the stdio child process and reports disconnected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pushes: McpServerStatus[][] = [];
    const { manager, dir } = await makeHarness(false, pushes);
    try {
      await waitForStatus(manager, "weather", "connected");

      const connection = (
        manager as unknown as {
          connections: Map<string, { transport: { pid: number | null } }>;
        }
      ).connections.get("weather");
      const pid = connection?.transport.pid;
      expect(pid).toBeTypeOf("number");

      const result = await manager.disconnectServer("weather");
      expect(result).toBe(true);

      // The child process must actually be gone (killed / exited on EOF).
      await vi.waitFor(
        () => {
          try {
            process.kill(pid as number, 0);
            expect.unreachable("child process still alive");
          } catch {
            // ESRCH — expected
          }
        },
        { timeout: 3000, interval: 50 },
      );

      const server = manager.getServer("weather");
      expect(server?.status).toBe("disconnected");
      expect(server?.toolCount).toBe(0);
      // Every disconnect outcome pushed a state update (spinner-settling data
      // for the webview; a missing push is what left the UI stuck).
      expect(
        pushes.some((snap) =>
          snap.some((s) => s.name === "weather" && s.status === "disconnected"),
        ),
      ).toBe(true);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not silently auto-reconnect after an explicit disconnect", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pushes: McpServerStatus[][] = [];
    const { manager, dir } = await makeHarness(false, pushes);
    try {
      await waitForStatus(manager, "weather", "connected");
      await manager.disconnectServer("weather");
      expect(manager.getServer("weather")?.status).toBe("disconnected");

      // First auto-reconnect backoff is 1s — wait past it. An explicit
      // disconnect must not be undone by a reconnect scheduled from the
      // teardown's own transport close.
      await new Promise((r) => setTimeout(r, 1500));
      const server = manager.getServer("weather");
      expect(server?.status).toBe("disconnected");
      expect(server?.toolCount).toBe(0);
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("disconnect of a stubborn server (ignores EOF) still converges to disconnected", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pushes: McpServerStatus[][] = [];
    const { manager, dir } = await makeHarness(true, pushes);
    try {
      await waitForStatus(manager, "weather", "connected");
      const result = await manager.disconnectServer("weather");
      expect(result).toBe(true);
      expect(manager.getServer("weather")?.status).toBe("disconnected");
    } finally {
      await manager.cleanup();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
