import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";

const { mockReportPersistFailure, mockReleasePersistFailure } = vi.hoisted(
  () => ({
    mockReportPersistFailure: vi.fn(),
    mockReleasePersistFailure: vi.fn(),
  }),
);

vi.mock("../../src/telemetry/failureEvents.js", () => ({
  reportPersistFailure: mockReportPersistFailure,
  releasePersistFailure: mockReleasePersistFailure,
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
}));

const WORKDIR = "/test/project";

function createManager(): MessageManager {
  const manager = new MessageManager(new Container(), {
    workdir: WORKDIR,
    callbacks: {},
  });
  manager.addUserMessage({ content: "hello" } as never);
  return manager;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReportPersistFailure.mockResolvedValue(undefined);
  mockReleasePersistFailure.mockResolvedValue(undefined);
  vi.mocked(sessionService.appendMessages).mockResolvedValue(undefined);
});

describe("saveSession failure telemetry", () => {
  it("reports a write failure instead of only logging it", async () => {
    const manager = createManager();
    const failure = new Error(
      "Session file not found: e81f0cd1. Use createSession() to create a new session first.",
    );
    vi.mocked(sessionService.appendMessages).mockRejectedValue(failure);

    await manager.saveSession();

    expect(mockReportPersistFailure).toHaveBeenCalledTimes(1);
    const report = mockReportPersistFailure.mock.calls[0][0];
    expect(report.error).toBe(failure);
    expect(report.sessionId).toBe(manager.getSessionId());
    // The directory this write actually used, not a normalized stand-in.
    expect(report.workdir).toBe(WORKDIR);
    expect(report.context).toMatchObject({
      sessionId: manager.getSessionId(),
      workdir: WORKDIR,
    });
  });

  it("swallows the failure so the turn is not disturbed", async () => {
    const manager = createManager();
    vi.mocked(sessionService.appendMessages).mockRejectedValue(
      new Error("Session file not found: abc"),
    );

    // The user's turn must survive a failed save: the message stays in memory
    // and the session keeps working.
    await expect(manager.saveSession()).resolves.toBeUndefined();
  });

  it("releases the dedup slot once a write succeeds", async () => {
    const manager = createManager();

    await manager.saveSession();

    expect(mockReleasePersistFailure).toHaveBeenCalledWith(
      manager.getSessionId(),
    );
    expect(mockReportPersistFailure).not.toHaveBeenCalled();
  });

  it("does not report when there is nothing to save", async () => {
    const manager = createManager();
    await manager.saveSession();
    vi.mocked(sessionService.appendMessages).mockRejectedValue(
      new Error("should not be reached"),
    );

    // No new messages: no write attempt, no failure to report.
    await manager.saveSession();

    expect(mockReportPersistFailure).not.toHaveBeenCalled();
  });
});
