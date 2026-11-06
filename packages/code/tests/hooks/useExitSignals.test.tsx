import React from "react";
import { render, cleanup } from "../helpers/inkHarness.js";
import { afterEach, describe, it, expect, vi } from "vitest";
import { useExitSignals } from "../../src/hooks/useExitSignals.js";
import { HookTester } from "../helpers/HookTester.js";

type Listener = (...args: unknown[]) => void;

/** The only events under test — everything else falls through to Node. */
const EXIT_SIGNALS = new Set(["SIGINT", "SIGTERM", "SIGHUP"]);

/**
 * The signal a closed terminal sends, where the platform has one. Windows has
 * no SIGHUP — the hook does not subscribe to it there — so the "a signal
 * arrives" cases fall back to SIGTERM, which is registered everywhere.
 */
const CLOSE_SIGNAL = process.platform === "win32" ? "SIGTERM" : "SIGHUP";

/**
 * Capture the exit-signal registrations instead of installing them.
 *
 * Routing real signals at the test process is not an option — a genuine SIGHUP
 * would kill vitest outright. Non-signal events (`exit`, stream events, ...) go
 * to the real `process.on`, otherwise the bookkeeping would count ink's
 * registrations as ours.
 *
 * `new Ink()` is the wrinkle: it subscribes to `signal-exit`, which registers
 * the whole fatal-signal list on `process` — SIGHUP included, whether or not
 * the platform can deliver it. That happens inside the very window being
 * observed, so the mount itself reads as one of ours; on Windows it is the
 * *only* SIGHUP registration, which left all three assertions below looking at
 * ink's leftover handler instead of the hook's (`check-windows`, 2026-11-06).
 * Mounting one throwaway instance before the spies go up fixes it at the
 * source: `signal-exit` subscribes only on its first `onExit()`, so the
 * measured render registers nothing but the hook's own handlers.
 */
function interceptSignals() {
  render(<HookTester hook={() => null} />);
  const handlers = new Map<string, Listener>();
  // Bound before the spies replace the methods, so these stay the originals.
  const realOn = process.on.bind(process);
  const realOff = process.off.bind(process);

  const onSpy = vi.spyOn(process, "on").mockImplementation(((
    event: string,
    listener: Listener,
  ) => {
    if (!EXIT_SIGNALS.has(event)) return realOn(event, listener as never);
    handlers.set(event, listener);
    return process;
  }) as unknown as typeof process.on);

  const offSpy = vi.spyOn(process, "off").mockImplementation(((
    event: string,
    listener: Listener,
  ) => {
    if (!EXIT_SIGNALS.has(event)) return realOff(event, listener as never);
    if (handlers.get(event) === listener) handlers.delete(event);
    return process;
  }) as unknown as typeof process.off);

  return {
    handlers,
    fire: (signal: string) => handlers.get(signal)?.(),
    restore: () => {
      onSpy.mockRestore();
      offSpy.mockRestore();
    },
  };
}

/** Pretend the process owns a terminal, so the TTY-revocation branch arms. */
function withTty() {
  const originalIsTty = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  return () => {
    if (originalIsTty) {
      Object.defineProperty(process.stdin, "isTTY", originalIsTty);
    } else {
      delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
    }
  };
}

const renderExitSignals = (onExitSignal: () => void, enabled?: boolean) =>
  render(
    <HookTester
      hook={() => {
        useExitSignals(onExitSignal, enabled);
        return null;
      }}
    />,
  );

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useExitSignals", () => {
  it(`subscribes to ${CLOSE_SIGNAL} so a closed terminal still unwinds the agent`, async () => {
    const signals = interceptSignals();
    renderExitSignals(vi.fn());

    // SIGHUP is the one that was missing: the Bash tool's `detached: true`
    // children ignore the terminal's SIGHUP broadcast, so unless the CLI
    // handles the signal nobody ever reaps them. Windows has no SIGHUP.
    const expected =
      process.platform === "win32"
        ? ["SIGINT", "SIGTERM"]
        : ["SIGINT", "SIGTERM", "SIGHUP"];

    await vi.waitFor(() => {
      expect(Array.from(signals.handlers.keys()).sort()).toEqual(
        expected.slice().sort(),
      );
    });

    signals.restore();
  });

  it(`invokes the handler when ${CLOSE_SIGNAL} arrives`, async () => {
    const signals = interceptSignals();
    const onExitSignal = vi.fn();
    renderExitSignals(onExitSignal);

    await vi.waitFor(() => {
      expect(signals.handlers.has(CLOSE_SIGNAL)).toBe(true);
    });

    signals.fire(CLOSE_SIGNAL);
    expect(onExitSignal).toHaveBeenCalledTimes(1);

    signals.restore();
  });

  it("removes every listener on unmount", async () => {
    const signals = interceptSignals();
    renderExitSignals(vi.fn());

    await vi.waitFor(() => {
      expect(signals.handlers.size).toBeGreaterThan(0);
    });

    cleanup();
    expect(signals.handlers.size).toBe(0);

    signals.restore();
  });

  it("treats a revoked TTY as an exit signal", async () => {
    vi.useFakeTimers();
    const restoreTty = withTty();
    const writableSpy = vi
      .spyOn(process.stdout, "writable", "get")
      .mockReturnValue(false);

    const signals = interceptSignals();
    const onExitSignal = vi.fn();
    renderExitSignals(onExitSignal);

    // macOS revokes the TTY file descriptors instead of delivering a signal;
    // the poll is the only thing that notices.
    vi.advanceTimersByTime(30_000);
    expect(onExitSignal).toHaveBeenCalledTimes(1);

    // The revoked TTY stays revoked, so the poll must not keep re-firing.
    vi.advanceTimersByTime(30_000);
    expect(onExitSignal).toHaveBeenCalledTimes(1);

    signals.restore();
    writableSpy.mockRestore();
    restoreTty();
  });
});
