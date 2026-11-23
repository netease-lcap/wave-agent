import { describe, it, expect, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";
import {
  McpManager,
  MCP_CONNECT_BATCH_SIZE,
} from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpServerConfig } from "../../src/types/index.js";

// Real stdio child-process tests for the startup dial (spec ecosystem/mcp.md
// 「连接 MCP 服务器的时机与超时」): `Agent.create()` → `initialize(dir, true)`
// starts one dial per server and waits for none of them, so the server list is
// complete before any process is up, while the turn path (`waitForTurnDials`)
// is the only place a deadline is applied. Mocked-SDK suites cannot see the
// spawn lifecycle, so these drive a real stub server.

const SERVER_SCRIPT = fileURLToPath(
  new URL("../fixtures/mcp-stub-server.cjs", import.meta.url),
);

/**
 * How long the slow-start stub takes to answer `initialize`: long enough that
 * "create already returned" and "this turn did not wait for it" are both
 * observable, short enough to stay inside the default test timeout.
 */
const SLOW_START_MS = 1200;

/** `vi.waitFor`'s 1 s default is shorter than SLOW_START_MS, so say it out loud. */
const DIAL_WAIT = SLOW_START_MS + 5000;

/** Per-test workdir suffix: `Date.now()` alone repeats within one millisecond. */
let workdirSequence = 0;

interface Harness {
  manager: McpManager;
  dir: string;
  /** Wall time `initialize()` itself took. */
  initializeMs: number;
}

/** Servers, or a builder that gets the workdir for paths the child needs. */
type ServersInput =
  | Record<string, McpServerConfig>
  | ((dir: string) => Record<string, McpServerConfig>);

/**
 * Write a workdir's `.mcp.json` and initialize the manager the way
 * `Agent.create()` does: `initialize(dir, true)` reads the config and then
 * fires the dials without awaiting them.
 *
 * `autoConnect: false` is the other caller shape (initialize, then read the
 * config) — nothing is dialed, which is what a test that only inspects the
 * merged config wants.
 */
async function makeHarness(
  servers: ServersInput,
  options: { autoConnect?: boolean } = {},
): Promise<Harness> {
  const autoConnect = options.autoConnect ?? true;
  const dir = join(
    tmpdir(),
    `mcp-autodial-${process.pid}-${Date.now()}-${workdirSequence++}`,
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, ".mcp.json"),
    JSON.stringify({
      mcpServers: typeof servers === "function" ? servers(dir) : servers,
    }),
  );
  const manager = new McpManager(new Container());
  const startedAt = performance.now();
  await manager.initialize(dir, autoConnect);
  const initializeMs = performance.now() - startedAt;
  if (!autoConnect) await manager.loadConfig();
  return { manager, dir, initializeMs };
}

async function dispose(harness: Harness): Promise<void> {
  await harness.manager.cleanup();
  // `cleanup()` cannot reap a handshake still in flight (that dial closes itself
  // once it finishes), and on Windows a live child keeps its cwd — this workdir
  // — locked. Retries are the platform's own knob, not a wait for a state.
  await fs.rm(harness.dir, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  });
}

const stubServer = (env: Record<string, string> = {}): McpServerConfig => ({
  type: "stdio",
  command: process.execPath,
  args: [SERVER_SCRIPT],
  env,
});

/** A configured server that is slow to answer the handshake. */
const slowServer = (env: Record<string, string> = {}): McpServerConfig =>
  stubServer({ INIT_DELAY_MS: String(SLOW_START_MS), ...env });

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

