/**
 * OTLP dynamic headers helper (issue #2401).
 *
 * `node:child_process` is mocked: what is under test here is the contract
 * around the helper — stdout parsing, caching/refresh, in-flight sharing, and
 * the promise that a broken helper degrades instead of rejecting. The real
 * spawn path is the same plumbing hooks use, covered by the hook integration
 * tests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

import {
  setGlobalLogger,
  clearGlobalLogger,
} from "../../src/utils/globalLogger.js";

const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

const loggerMock = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
}

/** A stand-in for a spawned shell, driven by the test. */
function makeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    // A real child emits `close` after being killed; a stub that stayed
    // silent would hang the caller forever.
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
  });
  return child;
}

/**
 * Make the next spawn produce `stdout`/`stderr` and exit with `code`.
 * `code === null` models a process that died from a signal.
 */
function respondWith(result: {
  stdout?: string;
  stderr?: string;
  code?: number | null;
  error?: Error;
  /** Never emit anything — used for the timeout case. */
  hang?: boolean;
}): FakeChild {
  const child = makeChild();
  spawnMock.mockImplementationOnce(() => {
    if (result.hang) return child as unknown as ChildProcess;
    queueMicrotask(() => {
      if (result.stdout) child.stdout.emit("data", Buffer.from(result.stdout));
      if (result.stderr) child.stderr.emit("data", Buffer.from(result.stderr));
      if (result.error) child.emit("error", result.error);
      // `code: null` means "died from a signal" — keep it distinct from 0.
      else
        child.emit("close", result.code === undefined ? 0 : result.code, null);
    });
    return child as unknown as ChildProcess;
  });
  return child;
}

/** The command string the implementation handed to the shell. */
function lastCommand(): string {
  const calls = spawnMock.mock.calls;
  const call = calls[calls.length - 1] as unknown[] | undefined;
  return String((call?.[1] as unknown[] | undefined)?.[1] ?? "");
}

const loadModule = () => import("../../src/telemetry/headersHelper.js");

