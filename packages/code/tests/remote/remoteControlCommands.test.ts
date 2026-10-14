import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const encodeQr = vi.hoisted(() => vi.fn());

// `qrcode`'s `toString` is async (it hands back a promise, unlike the
// callback-style package this replaced) — the stub keeps that shape so a
// forgotten `await` would show up as "[object Promise]" in the output.
vi.mock("qrcode", () => ({
  toString: (input: string) => {
    encodeQr(input);
    return Promise.resolve(`QR(${input})`);
  },
}));

vi.mock("wave-agent-sdk", () => ({
  authService: {
    getServerUrl: () => "https://codechat.example.com",
    getSSOToken: () => undefined,
  },
  createAuthAwareFetch: (inner: typeof fetch) => inner,
}));

vi.mock("../../src/daemon/commands.js", () => ({
  DEFAULT_DAEMON_SOCKET: "/tmp/fake-daemon.sock",
  connectDaemonOrExit: vi.fn(),
  connectDaemonIfRunning: vi.fn(),
}));

import {
  connectDaemonIfRunning,
  connectDaemonOrExit,
} from "../../src/daemon/commands.js";
import {
  remoteControlOnCommand,
  remoteControlOffCommand,
  remoteControlStatusCommand,
  PAIRING_WAIT_MS,
} from "../../src/remote/remoteControlCommands.js";

const onExit = connectDaemonOrExit as ReturnType<typeof vi.fn>;
const ifRunning = connectDaemonIfRunning as ReturnType<typeof vi.fn>;

/** A daemon client double recording requests and scripting responses. */
function createClient(responses: Record<string, unknown | (() => unknown)>): {
  request: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn((method: string) => {
      const response = responses[method];
      if (response === undefined)
        throw new Error(`unexpected request: ${method}`);
      return Promise.resolve(
        typeof response === "function"
          ? (response as () => unknown)()
          : response,
      );
    }),
    dispose: vi.fn(),
  };
}

const PAIRING = {
  code: "4821",
  expiresAt: "2026-10-13T10:00:00Z",
};

