import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SocketClient } from "../../src/daemon/socketClient.js";
import {
  remoteRestorePolicy,
  restoreRemoteControl,
  sampleRemoteControlState,
  shouldRestoreRemoteControl,
} from "../../src/remote/remoteControlRestore.js";

/**
 * A daemon client double. `script` decides what each method answers, in call
 * order — the last entry repeats, so a test can script "connecting, then
 * online" without counting its own polls.
 */
function createClient(script: Record<string, Array<unknown | Error>>): {
  request: ReturnType<typeof vi.fn>;
} {
  const calls: Record<string, number> = {};
  return {
    request: vi.fn((method: string) => {
      const answers = script[method];
      if (!answers || answers.length === 0) {
        return Promise.reject(new Error(`unexpected request: ${method}`));
      }
      const index = calls[method] ?? 0;
      calls[method] = index + 1;
      const answer = answers[Math.min(index, answers.length - 1)];
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    }),
  };
}

const client = (fake: { request: ReturnType<typeof vi.fn> }) =>
  fake as unknown as SocketClient;

const callsOf = (fake: { request: ReturnType<typeof vi.fn> }, method: string) =>
  fake.request.mock.calls.filter(([m]) => m === method).length;

const saved = { ...remoteRestorePolicy };

describe("sampleRemoteControlState", () => {
  it("should report the state the running daemon holds", async () => {
    const fake = createClient({
      remoteControlStatus: [{ state: "online" }, { state: "off" }],
    });
    await expect(sampleRemoteControlState(client(fake))).resolves.toBe(
      "online",
    );
    expect(fake.request).toHaveBeenCalledWith("remoteControlStatus", {});
  });

  it("should read an unanswerable status as 'nothing was on'", async () => {
    // An older daemon predates the RPC; a daemon with the switch off answers
    // with the bridge's own "not enabled" error. Neither may fail a restart.
    const fake = createClient({
      remoteControlStatus: [new Error("Method not found: remoteControlStatus")],
    });
    await expect(
      sampleRemoteControlState(client(fake)),
    ).resolves.toBeUndefined();
  });
});

describe("shouldRestoreRemoteControl", () => {
  it("should keep a state a healthy machine produced, and only those", () => {
    // `off` is the initial state and `error` is a dial that the relay refused —
    // keeping a state is not retrying a broken one, so only a live link (or one
    // still being dialed) counts as "the user had it on".
    expect(shouldRestoreRemoteControl("off")).toBe(false);
    expect(shouldRestoreRemoteControl(undefined)).toBe(false);
    expect(shouldRestoreRemoteControl("error")).toBe(false);
    expect(shouldRestoreRemoteControl("online")).toBe(true);
    expect(shouldRestoreRemoteControl("connecting")).toBe(true);
  });
});

describe("restoreRemoteControl", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    remoteRestorePolicy.attemptTimeoutMs = 1_000;
    remoteRestorePolicy.pollIntervalMs = 200;
  });

  afterEach(() => {
    Object.assign(remoteRestorePolicy, saved);
    vi.useRealTimers();
  });

  it("should report success when the dial settles online", async () => {
    const fake = createClient({
      remoteControlConnect: [{ state: "connecting" }],
      remoteControlStatus: [
        { state: "connecting" },
        { state: "online", pageUrl: "https://x/remote/?host=h1" },
      ],
    });

    const pending = restoreRemoteControl(client(fake));
    await vi.advanceTimersByTimeAsync(remoteRestorePolicy.pollIntervalMs * 2);
    await expect(pending).resolves.toEqual({ ok: true });
    // One dial only: an attempt that ends online is not retried and the loop
    // does not leave a second connect behind.
    expect(callsOf(fake, "remoteControlConnect")).toBe(1);
  });

  it("should accept a dial that is already online on its first answer", async () => {
    const fake = createClient({ remoteControlConnect: [{ state: "online" }] });
    await expect(restoreRemoteControl(client(fake))).resolves.toEqual({
      ok: true,
    });
    // Already online: no polling round trip is paid for it.
    expect(callsOf(fake, "remoteControlStatus")).toBe(0);
  });

  it("should carry the stored label on the dial, and nothing when there is none", async () => {
    // The relay shows whatever the last `hostHello` carried: a fresh daemon has
    // no name, so the restore dial has to hand the stored one back.
    const named = createClient({ remoteControlConnect: [{ state: "online" }] });
    await expect(
      restoreRemoteControl(client(named), "my-laptop"),
    ).resolves.toEqual({ ok: true });
    expect(named.request).toHaveBeenCalledWith("remoteControlConnect", {
      name: "my-laptop",
    });

    const anonymous = createClient({
      remoteControlConnect: [{ state: "online" }],
    });
    await restoreRemoteControl(client(anonymous));
    expect(anonymous.request).toHaveBeenCalledWith("remoteControlConnect", {});
  });

  it("should give up after one dial when the relay refuses it", async () => {
    const fake = createClient({
      remoteControlConnect: [{ state: "connecting" }],
      remoteControlStatus: [
        { state: "error", message: "the relay refused this machine" },
      ],
    });

    const pending = restoreRemoteControl(client(fake));
    await vi.advanceTimersByTimeAsync(remoteRestorePolicy.pollIntervalMs);
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "the relay refused this machine",
    });
    // A refused dial is not re-dialed: the daemon's own service owns retries.
    expect(callsOf(fake, "remoteControlConnect")).toBe(1);
  });

  it("should stop once the budget is spent, and flag the dial as still in flight", async () => {
    const fake = createClient({
      remoteControlConnect: [{ state: "connecting" }],
      remoteControlStatus: [{ state: "connecting" }],
    });

    const pending = restoreRemoteControl(client(fake));
    // Everything the policy allows and nothing beyond it: a restart may not hang
    // on the relay.
    await vi.advanceTimersByTimeAsync(remoteRestorePolicy.attemptTimeoutMs);
    // `retrying` is not the same failure as a refused dial: the service keeps
    // dialing on its own, so the caller must not tell the user to re-dial.
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "no answer from the relay yet",
      retrying: true,
    });
    expect(callsOf(fake, "remoteControlConnect")).toBe(1);
  });

  it("should not retry when the fresh daemon has no remote control at all", async () => {
    // The switch was turned off in settings: the bridge answers the RPC with an
    // error that says so. Retrying cannot change it, so the warning comes now.
    const fake = createClient({
      remoteControlConnect: [
        new Error(
          "Remote control is not enabled on this process (set enableRemoteControl: true).",
        ),
      ],
    });

    await expect(restoreRemoteControl(client(fake))).resolves.toEqual({
      ok: false,
      reason:
        "Remote control is not enabled on this process (set enableRemoteControl: true).",
    });
    expect(callsOf(fake, "remoteControlConnect")).toBe(1);
  });
});
