import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

// Only the two calls these entries make into the SDK are stubbed: the real
// installer is what the agent-sdk suite covers, and each host's crash path has
// to stay the host's own (exit 1, or Node's default) for these assertions to
// mean anything.
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    ensureRuntimeDeps: vi.fn(async () => {}),
    installUnhandledRejectionClaim: vi.fn(),
  };
});

// The three servers are wiring, not the subject: never start a real socket
// server or a readline interface on the worker's stdin.
const daemonStart = vi.fn(async () => {});
vi.mock("../src/stdio/daemonServer.js", () => ({
  DaemonServer: vi.fn().mockImplementation(function () {
    return { start: daemonStart };
  }),
}));
const stdioStart = vi.fn();
vi.mock("../src/stdio/stdioServer.js", () => ({
  StdioServer: vi.fn().mockImplementation(function () {
    return { start: stdioStart, stop: vi.fn() };
  }),
}));
vi.mock("ink", () => ({
  render: vi.fn().mockReturnValue({
    unmount: vi.fn(),
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("../src/contexts/useChat.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/contexts/useChat.js")>();
  return { ...actual, getPendingAgentDestroy: () => null };
});

import { installUnhandledRejectionClaim } from "wave-agent-sdk";
import { logger } from "../src/utils/logger.js";
import { startCli, type CliOptions } from "../src/cli.js";
import { startDaemonCli } from "../src/daemon-cli.js";
import { startStdioCli } from "../src/stdio-cli.js";

/** The host object the entry handed the installer. */
function installed(): {
  report: (note: string) => void;
  crash: (reason: unknown) => void;
} {
  const calls = vi.mocked(installUnhandledRejectionClaim).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0][0];
}

const reason = new Error("a host bug");
/** The note the REPL hands back for a rejection it claims (its text is the SDK's
 * business — what these cases pin is where each host puts it). */
const NOTE = "REPL: swallowed an unhandled rejection (not exiting)";
const exit = vi.fn<(code?: string | number | null) => void>();
/** Reached as a spy, so this suite never touches the console member itself. */
let errorOutput: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  // Kept out of the suite output: the stdio crash path writes the stack to
  // stderr and calls process.exit — which would end the whole worker.
  // Recorded instead of exiting — ending the worker would take the suite with it.
  // `process.exit` is typed `never`, hence the cast on the way in.
  vi.spyOn(process, "exit").mockImplementation(((
    code?: string | number | null,
  ) => exit(code)) as (code?: string | number | null) => never);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  // stdio mode reports its startup stage on stdout; this suite is not about it.
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  errorOutput = vi.spyOn(console, "error").mockImplementation(() => {});
  // cli.log is where two of the three hosts report; the logger writes files, so
  // the channel is asserted through it rather than through the terminal.
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rejection claim wiring", () => {
  it("lets the daemon claim a script rejection and keeps Node's default otherwise", async () => {
    await startDaemonCli("\\\\.\\pipe\\rejection-claim-test");

    const host = installed();
    // A claimed rejection is logged to stderr — the daemon's own log channel —
    // and nothing else happens: the process has to stay up.
    host.report(NOTE);
    expect(errorOutput).toHaveBeenCalledWith("[daemon] " + NOTE);
    expect(exit).not.toHaveBeenCalled();
    // Unclaimed, it is what this process did before the listener existed:
    // Node's own default (rethrow → uncaught exception → exit 1).
    expect(() => host.crash(reason)).toThrow(reason);
  });

  it("keeps the stdio host's own crash handler for an unclaimed rejection", async () => {
    await startStdioCli();

    const host = installed();
    host.report(NOTE);
    expect(logger.warn).toHaveBeenCalledWith("[stdio] " + NOTE);
    expect(exit).not.toHaveBeenCalled();

    host.crash(reason);
    // The host's pre-existing semantics: full error into cli.log, then exit(1).
    expect(logger.error).toHaveBeenCalledWith(
      "[stdio] unhandledRejection:",
      reason,
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("lets the interactive CLI claim a script rejection instead of losing the TUI", async () => {
    await startCli({} as CliOptions);

    const host = installed();
    // `startCli` exits 0 once the TUI is gone; what matters here is that
    // reporting adds no exit of its own.
    const exits = exit.mock.calls.length;
    host.report(NOTE);
    // cli.log, not stdout: stdout belongs to the Ink frame.
    expect(logger.warn).toHaveBeenCalledWith("[cli] " + NOTE);
    expect(exit.mock.calls.length).toBe(exits);

    expect(() => host.crash(reason)).toThrow(reason);
  });
});
