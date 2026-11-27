import { afterEach, describe, expect, it } from "vitest";
import {
  claimUnhandledRejection,
  markStoppedError,
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

afterEach(() => {
  while (keys.length > 0) releaseReplSandbox(keys.pop() as string);
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