/** The pid a stub server wrote about itself (`PID_FILE`), if it got that far. */
async function readProcessIdFile(file: string): Promise<number | undefined> {
  try {
    const raw = await fs.readFile(file, "utf-8");
    const pid = Number(raw.trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

describe("McpManager automatic dial at startup (real stdio child)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("场景 1：initialize(dir, true) 已发起拨号，但没有等服务器连上", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness((dir) => ({
      slow: slowServer({ PID_FILE: join(dir, "slow.pid") }),
    }));
    const { manager, dir, initializeMs } = harness;
    try {
      // initialize 自己没花掉服务器的启动时间：等它连上就会是 SLOW_START_MS。
      expect(initializeMs).toBeLessThan(SLOW_START_MS);

      // 还没发任何消息，子进程已经被拉起（stub 启动时写下的自己的 pid）。
      let spawnedPid: number | undefined;
      await vi.waitFor(
        async () => {
          spawnedPid = await readProcessIdFile(join(dir, "slow.pid"));
          expect(spawnedPid).toBeTypeOf("number");
        },
        { timeout: DIAL_WAIT },
      );
      expect(isAlive(spawnedPid as number)).toBe(true);
      // 进程在跑、握手还没回来：这正是"本轮不声明它的工具"的状态。
      expect(manager.getServer("slow")?.status).not.toBe("connected");
      expect(connectionPid(manager, "slow")).toBeUndefined();

      // 连上之后仍是同一个进程：没有被 deadline 换掉，也没有第二次拨号。
      await vi.waitFor(
        () => expect(manager.getServer("slow")?.status).toBe("connected"),
        { timeout: DIAL_WAIT },
      );
      const pid = connectionPid(manager, "slow");
      expect(pid).toBeTypeOf("number");
      expect(pid).toBe(spawnedPid);
      expect(isAlive(pid as number)).toBe(true);
    } finally {
      await dispose(harness);
    }
  });

  it("场景 2：服务器连上之前不声明工具，连上之后才出现", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness({ slow: slowServer() });
    const { manager } = harness;
    try {
      // 拨号在途：本轮工具清单里没有它（与没配这台服务器时一致）。
      expect(manager.getAllConnectedTools()).toEqual([]);
      expect(manager.getServer("slow")?.tools ?? []).toEqual([]);

      await vi.waitFor(
        () => expect(manager.getServer("slow")?.status).toBe("connected"),
        { timeout: DIAL_WAIT },
      );
      expect(manager.getAllConnectedTools().map((tool) => tool.name)).toContain(
        "echo",
      );
      expect(
        manager.getServer("slow")?.tools?.map((tool) => tool.name),
      ).toEqual(["echo"]);
    } finally {
      await dispose(harness);
    }
  });

  it("场景 3：deadline 到点放过本轮，连接继续在后台", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness({ slow: slowServer() });
    const { manager } = harness;
    try {
      const deadlineMs = 50;
      const startedAt = performance.now();
      await manager.waitForTurnDials(deadlineMs);
      const waitedMs = performance.now() - startedAt;
      // 到点就放过本轮（等了 deadline，但远不到服务器就绪的 SLOW_START_MS）。
      expect(waitedMs).toBeGreaterThanOrEqual(deadlineMs - 10);
      expect(waitedMs).toBeLessThan(SLOW_START_MS);
      expect(manager.getServer("slow")?.status).not.toBe("connected");

      // deadline 只是"不再等"，不是取消：连接照常在后台走完、进程还活着。
      await vi.waitFor(
        () => expect(manager.getServer("slow")?.status).toBe("connected"),
        { timeout: DIAL_WAIT },
      );
      const pid = connectionPid(manager, "slow");
      expect(pid).toBeTypeOf("number");
      expect(isAlive(pid as number)).toBe(true);
      expect(
        manager.getServer("slow")?.tools?.map((tool) => tool.name),
      ).toEqual(["echo"]);
    } finally {
      await dispose(harness);
    }
  });

  it("场景 4：alwaysLoad 的服务器超过 deadline 也会被等到", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness({
      eager: { ...slowServer(), alwaysLoad: true },
    });
    const { manager } = harness;
    try {
      const deadlineMs = 50;
      const startedAt = performance.now();
      await manager.waitForTurnDials(deadlineMs);
      const waitedMs = performance.now() - startedAt;
      // 只等 50 ms 的话早就放过了；它一直等到握手完成。
      expect(waitedMs).toBeGreaterThan(deadlineMs);
      expect(manager.getServer("eager")?.status).toBe("connected");
      expect(
        manager.getServer("eager")?.tools?.map((tool) => tool.name),
      ).toEqual(["echo"]);
    } finally {
      await dispose(harness);
    }
  });

  it("场景 5：批量拨号的在途连接数不超过 3", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Slow enough that the dials genuinely overlap, fast enough for 6 of them.
    const probeDelayMs = 300;
    const servers: Record<string, McpServerConfig> = {};
    for (let index = 0; index < 6; index += 1) {
      servers[`server${index}`] = stubServer({
        INIT_DELAY_MS: String(probeDelayMs),
      });
    }
    // No auto-connect: the dial has to start after the counter is in place.
    const harness = await makeHarness(servers, { autoConnect: false });
    const { manager } = harness;
    try {
      const originalConnect = manager.connectServer.bind(manager);
      let inFlight = 0;
      let peak = 0;
      vi.spyOn(manager, "connectServer").mockImplementation(
        async (name, manual) => {
          const tracked = name in servers;
          if (tracked) {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
          }
          try {
            return await originalConnect(name, manual);
          } finally {
            if (tracked) inFlight -= 1;
          }
        },
      );

      manager.startAutoDials();

      // 闸门只排队、不丢活：6 台最终都必须连上。
      await vi.waitFor(
        () =>
          expect(
            manager
              .getAllServers()
              .filter(
                (server) =>
                  server.name in servers && server.status === "connected",
              ),
          ).toHaveLength(6),
        { timeout: DIAL_WAIT },
      );

      // 状态翻成 connected 时那一次 `connectServer` 还没返回（要写完工具快照），
      // 所以再等它退出：全部连上之后不该还有拨号挂着。
      await vi.waitFor(() => expect(inFlight).toBe(0), { timeout: DIAL_WAIT });

      // 场景 5 的批大小就是 3：改了它得先改 spec。
      expect(MCP_CONNECT_BATCH_SIZE).toBe(3);
      // 在途峰值不得超过批大小；6 台慢服务器必须真的把闸门占满，否则上限断言是空的。
      expect(peak).toBeLessThanOrEqual(MCP_CONNECT_BATCH_SIZE);
      expect(peak).toBeGreaterThan(1);
      expect(inFlight).toBe(0);
    } finally {
      await dispose(harness);
    }
  });

  it("场景 7：自动拨号失败后不再自动拨号", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness({
      broken: { type: "stdio", command: join(tmpdir(), "wave-no-such-binary") },
    });
    const { manager } = harness;
    try {
      // 启动期这次拨号就失败了（命令不存在，spawn 直接 ENOENT）。
      await vi.waitFor(
        () => expect(manager.getServer("broken")?.status).toBe("error"),
        { timeout: DIAL_WAIT },
      );

      const connectSpy = vi.spyOn(manager, "connectServer");
      // 之后的回合：没有东西可等（同步返回 undefined），也不会重拨。
      await vi.waitFor(
        () => expect(manager.waitForTurnDials()).toBeUndefined(),
        {
          timeout: DIAL_WAIT,
        },
      );
      expect(manager.waitForTurnDials()).toBeUndefined();
      expect(connectSpy).not.toHaveBeenCalled();
      expect(manager.getServer("broken")?.status).toBe("error");
      expect(connectionPid(manager, "broken")).toBeUndefined();
    } finally {
      await dispose(harness);
    }
  });

  it("没有配置任何服务器时 waitForTurnDials() 同步返回 undefined", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness({});
    const { manager } = harness;
    try {
      // 启动期那一趟还在收尾：它同样没有东西要拨。
      await vi.waitFor(() =>
        expect(manager.waitForTurnDials()).toBeUndefined(),
      );
      // 收尾后连一次让出点都不加 —— 直接是 undefined，不是 Promise。
      expect(manager.waitForTurnDials()).toBeUndefined();
    } finally {
      await dispose(harness);
    }
  });

  it("alwaysLoad 在配置合并链路里不丢", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const harness = await makeHarness(
      { eager: { ...stubServer(), alwaysLoad: true } },
      { autoConnect: false },
    );
    const { manager } = harness;
    try {
      expect(manager.getServer("eager")?.config.alwaysLoad).toBe(true);
    } finally {
      await dispose(harness);
    }
  });
});
