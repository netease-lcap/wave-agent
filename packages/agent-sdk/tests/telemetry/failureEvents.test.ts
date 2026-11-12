import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLogOTelEvent, mockLstat } = vi.hoisted(() => ({
  mockLogOTelEvent: vi.fn(),
  mockLstat: vi.fn(),
}));

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: mockLogOTelEvent,
}));

// The directory's real shape is the thing under test, so it is mocked rather
// than read from disk (a real path is a different shape on every machine).
vi.mock("node:fs/promises", () => ({ lstat: mockLstat }));

import {
  releasePersistFailure,
  reportMcpConnectionFailure,
  reportPersistFailure,
  reportToolCrash,
  reportToolFailure,
  resetFailureEventState,
} from "../../src/telemetry/failureEvents.js";

const CONTEXT = { sessionId: "session-1", workdir: "/work" };

/** The attributes of the n-th reported event. */
function attrsOf(call = 0): Record<string, string | undefined> {
  return mockLogOTelEvent.mock.calls[call][1];
}

beforeEach(() => {
  mockLogOTelEvent.mockReset();
  mockLogOTelEvent.mockResolvedValue(undefined);
  mockLstat.mockReset();
  mockLstat.mockResolvedValue({ isSymbolicLink: () => false });
  resetFailureEventState();
});

