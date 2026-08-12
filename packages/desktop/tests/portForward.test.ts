import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { SSH_BASE_OPTIONS, LOCAL_HOST } from "../src/main/sshHosts";

const h = vi.hoisted(() => ({
  spawn: vi.fn(),
  /** sshHosts imports execFile for its login-shell probe — unused here. */
  execFile: vi.fn(),
  /** per-port probe result for the ready check (absent = connect succeeds) */
  connectResults: new Map<number, boolean>(),
  /** per-port bind result for canBind (absent = bind succeeds) */
  listenResults: new Map<number, boolean>(),
}));

class FakeChild extends EventEmitter {
  kill = vi.fn();
}

class FakeSocket extends EventEmitter {
  constructor(private port: number) {
    super();
  }
  destroy(): void {
    this.removeAllListeners();
  }
}

class FakeServer extends EventEmitter {
  listen(opts: { port: number }, cb: () => void): void {
    if (h.listenResults.get(opts.port) ?? true) {
      cb();
    } else {
      this.emit("error", new Error("EADDRINUSE"));
    }
  }
  close(cb?: () => void): void {
    cb?.();
  }
}

vi.mock("child_process", () => ({ spawn: h.spawn, execFile: h.execFile }));

vi.mock("net", () => ({
  connect: (opts: { port: number }) => {
    const socket = new FakeSocket(opts.port);
    process.nextTick(() => {
      if (h.connectResults.get(opts.port) ?? true) socket.emit("connect");
      else socket.emit("error", new Error("ECONNREFUSED"));
    });
    return socket;
  },
  createServer: () => new FakeServer(),
}));

import {
  PortForwardManager,
  rewriteForwardedUrl,
} from "../src/main/portForward";

const lastChild = (): FakeChild =>
  h.spawn.mock.results.at(-1)?.value as FakeChild;

beforeEach(() => {
  h.spawn.mockReset();
  h.connectResults.clear();
  h.listenResults.clear();
  h.spawn.mockImplementation(() => new FakeChild());
});

afterEach(() => {
  // any lingering forward would keep a fake child alive — nothing to leak, but
  // reset the singleton state between tests.
});

