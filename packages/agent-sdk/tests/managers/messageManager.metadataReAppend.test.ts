import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import { METADATA_REAPPEND_THRESHOLD_BYTES } from "../../src/constants/sessionStorage.js";
import { Container } from "../../src/utils/container.js";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

// The persist-failure bookkeeping sits between the write and the re-append in
// `saveSession`; leaving it real makes it reach into telemetry state the test
// does not set up.
vi.mock("../../src/telemetry/failureEvents.js", () => ({
  reportPersistFailure: vi.fn(),
  releasePersistFailure: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(0),
    reAppendSessionMetadata: vi.fn().mockResolvedValue(false),
  };
});

const WORKDIR = "/test/project";

function createManager(): MessageManager {
  const manager = new MessageManager(new Container(), {
    workdir: WORKDIR,
    callbacks: {},
  });
  manager.addUserMessage({ content: "hello" } as never);
  return manager;
}

/**
 * One save that writes `bytes` to the transcript. Each save needs a message
 * that has not been saved yet — `saveSession` only appends the unsaved tail.
 */
async function saveWriting(
  manager: MessageManager,
  bytes: number,
): Promise<void> {
  manager.addUserMessage({ content: "next" } as never);
  vi.mocked(sessionService.appendMessages).mockResolvedValueOnce(bytes);
  await manager.saveSession();
}

/** The re-append cadence, spied on the manager's own entry point. */
function spyReAppend(manager: MessageManager) {
  return vi.spyOn(manager, "reAppendSessionMetadata");
}

beforeEach(() => {
  vi.restoreAllMocks();
  // `restoreAllMocks` leaves module mocks in place but clears their queued
  // one-shot values, which would otherwise leak into the next test.
  vi.mocked(sessionService.appendMessages).mockReset();
  vi.mocked(sessionService.appendMessages).mockResolvedValue(0);
  vi.mocked(sessionService.reAppendSessionMetadata).mockResolvedValue(false);
});

describe("MessageManager metadata re-append cadence", () => {
  it("re-appends once the transcript has grown by half a tail window", async () => {
    // Derived from the implementation constant, not copied as 32 KB: a test
    // that hardcodes the number would pass even if the constant drifted to a
    // value that no longer fits inside the 64 KB listing window.
    const threshold = METADATA_REAPPEND_THRESHOLD_BYTES;
    const manager = createManager();
    const reAppend = spyReAppend(manager);

    await saveWriting(manager, threshold - 1);
    expect(reAppend).not.toHaveBeenCalled();

    await saveWriting(manager, 1);
    expect(reAppend).toHaveBeenCalledTimes(1);
  });

  it("accumulates bytes across saves instead of looking at a single one", async () => {
    const threshold = METADATA_REAPPEND_THRESHOLD_BYTES;
    const manager = createManager();
    const reAppend = spyReAppend(manager);

    await saveWriting(manager, Math.floor(threshold / 3));
    await saveWriting(manager, Math.floor(threshold / 3));
    expect(reAppend).not.toHaveBeenCalled();

    await saveWriting(manager, threshold);
    expect(reAppend).toHaveBeenCalledTimes(1);
  });

  it("does not re-append again until another half window has been written", async () => {
    const threshold = METADATA_REAPPEND_THRESHOLD_BYTES;
    const manager = createManager();
    const reAppend = spyReAppend(manager);

    await saveWriting(manager, threshold);
    expect(reAppend).toHaveBeenCalledTimes(1);

    await saveWriting(manager, threshold - 1);
    expect(reAppend).toHaveBeenCalledTimes(1);
  });

  it("restarts the count when the user renames", async () => {
    const threshold = METADATA_REAPPEND_THRESHOLD_BYTES;
    const manager = createManager();
    const reAppend = spyReAppend(manager);

    await saveWriting(manager, threshold - 1);
    // A rename appends the entry at the current EOF itself, so the new title
    // starts out as close to EOF as a re-append could put it.
    manager.setCustomTitle("我的标题");

    await saveWriting(manager, threshold - 1);
    expect(reAppend).not.toHaveBeenCalled();
  });
});
