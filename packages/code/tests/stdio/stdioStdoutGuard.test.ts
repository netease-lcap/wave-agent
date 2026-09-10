import { afterEach, expect, it, vi } from "vitest";

vi.mock("wave-agent-sdk");
// stdio mode is only the wiring under test here — never start a real server
// (it would attach readline to the worker's stdin and keep the process alive).
const startSpy = vi.fn();
vi.mock("../../src/stdio/stdioServer.js", () => ({
  StdioServer: vi.fn().mockImplementation(function () {
    return { start: startSpy, stop: vi.fn() };
  }),
}));

import { guardStdoutForJsonRpc, startStdioCli } from "../../src/stdio-cli.js";

/**
 * `wave --stdio` speaks JSON-RPC on stdout (one JSON object per line) and
 * reserves stderr for logger output, so any `console.log` in the dependency
 * graph corrupts the channel: the host drops the unparseable line *and* the
 * payload that shared it. `SessionService` used to do exactly that on every
 * session restore, which the host surfaced as
 * `[wave-jsonrpc] Failed to parse: Restoring session: <id>`.
 *
 * The console IS the subject under test, so it is reached through
 * `consoleLevel()` instead of `console.x` member syntax (banned in tests by
 * oxlint's no-console). Vitest intercepts `console.*` itself, so the
 * assertions target the redirection the guard installs (console.log/info/debug
 * → console.error, i.e. stderr) rather than the process stream.
 */
type ConsoleLevel = "log" | "info" | "debug" | "error" | "warn";
const consoleLevel = (level: ConsoleLevel): unknown => console[level];
const setConsoleLevel = (level: ConsoleLevel, value: unknown): void => {
  console[level] = value as (...args: unknown[]) => void;
};

const LEVELS: ConsoleLevel[] = ["log", "info", "debug", "error", "warn"];
const snapshot = () =>
  Object.fromEntries(LEVELS.map((level) => [level, consoleLevel(level)]));

/** Drop the crash handlers startStdioCli registers (they call process.exit). */
function removeCrashHandlers(before: {
  exception: NodeJS.UncaughtExceptionListener[];
  rejection: NodeJS.UnhandledRejectionListener[];
}): void {
  for (const listener of process.listeners("uncaughtException")) {
    if (!before.exception.includes(listener)) {
      process.removeListener("uncaughtException", listener);
    }
  }
  for (const listener of process.listeners("unhandledRejection")) {
    if (!before.rejection.includes(listener)) {
      process.removeListener("unhandledRejection", listener);
    }
  }
}

const originalConsole = snapshot();
let listeners = {
  exception: [] as NodeJS.UncaughtExceptionListener[],
  rejection: [] as NodeJS.UnhandledRejectionListener[],
};

afterEach(() => {
  for (const level of LEVELS) setConsoleLevel(level, originalConsole[level]);
  removeCrashHandlers(listeners);
  vi.clearAllMocks();
});

it("moves console.log/info/debug onto stderr when stdio mode starts", async () => {
  listeners = {
    exception: process.listeners("uncaughtException"),
    rejection: process.listeners("unhandledRejection"),
  };

  await startStdioCli();

  expect(startSpy).toHaveBeenCalled();
  // The three stdout-bound levels are redirected…
  expect(consoleLevel("log")).not.toBe(originalConsole.log);
  expect(consoleLevel("info")).not.toBe(originalConsole.info);
  expect(consoleLevel("debug")).not.toBe(originalConsole.debug);
  // …and the stderr-bound ones are left exactly as they were.
  expect(consoleLevel("error")).toBe(originalConsole.error);
  expect(consoleLevel("warn")).toBe(originalConsole.warn);
});

it("forwards the redirected levels to console.error with their arguments", () => {
  const forwarded: unknown[][] = [];
  setConsoleLevel("error", (...args: unknown[]) => {
    forwarded.push(args);
  });

  guardStdoutForJsonRpc();
  (consoleLevel("log") as (...args: unknown[]) => void)(
    "Restoring session: abc-123",
  );
  (consoleLevel("info") as (...args: unknown[]) => void)("info line");
  (consoleLevel("debug") as (...args: unknown[]) => void)("debug line");

  // Everything landed on the stderr-bound channel, in order, with its args.
  expect(forwarded).toEqual([
    ["Restoring session: abc-123"],
    ["info line"],
    ["debug line"],
  ]);
});

it("does not touch the console just by importing the module", async () => {
  // Guarding at import time would silently redirect the interactive Ink CLI's
  // output — stdio mode is the only place the contract applies.
  vi.resetModules();

  await import("../../src/stdio-cli.js");

  expect(snapshot()).toEqual(originalConsole);
});