describe("reportPersistFailure", () => {
  it("reports a persistence failure as a closed-set category", async () => {
    await reportPersistFailure({
      error: new Error("Session file not found: abc"),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(1);
    expect(mockLogOTelEvent.mock.calls[0][0]).toBe("error");
    expect(attrsOf()).toMatchObject({
      "error.category": "persist",
      error_type: "Error",
      message: "Session file not found: abc",
    });
    expect(mockLogOTelEvent.mock.calls[0][2]).toBe(CONTEXT);
  });

  it("reports a session's failure once, however many tool steps fail", async () => {
    for (let i = 0; i < 20; i++) {
      await reportPersistFailure({
        error: new Error("Session file not found: abc"),
        sessionId: "session-1",
        workdir: "/work",
        context: CONTEXT,
      });
    }

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(1);
  });

  it("reports again after the transcript becomes writable", async () => {
    const fail = () =>
      reportPersistFailure({
        error: new Error("Session file not found: abc"),
        sessionId: "session-1",
        workdir: "/work",
        context: CONTEXT,
      });

    await fail();
    releasePersistFailure("session-1");
    await fail();

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(2);
  });

  it("dedupes per session, not per process", async () => {
    await reportPersistFailure({
      error: new Error("Session file not found: a"),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });
    await reportPersistFailure({
      error: new Error("Session file not found: b"),
      sessionId: "session-2",
      workdir: "/work",
      context: { sessionId: "session-2", workdir: "/work" },
    });

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(2);
  });

  it("carries the directory shape instead of the path", async () => {
    await reportPersistFailure({
      error: new Error("Session file not found: abc"),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });

    const attrs = attrsOf();
    expect(attrs["workdir.hash"]).toMatch(/^[0-9a-f]{12}$/);
    // The literal path must never reach an exporter.
    expect(JSON.stringify(attrs)).not.toContain("/work");
    expect(attrs["workdir.is_symlink"]).toBe("false");
  });

  it("reports whether the directory is a symlink", async () => {
    mockLstat.mockResolvedValue({ isSymbolicLink: () => true });

    await reportPersistFailure({
      error: new Error("Session file not found: abc"),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });

    expect(attrsOf()["workdir.is_symlink"]).toBe("true");
  });

  it("still reports when the directory cannot even be stat'ed", async () => {
    mockLstat.mockRejectedValue(new Error("ENOENT"));

    await reportPersistFailure({
      error: new Error("Session file not found: abc"),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(1);
    expect(attrsOf()["workdir.is_symlink"]).toBe("unknown");
  });

  it("clips an oversized failure summary", async () => {
    await reportPersistFailure({
      error: new Error("x".repeat(5000)),
      sessionId: "session-1",
      workdir: "/work",
      context: CONTEXT,
    });

    const message = attrsOf().message ?? "";
    expect(message.length).toBeLessThan(600);
    expect(message.endsWith("…")).toBe(true);
  });
});

describe("reportMcpConnectionFailure", () => {
  it("reports an unreachable server once per session", async () => {
    for (let i = 0; i < 5; i++) {
      await reportMcpConnectionFailure({
        sessionId: "session-1",
        serverName: "github",
        phase: "lazy",
        context: CONTEXT,
      });
    }

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(1);
    expect(attrsOf()).toMatchObject({
      "error.category": "mcp",
      mcp_server_name: "github",
      mcp_phase: "lazy",
    });
  });

  it("keeps a separate report per server", async () => {
    await reportMcpConnectionFailure({
      sessionId: "session-1",
      serverName: "github",
      phase: "initialize",
      context: CONTEXT,
    });
    await reportMcpConnectionFailure({
      sessionId: "session-1",
      serverName: "jira",
      phase: "initialize",
      context: CONTEXT,
    });

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(2);
  });

  it("reports a config failure as its own surface", async () => {
    await reportMcpConnectionFailure({
      error: new Error("Unexpected token in JSON"),
      sessionId: "session-1",
      serverName: "mcp.json",
      phase: "config",
      context: CONTEXT,
    });

    expect(attrsOf()).toMatchObject({
      "error.category": "mcp",
      mcp_phase: "config",
      message: "Unexpected token in JSON",
    });
  });
});

describe("reportToolCrash", () => {
  it("files a thrown tool as an ERROR-severity event", async () => {
    await reportToolCrash({
      error: new TypeError("plugin blew up"),
      sessionId: "session-1",
      toolName: "Bash",
      isMcp: false,
      context: CONTEXT,
    });

    expect(mockLogOTelEvent.mock.calls[0][0]).toBe("error");
    expect(attrsOf()).toMatchObject({
      "error.category": "tool",
      error_type: "TypeError",
      tool_name: "Bash",
      is_mcp: "false",
    });
  });

  it("files one crash per tool per session", async () => {
    for (let i = 0; i < 3; i++) {
      await reportToolCrash({
        error: new Error("boom"),
        sessionId: "session-1",
        toolName: "Bash",
        isMcp: false,
        context: CONTEXT,
      });
    }

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(1);
  });
});

describe("reportToolFailure", () => {
  it("files a reported failure as WARN tool_error, not as error", async () => {
    await reportToolFailure({
      sessionId: "session-1",
      toolName: "Grep",
      isMcp: false,
      message: "exit code 1",
      context: CONTEXT,
    });

    expect(mockLogOTelEvent.mock.calls[0][0]).toBe("tool_error");
    expect(attrsOf()).toMatchObject({
      "error.category": "tool",
      message: "exit code 1",
      tool_name: "Grep",
    });
  });

  it("reports every occurrence, up to the per-session ceiling", async () => {
    for (let i = 0; i < 60; i++) {
      await reportToolFailure({
        sessionId: "session-1",
        toolName: "Grep",
        isMcp: false,
        message: "exit code 1",
        context: CONTEXT,
      });
    }

    // A model retrying the same failing call must not turn one session into
    // thousands of records, but the first ones are all kept.
    expect(mockLogOTelEvent).toHaveBeenCalledTimes(50);
  });

  it("counts the ceiling per session", async () => {
    for (let i = 0; i < 50; i++) {
      await reportToolFailure({
        sessionId: "session-1",
        toolName: "Grep",
        isMcp: false,
        message: "x",
        context: CONTEXT,
      });
    }
    await reportToolFailure({
      sessionId: "session-2",
      toolName: "Grep",
      isMcp: false,
      message: "x",
      context: { sessionId: "session-2", workdir: "/work" },
    });

    expect(mockLogOTelEvent).toHaveBeenCalledTimes(51);
  });
});