describe("PortForwardManager.acquire", () => {
  it("passes local hosts through without spawning ssh", async () => {
    const manager = new PortForwardManager();
    await expect(
      manager.acquire(LOCAL_HOST, "http://localhost:5173/x"),
    ).resolves.toEqual({
      url: "http://localhost:5173/x",
      originalUrl: "http://localhost:5173/x",
    });
    expect(h.spawn).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("rejects non-http(s) schemes and unparseable URLs", async () => {
    const manager = new PortForwardManager();
    await expect(manager.acquire("prod", "file:///etc/passwd")).rejects.toThrow(
      "仅支持 http/https",
    );
    await expect(manager.acquire("prod", "not a url")).rejects.toThrow(
      "无法解析链接",
    );
    manager.dispose();
  });

  it("spawns ssh -N -L bound to 127.0.0.1 and returns the rewritten URL", async () => {
    const manager = new PortForwardManager();
    const result = await manager.acquire(
      "prod",
      "http://localhost:5173/proto?x=1#top",
    );
    expect(h.spawn).toHaveBeenCalledWith(
      "ssh",
      [
        ...SSH_BASE_OPTIONS,
        "-N",
        "-L",
        "127.0.0.1:5173:localhost:5173",
        "prod",
      ],
      { stdio: "ignore" },
    );
    expect(result).toEqual({
      url: "http://127.0.0.1:5173/proto?x=1#top",
      originalUrl: "http://localhost:5173/proto?x=1#top",
    });
    manager.dispose();
  });

  it("defaults https URLs to port 443", async () => {
    const manager = new PortForwardManager();
    const result = await manager.acquire("prod", "https://example.test/");
    expect(h.spawn.mock.calls[0][1]).toContain("127.0.0.1:443:localhost:443");
    expect(result.url).toBe("https://127.0.0.1:443/");
    manager.dispose();
  });

  it("increments to the first free local port when the preferred one is taken", async () => {
    const manager = new PortForwardManager();
    h.listenResults.set(5173, false);
    const result = await manager.acquire("prod", "http://localhost:5173/app");
    expect(h.spawn.mock.calls[0][1]).toContain("127.0.0.1:5174:localhost:5173");
    expect(result.url).toBe("http://127.0.0.1:5174/app");
    manager.dispose();
  });

  it("reuses a ready tunnel: repeated acquires do not spawn again", async () => {
    const manager = new PortForwardManager();
    const first = await manager.acquire(
      "prod",
      "http://localhost:5173/a",
      "s1",
    );
    const second = await manager.acquire(
      "prod",
      "http://localhost:5173/b",
      "s1",
    );
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(second.url).toBe("http://127.0.0.1:5173/b");
    expect(first.url).toBe("http://127.0.0.1:5173/a");
    // a second session sharing the tunnel keeps it alive after s1 drops it
    await manager.acquire("prod", "http://localhost:5173/c", "s2");
    manager.releaseSession("s1");
    expect(lastChild().kill).not.toHaveBeenCalled();
    // the tunnel dies only when the last referencing session releases
    manager.releaseSession("s2");
    expect(lastChild().kill).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("shares a single tunnel between concurrent acquires while connecting", async () => {
    const manager = new PortForwardManager();
    // Both acquires run before the ready probe resolves, so the second must
    // park on the first entry's waiter list.
    const [a, b] = await Promise.all([
      manager.acquire("prod", "http://localhost:5173/a", "s1"),
      manager.acquire("prod", "http://localhost:5173/b", "s2"),
    ]);
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(a.url).toBe("http://127.0.0.1:5173/a");
    expect(b.url).toBe("http://127.0.0.1:5173/b");
    manager.dispose();
  });
});

describe("PortForwardManager lifecycle", () => {
  it("kills the ssh process when the referencing session is deleted", async () => {
    const manager = new PortForwardManager();
    await manager.acquire("prod", "http://localhost:5173/", "s1");
    expect(lastChild().kill).not.toHaveBeenCalled();
    manager.releaseSession("s1");
    expect(lastChild().kill).toHaveBeenCalledTimes(1);
    // a later acquire starts a fresh tunnel
    await manager.acquire("prod", "http://localhost:5173/", "s1");
    expect(h.spawn).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("acquiring from the same session is idempotent — one release kills the tunnel", async () => {
    const manager = new PortForwardManager();
    await manager.acquire("prod", "http://localhost:5173/", "s1");
    await manager.acquire("prod", "http://localhost:5173/", "s1");
    manager.releaseSession("s1");
    expect(h.spawn).toHaveBeenCalledTimes(1);
    expect(lastChild().kill).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("releasing a session with no references is a no-op", async () => {
    const manager = new PortForwardManager();
    await manager.acquire("prod", "http://localhost:5173/", "s1");
    manager.releaseSession("s2");
    expect(lastChild().kill).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("fails the forward when the ssh process exits on its own (remote unreachable)", async () => {
    const manager = new PortForwardManager();
    await manager.acquire("prod", "http://localhost:5173/");
    const child = lastChild();
    child.emit("exit", 255, null);
    // entry is gone — the next acquire must re-spawn
    const result = await manager.acquire("prod", "http://localhost:5173/");
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(result.url).toBe("http://127.0.0.1:5173/");
    manager.dispose();
  });

  it("rejects with an actionable error when the ssh process fails to spawn", async () => {
    const manager = new PortForwardManager();
    // Keep the ready check open so the error lands while the entry is still
    // 'connecting' (a successful probe would resolve the acquire first).
    h.connectResults.set(5173, false);
    const p = manager.acquire("prod", "http://localhost:5173/");
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1));
    (h.spawn.mock.results[0].value as FakeChild).emit(
      "error",
      new Error("ENOENT"),
    );
    await expect(p).rejects.toThrow("转发进程启动失败：ENOENT");
    // the failed entry is removed — retry re-spawns
    h.connectResults.set(5173, true);
    const result = await manager.acquire("prod", "http://localhost:5173/");
    expect(h.spawn).toHaveBeenCalledTimes(2);
    expect(result.url).toBe("http://127.0.0.1:5173/");
    manager.dispose();
  });

  it("fails with a timeout error when the tunnel never comes up (remote service down)", async () => {
    vi.useFakeTimers();
    try {
      const manager = new PortForwardManager();
      h.connectResults.set(5173, false);
      const p = manager.acquire("prod", "http://localhost:5173/");
      // attach the rejection handler BEFORE advancing timers, or the timeout
      // rejection is flagged unhandled while advanceTimersByTimeAsync awaits.
      const assertion = expect(p).rejects.toThrow("转发建立超时");
      await vi.advanceTimersByTimeAsync(20_000);
      await assertion;
      // entry removed — retry starts a fresh tunnel
      h.connectResults.set(5173, true);
      const result = await manager.acquire("prod", "http://localhost:5173/");
      expect(h.spawn).toHaveBeenCalledTimes(2);
      expect(result.url).toBe("http://127.0.0.1:5173/");
      manager.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispose kills every live tunnel", async () => {
    const manager = new PortForwardManager();
    await manager.acquire("prod", "http://localhost:5173/");
    await manager.acquire("prod", "http://localhost:8080/");
    const children = h.spawn.mock.results.map((r) => r.value as FakeChild);
    expect(children).toHaveLength(2);
    manager.dispose();
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(children[1].kill).toHaveBeenCalledTimes(1);
  });
});

describe("rewriteForwardedUrl", () => {
  it("pins the host to 127.0.0.1 and preserves path/search/hash", () => {
    expect(rewriteForwardedUrl("http://localhost:5173/app?a=1#sec", 5173)).toBe(
      "http://127.0.0.1:5173/app?a=1#sec",
    );
    expect(rewriteForwardedUrl("http://localhost:5173", 5174)).toBe(
      "http://127.0.0.1:5174/",
    );
  });
});

describe("PortForwardManager.forwardAuthCallback", () => {
  const authUrl = (port = 3456): string =>
    // Mirrors authService.startLocalAuthServer: callback_url is a bare
    // `http://127.0.0.1:<port>` (no path) — the server reads code from query only.
    `https://sso.example.test/login?client_id=x&callback_url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;

  it("spawns a 127.0.0.1→127.0.0.1 tunnel and rewrites callback_url to the local port", async () => {
    const manager = new PortForwardManager();
    const forward = await manager.forwardAuthCallback("prod", authUrl());
    expect(h.spawn).toHaveBeenCalledWith(
      "ssh",
      [
        ...SSH_BASE_OPTIONS,
        "-N",
        "-L",
        "127.0.0.1:3456:127.0.0.1:3456",
        "prod",
      ],
      { stdio: "ignore" },
    );
    // The daemon binds the remote 127.0.0.1 explicitly — the remote end must
    // be 127.0.0.1, not localhost (which ssh may resolve to ::1).
    const rewritten = new URL(forward.authUrl);
    expect(rewritten.searchParams.get("callback_url")).toBe(
      "http://127.0.0.1:3456",
    );
    // the SSO page and its other params are preserved
    expect(rewritten.searchParams.get("client_id")).toBe("x");
    forward.close();
    manager.dispose();
  });

  it("increments to the first free local port when the preferred one is taken", async () => {
    const manager = new PortForwardManager();
    h.listenResults.set(3456, false);
    const forward = await manager.forwardAuthCallback("prod", authUrl());
    expect(h.spawn.mock.calls[0][1]).toContain("127.0.0.1:3457:127.0.0.1:3456");
    expect(new URL(forward.authUrl).searchParams.get("callback_url")).toBe(
      "http://127.0.0.1:3457",
    );
    forward.close();
    manager.dispose();
  });

  it("avoids colliding with a live preview tunnel on the same local port", async () => {
    const manager = new PortForwardManager();
    await manager.forwardAuthCallback("prod", authUrl(5173));
    // same (host, remote port) key, but a different map — the preview tunnel
    // must still not reuse the auth tunnel's local port 5173
    const result = await manager.acquire("prod", "http://localhost:5173/");
    expect(result.url).toBe("http://127.0.0.1:5174/");
    manager.dispose();
  });

  it("rejects auth URLs without callback_url, with non-http protocol, or unparseable", async () => {
    const manager = new PortForwardManager();
    await expect(
      manager.forwardAuthCallback("prod", "https://sso.example.test/login"),
    ).rejects.toThrow("缺少 callback_url");
    await expect(
      manager.forwardAuthCallback(
        "prod",
        `https://sso.example.test/login?callback_url=${encodeURIComponent("https://127.0.0.1:3456/cb")}`,
      ),
    ).rejects.toThrow("不支持的协议");
    await expect(
      manager.forwardAuthCallback("prod", "not a url"),
    ).rejects.toThrow("无法解析 SSO 回调地址");
    expect(h.spawn).not.toHaveBeenCalled();
    manager.dispose();
  });

  it("close() tears the tunnel down and a later login starts a fresh one", async () => {
    const manager = new PortForwardManager();
    const forward = await manager.forwardAuthCallback("prod", authUrl());
    const child = lastChild();
    forward.close();
    expect(child.kill).toHaveBeenCalledTimes(1);
    await manager.forwardAuthCallback("prod", authUrl());
    expect(h.spawn).toHaveBeenCalledTimes(2);
    manager.dispose();
  });

  it("fails the tunnel when the ssh process dies on its own before the login settles", async () => {
    const manager = new PortForwardManager();
    const forward = await manager.forwardAuthCallback("prod", authUrl());
    lastChild().emit("exit", 255, null);
    // entry is gone — a retry re-spawns
    await manager.forwardAuthCallback("prod", authUrl());
    expect(h.spawn).toHaveBeenCalledTimes(2);
    forward.close();
    manager.dispose();
  });

  it("dispose kills the callback tunnel", async () => {
    const manager = new PortForwardManager();
    await manager.forwardAuthCallback("prod", authUrl(3456));
    const child = lastChild();
    manager.dispose();
    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it("rejects with an actionable error when ssh fails to spawn", async () => {
    const manager = new PortForwardManager();
    h.connectResults.set(3456, false);
    const p = manager.forwardAuthCallback("prod", authUrl());
    await vi.waitFor(() => expect(h.spawn).toHaveBeenCalledTimes(1));
    (h.spawn.mock.results[0].value as FakeChild).emit(
      "error",
      new Error("ENOENT"),
    );
    await expect(p).rejects.toThrow("转发进程启动失败：ENOENT");
    manager.dispose();
  });
});
