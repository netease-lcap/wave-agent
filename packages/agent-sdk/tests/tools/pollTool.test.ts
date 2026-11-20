import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXEC_MAX_TIMEOUT_MS,
  EXEC_POLL_DEFAULT_WAIT_MS,
  EXEC_POLL_MAX_EVENTS,
} from "../../src/exec/constants.js";
import type { ReplEvent } from "../../src/exec/execRuntime.js";
import type { RunningReplScript } from "../../src/exec/execRuntime.js";
import type { ToolContext } from "../../src/tools/types.js";

/**
 * `Poll` as the model meets it: the shell it renders, and what it decides to wait
 * for. The runtime is mocked because the thing under test is the *decision* — wait
 * or answer at once, how many events one answer carries, what a timeout reads like —
 * not the queue itself, which `execRuntime.test.ts` covers with real scripts.
 */
const { waitForReplEvents, replPendingEventCount, listRunningReplScripts } =
  vi.hoisted(() => ({
    waitForReplEvents: vi.fn(),
    replPendingEventCount: vi.fn(),
    listRunningReplScripts: vi.fn(),
  }));

vi.mock("../../src/exec/execRuntime.js", () => ({
  waitForReplEvents,
  replPendingEventCount,
  listRunningReplScripts,
  // `execTool` imports the runner at module scope; nothing here calls it.
  runReplScript: vi.fn(),
}));

const { pollTool } = await import("../../src/tools/pollTool.js");
const { STRUCTURAL_NON_DEFERRABLE } = await import(
  "../../src/exec/deferral.js"
);

const context = {} as unknown as ToolContext;

function event(
  evalId: number,
  overrides: Partial<ReplEvent["result"]> = {},
): ReplEvent {
  return {
    evalId,
    elapsedMs: 1_200,
    result: {
      ok: true,
      evalId,
      value: `done ${evalId}`,
      logs: [],
      toolCalls: 1,
      toolsUsed: ["Read"],
      images: [],
      ...overrides,
    },
  };
}

function script(id: number, overrides: Partial<RunningReplScript> = {}) {
  return {
    id,
    snippet: "await sleep(60000)",
    ageMs: 5_000,
    state: "running",
    settled: false,
    self: false,
    abort: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  replPendingEventCount.mockReturnValue(0);
  listRunningReplScripts.mockReturnValue([]);
  waitForReplEvents.mockResolvedValue([]);
});

describe("Poll — the tool declaration", () => {
  it("is named Poll and is safe to run beside anything else", () => {
    expect(pollTool.name).toBe("Poll");
    expect(pollTool.config.function.name).toBe("Poll");
    expect(pollTool.isConcurrencySafe).toBe(true);
  });

  it("is structurally non-deferrable, so it can never be pooled", () => {
    // A pooled tool is reachable only from inside a script, and a script is what
    // produced the results this tool reads.
    expect(STRUCTURAL_NON_DEFERRABLE).toContain("Poll");
  });
});

describe("Poll — when to wait", () => {
  it("answers at once when nothing is queued and nothing is running", async () => {
    const result = await pollTool.execute({}, context);

    // Parking here would spend the whole timeout to say "nothing happened".
    expect(waitForReplEvents).not.toHaveBeenCalled();
    expect(result.content).toContain('<event kind="repl-status" pending="0"/>');
    expect(result.content).toContain("No REPL script is running");
    expect(result.shortResult).toBe("idle");
    expect(result.success).toBe(true);
  });

  it("waits while a script is still running, then reports it", async () => {
    listRunningReplScripts.mockReturnValue([script(3)]);

    const result = await pollTool.execute({ timeoutMs: 4_000 }, context);

    expect(waitForReplEvents).toHaveBeenCalledWith(4_000, EXEC_POLL_MAX_EVENTS);
    expect(result.content).toContain('<event kind="repl-status" pending="1"/>');
    expect(result.content).toContain("#3 running 5000ms");
    expect(result.content).toContain("await sleep(60000)");
    expect(result.shortResult).toBe("still running");
    expect(result.success).toBe(true);
  });

  it("defaults the wait and clamps an oversized one", async () => {
    listRunningReplScripts.mockReturnValue([script(1)]);

    await pollTool.execute({}, context);
    expect(waitForReplEvents).toHaveBeenLastCalledWith(
      EXEC_POLL_DEFAULT_WAIT_MS,
      EXEC_POLL_MAX_EVENTS,
    );

    await pollTool.execute({ timeoutMs: 10_000_000 }, context);
    expect(waitForReplEvents).toHaveBeenLastCalledWith(
      EXEC_MAX_TIMEOUT_MS,
      EXEC_POLL_MAX_EVENTS,
    );

    await pollTool.execute({ timeoutMs: "soon" }, context);
    expect(waitForReplEvents).toHaveBeenLastCalledWith(
      EXEC_POLL_DEFAULT_WAIT_MS,
      EXEC_POLL_MAX_EVENTS,
    );
  });
});

describe("Poll — what an answer carries", () => {
  it("renders each settled script as a repl-eval event holding its repl-output", async () => {
    replPendingEventCount.mockReturnValue(1);
    waitForReplEvents.mockResolvedValue([event(7)]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toContain('<event kind="repl-eval" eval="7">');
    expect(result.content).toContain('<repl-output eval="7" ms="1200">');
    expect(result.content).toContain("<tools>Read</tools>");
    expect(result.content).toContain("<result>done 7</result>");
    expect(result.content).toContain("</event>");
    expect(result.shortResult).toBe("1 result");
    expect(result.success).toBe(true);
  });

  it("caps one answer and says how many are still pending, oldest first", async () => {
    replPendingEventCount.mockReturnValueOnce(6).mockReturnValue(2);
    waitForReplEvents.mockResolvedValue(
      Array.from({ length: EXEC_POLL_MAX_EVENTS }, (_, index) =>
        event(index + 1),
      ),
    );

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(waitForReplEvents).toHaveBeenCalledWith(5_000, EXEC_POLL_MAX_EVENTS);
    for (let id = 1; id <= EXEC_POLL_MAX_EVENTS; id++) {
      expect(result.content).toContain(`<event kind="repl-eval" eval="${id}">`);
    }
    // Never silently dropped: the model has to know a second poll has substance.
    expect(result.content).not.toContain(
      `<event kind="repl-eval" eval="${EXEC_POLL_MAX_EVENTS + 1}">`,
    );
    expect(result.content).toContain("(2 more settled");
    expect(result.shortResult).toBe(`${EXEC_POLL_MAX_EVENTS} results`);
  });

  it("reports a failed background script as a failure, with the error kept", async () => {
    replPendingEventCount.mockReturnValue(1);
    waitForReplEvents.mockResolvedValue([
      event(9, { ok: false, value: undefined, error: "boom" }),
    ]);

    const result = await pollTool.execute({ timeoutMs: 1_000 }, context);

    expect(result.success).toBe(false);
    expect(result.content).toContain('<event kind="repl-eval" eval="9">');
    expect(result.content).toContain("<error>boom</error>");
    expect(result.error).toBe("A background REPL script failed.");
  });
});
