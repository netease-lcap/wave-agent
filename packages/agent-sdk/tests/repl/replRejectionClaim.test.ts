import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimUnhandledRejection,
  installUnhandledRejectionClaim,
  markStoppedError,
  rethrowUnhandledRejection,
  REPL_STOPPED_REJECTION_NOTE,
  REPL_UNREAD_REJECTION_NOTE,
} from "../../src/repl/replRejectionClaim.js";
import {
  acquireReplSandbox,
  releaseReplSandbox,
  type ReplSandboxHost,
} from "../../src/repl/replSandbox.js";

function makeHost(): ReplSandboxHost {
  return {
    async callTool() {
      return { ok: true };
    },
    async searchTools() {
      return [];
    },
    async describeTool(name) {
      return { name, description: "a tool", input: "{}" };
    },
    listToolNames: () => [],
    async runShell() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    selfLog() {},
    consoleWrite() {},
    consoleTail: () => "",
    consoleBuffer: () => "",
    consoleDropped: () => 0,
    running: () => [],
    stepError: () => new Error("REPL script stopped: step budget exhausted"),
  };
}

const keys: string[] = [];
let counter = 0;

function open(): ReturnType<typeof acquireReplSandbox> {
  counter += 1;
  const key = `repl-claim-test-${counter}`;
  keys.push(key);
  return acquireReplSandbox(key, makeHost());
}

/** The event the host would otherwise crash on; fires on a later turn. */
function nextUnhandled(): Promise<[unknown, unknown]> {
  return new Promise((resolve) => {
    process.once("unhandledRejection", (reason, promise) =>
      resolve([reason, promise]),
    );
  });
}

/** Installed listeners, in install order — removed again after each test. */
const disposers: Array<() => void> = [];

afterEach(() => {
  while (keys.length > 0) releaseReplSandbox(keys.pop() as string);
  while (disposers.length > 0) (disposers.pop() as () => void)();
});

describe("repl rejection claim", () => {
  it("leaves a rejection from the host alone", () => {
    const reason = new Error("a host bug");
    expect(claimUnhandledRejection(reason, Promise.resolve())).toBeNull();
  });

  it("claims the rejection of a promise the script left unread", async () => {
    const sandbox = open();
    const event = nextUnhandled();
    const outcome = await sandbox.run("Promise.reject(new Error('boom')); 0", {
      toolNames: [],
      timeoutMs: 2_000,
    });
    expect(outcome.ok).toBe(true);

    const [reason, promise] = await event;
    expect(claimUnhandledRejection(reason, promise)).toBe(
      REPL_UNREAD_REJECTION_NOTE,
    );
  });

  it("claims what a stop threw once the run has already answered", async () => {
    const sandbox = open();
    const event = nextUnhandled();
    // The async IIFE returns immediately, so the run answers before the loop is
    // stopped: the promise carrying that stop is one nobody awaits.
    const outcome = await sandbox.run(
      "(async () => { await null; while (true) {} })(); 0",
      { toolNames: [], timeoutMs: 20 },
    );
    expect(outcome.ok).toBe(true);

    const [reason, promise] = await event;
    expect(claimUnhandledRejection(reason, promise)).toBe(
      REPL_STOPPED_REJECTION_NOTE,
    );
  });

  it("still recognises a stop by identity when no promise is passed", async () => {
    const stopped = new Error("stopped");
    markStoppedError(stopped);
    expect(claimUnhandledRejection(stopped)).toBe(REPL_STOPPED_REJECTION_NOTE);
  });
});

/**
 * The wiring every session-holding process installs: ask first, and only crash
 * on what the REPL does not claim. The process semantics matter here — with a
 * listener installed Node's default is gone, so the host's own crash path is
 * the only thing left to decide what happens.
 */
describe("installUnhandledRejectionClaim", () => {
  function install() {
    const report = vi.fn();
    const crash = vi.fn();
    disposers.push(installUnhandledRejectionClaim({ report, crash }));
    return { report, crash };
  }

  it("reports a rejection the REPL owns instead of crashing", async () => {
    const host = install();
    const event = nextUnhandled();
    const sandbox = open();
    const outcome = await sandbox.run("Promise.reject(new Error('boom')); 0", {
      toolNames: [],
      timeoutMs: 2_000,
    });
    expect(outcome.ok).toBe(true);
    // The event really reached the process: what is under test is what the
    // installed listener did with it, not the claim table alone.
    await event;

    expect(host.report).toHaveBeenCalledWith(REPL_UNREAD_REJECTION_NOTE);
    expect(host.crash).not.toHaveBeenCalled();
  });

  it("crashes on a rejection the REPL does not own", async () => {
    const host = install();
    const hostBug = new Error("a host bug");
    void Promise.reject(hostBug);

    await vi.waitFor(() => {
      expect(host.crash).toHaveBeenCalledWith(hostBug);
    });
    expect(host.report).not.toHaveBeenCalled();
  });

  it("leaves the process alone once the disposer ran", () => {
    const before = process.listeners("unhandledRejection").length;
    const host = install();
    expect(process.listeners("unhandledRejection").length).toBe(before + 1);

    (disposers.pop() as () => void)();
    expect(process.listeners("unhandledRejection").length).toBe(before);
    expect(host.crash).not.toHaveBeenCalled();
  });

  it("offers a host with no crash handler of its own Node's default", () => {
    const reason = new Error("a host bug");
    // Thrown from inside the listener, this lands exactly where Node's own
    // unhandled-rejection default puts it: an uncaught exception, exit 1.
    expect(() => rethrowUnhandledRejection(reason)).toThrow(reason);
  });
});