describe("createHeadersHelperProvider", () => {
  beforeEach(() => {
    spawnMock.mockReset();
    loggerMock.debug.mockClear();
    loggerMock.info.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.error.mockClear();
    setGlobalLogger(loggerMock);
  });

  afterEach(() => {
    clearGlobalLogger();
    vi.useRealTimers();
  });

  it("runs the configured command through a shell", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({ stdout: '{"a":"1"}' });

    const provider = createHeadersHelperProvider({
      command: "mint-token --env prod",
    });
    await expect(provider()).resolves.toEqual({ a: "1" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(lastCommand()).toContain("mint-token --env prod");
  });

  it("parses the header object from stdout", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({
      stdout:
        '\n  {"kubeinsight-client-token":"abc","kubeinsight-application-name":"wave"}\n',
    });

    const provider = createHeadersHelperProvider({ command: "helper" });
    await expect(provider()).resolves.toEqual({
      "kubeinsight-client-token": "abc",
      "kubeinsight-application-name": "wave",
    });
  });

  it("passes cwd and env to the spawned shell", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({ stdout: "{}" });

    const provider = createHeadersHelperProvider({
      command: "helper",
      cwd: "/tmp/project",
      env: { WAVE_TEST_HELPER_ENV: "on" },
    });
    await provider();

    const options = spawnMock.mock.calls[0]![2] as {
      cwd: string;
      env: Record<string, string>;
    };
    expect(options.cwd).toBe("/tmp/project");
    expect(options.env.WAVE_TEST_HELPER_ENV).toBe("on");
  });

  it("caches a successful result within the refresh interval", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({ stdout: '{"run":"1"}' });

    const provider = createHeadersHelperProvider({
      command: "helper",
      refreshMs: 60_000,
    });
    await expect(provider()).resolves.toEqual({ run: "1" });
    await expect(provider()).resolves.toEqual({ run: "1" });

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it("re-runs the helper once the refresh interval has passed", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({ stdout: '{"run":"1"}' });
    respondWith({ stdout: '{"run":"2"}' });

    const provider = createHeadersHelperProvider({
      command: "helper",
      refreshMs: 0,
    });
    await expect(provider()).resolves.toEqual({ run: "1" });
    await expect(provider()).resolves.toEqual({ run: "2" });

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("reads the refresh interval from the env override", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    // Only the clock is faked, so no test waits for real time to pass.
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.WAVE_OTEL_HEADERS_HELPER_DEBOUNCE_MS = "1000";
    try {
      respondWith({ stdout: '{"run":"1"}' });
      respondWith({ stdout: '{"run":"2"}' });

      const provider = createHeadersHelperProvider({ command: "helper" });
      await expect(provider()).resolves.toEqual({ run: "1" });
      // Still inside the override window (the default would be ~29 minutes).
      vi.setSystemTime(Date.now() + 500);
      await expect(provider()).resolves.toEqual({ run: "1" });
      vi.setSystemTime(Date.now() + 600);
      await expect(provider()).resolves.toEqual({ run: "2" });

      expect(spawnMock).toHaveBeenCalledTimes(2);
    } finally {
      delete process.env.WAVE_OTEL_HEADERS_HELPER_DEBOUNCE_MS;
    }
  });

  it("shares one run between concurrent callers", async () => {
    const { createHeadersHelperProvider } = await loadModule();
    respondWith({ stdout: '{"run":"1"}' });

    const provider = createHeadersHelperProvider({
      command: "helper",
      refreshMs: 60_000,
    });
    const [a, b] = await Promise.all([provider(), provider()]);

    expect(a).toEqual({ run: "1" });
    expect(b).toEqual({ run: "1" });
    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  describe("failures never reject", () => {
    it("falls back to no dynamic headers and reports the kind", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stderr: "boom", code: 7 });

      const onFailure = vi.fn();
      const provider = createHeadersHelperProvider({
        command: "helper",
        onFailure,
      });

      await expect(provider()).resolves.toEqual({});
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "exit_code",
        exitCode: 7,
      });
    });

    it("reports empty stdout", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: "  \n" });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "empty_output",
      });
    });

    it("reports invalid JSON", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: "not json" });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "invalid_json",
      });
    });

    it("reports a non-object payload", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: '["a"]' });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "not_an_object",
      });
    });

    it("reports a non-string header value", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: '{"a":1}' });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "non_string_value",
      });
    });

    it("reports a process that dies from a signal", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ code: null });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({ kind: "killed" });
    });

    it("reports a spawn failure", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ error: new Error("ENOENT") });

      const onFailure = vi.fn();
      await createHeadersHelperProvider({ command: "helper", onFailure })();
      expect(onFailure.mock.calls[0]![0]).toMatchObject({
        kind: "spawn_failed",
      });
    });

    it("reports a timeout and kills the process", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      const child = respondWith({ hang: true });

      const onFailure = vi.fn();
      const provider = createHeadersHelperProvider({
        command: "helper",
        onFailure,
        timeoutMs: 20,
      });

      await expect(provider()).resolves.toEqual({});
      expect(onFailure.mock.calls[0]![0]).toMatchObject({ kind: "timeout" });
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("logs once while the same failure repeats", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ code: 3 });
      respondWith({ code: 3 });
      respondWith({ code: 3 });

      const provider = createHeadersHelperProvider({
        command: "helper",
        refreshMs: 0,
      });
      await provider();
      await provider();
      await provider();

      expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    });

    it("never puts helper output into the warning", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: "secret-token-value", code: 3 });
      respondWith({
        stdout: "secret-token-value",
        stderr: "also-secret",
        code: 3,
      });

      const provider = createHeadersHelperProvider({
        command: "helper",
        refreshMs: 0,
      });
      await provider();
      await provider();

      const logged =
        JSON.stringify(loggerMock.warn.mock.calls) +
        JSON.stringify(loggerMock.debug.mock.calls);
      expect(logged).not.toContain("secret-token-value");
      expect(logged).not.toContain("also-secret");
    });

    it("warns again when the failure changes", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ code: 3 });
      respondWith({ code: 9 });

      const provider = createHeadersHelperProvider({
        command: "helper",
        refreshMs: 0,
      });
      await provider();
      await provider();

      expect(loggerMock.warn).toHaveBeenCalledTimes(2);
    });
  });

  describe("last known headers", () => {
    it("reuses the last headers when a refresh fails", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ stdout: '{"token":"first"}' });
      respondWith({ code: 1 });

      const provider = createHeadersHelperProvider({
        command: "helper",
        refreshMs: 0,
      });
      await expect(provider()).resolves.toEqual({ token: "first" });
      await expect(provider()).resolves.toEqual({ token: "first" });

      const logged = loggerMock.warn.mock.calls.flat().join(" ");
      expect(logged).toContain("reusing the last headers");
    });

    it("keeps retrying and recovers once the helper works again", async () => {
      const { createHeadersHelperProvider } = await loadModule();
      respondWith({ code: 1 });
      respondWith({ stdout: '{"token":"second"}' });

      const provider = createHeadersHelperProvider({
        command: "helper",
        refreshMs: 0,
      });
      await expect(provider()).resolves.toEqual({});
      await expect(provider()).resolves.toEqual({ token: "second" });
    });
  });
});