describe("wave remote-control", () => {
  let out: string[];
  let err: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(" "));
    });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("__exit__");
    }) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function text(): string {
    return out.join("\n");
  }

  describe("on", () => {
    it("should connect the daemon and print the pairing code with a QR", async () => {
      const client = createClient({
        remoteControlConnect: {
          state: "online",
          url: "wss://relay/v1/hosts/ws/h1/subscribe",
          pairing: PAIRING,
        },
      });
      onExit.mockResolvedValue(client);

      await expect(remoteControlOnCommand()).rejects.toThrow("__exit__");

      expect(client.request).toHaveBeenCalledWith("remoteControlConnect", {});
      expect(text()).toContain("wss://relay/v1/hosts/ws/h1/subscribe");
      expect(text()).toContain("配对码：4821");
      expect(text()).toContain(
        "Web 页：https://codechat.example.com/remote/?code=4821",
      );
      expect(text()).toContain(
        "QR(https://codechat.example.com/remote/?code=4821)",
      );
      expect(encodeQr).toHaveBeenCalledTimes(1);
      expect(client.dispose).toHaveBeenCalled();
    });

    it("should pass the machine label through to the daemon", async () => {
      const client = createClient({
        remoteControlConnect: { state: "online", pairing: PAIRING },
      });
      onExit.mockResolvedValue(client);

      await expect(remoteControlOnCommand("我的笔记本")).rejects.toThrow(
        "__exit__",
      );
      expect(client.request).toHaveBeenCalledWith("remoteControlConnect", {
        name: "我的笔记本",
      });
    });

    it("should wait for the registration round trip to deliver a code", async () => {
      let polls = 0;
      const client = createClient({
        remoteControlConnect: { state: "connecting" },
        remoteControlStatus: () => {
          polls += 1;
          return polls < 2
            ? { state: "connecting" }
            : { state: "online", pairing: PAIRING };
        },
      });
      onExit.mockResolvedValue(client);

      const pending = remoteControlOnCommand().catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(2_000);
      await expect(pending).resolves.toBe("__exit__");

      expect(text()).toContain("配对码：4821");
    });

    it("should say how to get a code when none is available", async () => {
      const client = createClient({
        remoteControlConnect: { state: "connecting" },
        remoteControlStatus: { state: "connecting" },
      });
      onExit.mockResolvedValue(client);

      const pending = remoteControlOnCommand().catch((e: Error) => e.message);
      await vi.advanceTimersByTimeAsync(PAIRING_WAIT_MS + 1_000);
      await expect(pending).resolves.toBe("__exit__");

      // A code is issued once, at registration, and lasts ten minutes — there
      // is no "give me another one" call, so the recovery is spelled out.
      expect(text()).toContain("没有拿到配对码");
      expect(text()).toContain("10 分钟内有效");
      expect(text()).toContain("remote-control.json");
    });

    it("should explain how to enable the switch when the daemon says it is off", async () => {
      const client = createClient({
        remoteControlConnect: {
          state: "error",
          message:
            "Remote control is not enabled on this process (set enableRemoteControl: true).",
        },
      });
      onExit.mockResolvedValue(client);

      await expect(remoteControlOnCommand()).rejects.toThrow("__exit__");

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(err.join("\n")).toContain("enableRemoteControl");
      expect(err.join("\n")).toContain("wave daemon restart");
    });

    it("should give up with a diagnostic when the daemon cannot be reached", async () => {
      onExit.mockRejectedValue(new Error("no socket"));

      await expect(remoteControlOnCommand()).rejects.toThrow("__exit__");
      expect(err.join("\n")).toContain("no socket");
    });
  });

  describe("off", () => {
    it("should never start a daemon just to disconnect", async () => {
      ifRunning.mockResolvedValue(undefined);

      await expect(remoteControlOffCommand()).rejects.toThrow("__exit__");

      expect(onExit).not.toHaveBeenCalled();
      expect(text()).toContain("未开启");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("should disconnect a running daemon", async () => {
      const client = createClient({
        remoteControlDisconnect: { state: "off" },
      });
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlOffCommand()).rejects.toThrow("__exit__");

      expect(client.request).toHaveBeenCalledWith(
        "remoteControlDisconnect",
        {},
      );
      expect(text()).toContain("已断开");
      expect(client.dispose).toHaveBeenCalled();
    });

    it("should treat an unenabled daemon as already off", async () => {
      const client = {
        request: vi.fn(() =>
          Promise.reject(
            new Error(
              "Remote control is not enabled on this process (set enableRemoteControl: true).",
            ),
          ),
        ),
        dispose: vi.fn(),
      };
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlOffCommand()).rejects.toThrow("__exit__");

      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(out.join("\n")).toContain("已关闭");
      expect(err.join("\n")).not.toContain("失败");
    });
  });

  describe("status", () => {
    it("should report that nothing is running without starting a daemon", async () => {
      ifRunning.mockResolvedValue(undefined);

      await expect(remoteControlStatusCommand()).rejects.toThrow("__exit__");

      expect(onExit).not.toHaveBeenCalled();
      expect(text()).toContain("未开启");
    });

    it("should print the state, relay url and pairing code", async () => {
      const client = createClient({
        remoteControlStatus: {
          state: "online",
          url: "wss://relay/v1/hosts/ws/h1/subscribe",
          pairing: PAIRING,
        },
      });
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlStatusCommand()).rejects.toThrow("__exit__");

      expect(text()).toContain("状态：online");
      expect(text()).toContain("中继：wss://relay/v1/hosts/ws/h1/subscribe");
      expect(text()).toContain("配对码：4821");
      expect(client.dispose).toHaveBeenCalled();
    });

    it("should say plainly that the code is gone rather than leave it blank", async () => {
      const client = createClient({
        remoteControlStatus: {
          state: "online",
          url: "wss://relay/v1/hosts/ws/h1/subscribe",
        },
      });
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlStatusCommand()).rejects.toThrow("__exit__");

      expect(text()).toContain("配对码：无");
    });

    it("should report an error state without exiting nonzero", async () => {
      const client = createClient({
        remoteControlStatus: {
          state: "error",
          message: "relay rejected the credential (4003)",
        },
      });
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlStatusCommand()).rejects.toThrow("__exit__");

      expect(text()).toContain("状态：error");
      expect(text()).toContain("4003");
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it("should exit nonzero when the daemon cannot answer at all", async () => {
      const client = {
        request: vi.fn(() =>
          Promise.reject(new Error("Method not found: remoteControlStatus")),
        ),
        dispose: vi.fn(),
      };
      ifRunning.mockResolvedValue(client);

      await expect(remoteControlStatusCommand()).rejects.toThrow("__exit__");

      // An older daemon predates the method; a status we could not read is not
      // the same answer as "off".
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(err.join("\n")).toContain("Method not found");
      expect(client.dispose).toHaveBeenCalled();
    });
  });
});
