import { describe, it, expect, vi, beforeEach } from "vitest";
import { basename, dirname, join } from "path";
import { MessageManager } from "../../src/managers/messageManager.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";
import { pathEncoder } from "../../src/utils/pathEncoder.js";

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

describe("MessageManager.setWorkdir", () => {
  const initialWorkdir = "/test/workdir";
  const otherWorkdir = "/test/other-worktree";

  const createManager = (workdir: string) =>
    new MessageManager(new Container(), {
      workdir,
      callbacks: {},
    });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves the transcript into the new project directory, keeping the session id", () => {
    const manager = createManager(initialWorkdir);
    const sessionId = manager.getSessionId();

    expect(manager.getTranscriptPath()).toBe(
      join(
        manager.getSessionDir(),
        pathEncoder.encodeSync(initialWorkdir),
        `${sessionId}.jsonl`,
      ),
    );

    manager.setWorkdir(otherWorkdir);

    expect(manager.getWorkdir()).toBe(otherWorkdir);
    expect(manager.getSessionId()).toBe(sessionId);
    expect(manager.getTranscriptPath()).toBe(
      join(
        manager.getSessionDir(),
        pathEncoder.encodeSync(otherWorkdir),
        `${sessionId}.jsonl`,
      ),
    );
  });

  it("persists subsequent messages against the new workdir", async () => {
    const manager = createManager(initialWorkdir);
    manager.setWorkdir(otherWorkdir);

    manager.addUserMessage({ content: "hello" });
    await manager.saveSession();

    expect(sessionService.appendMessages).toHaveBeenCalledWith(
      manager.getSessionId(),
      expect.any(Array),
      otherWorkdir,
      "main",
    );
    expect(basename(manager.getTranscriptPath())).toBe(
      `${manager.getSessionId()}.jsonl`,
    );
    expect(dirname(manager.getTranscriptPath())).toContain(
      pathEncoder.encodeSync(otherWorkdir),
    );
  });

  it("is a no-op when the directory is unchanged", () => {
    const manager = createManager(initialWorkdir);
    const before = manager.getTranscriptPath();

    manager.setWorkdir(initialWorkdir);

    expect(manager.getTranscriptPath()).toBe(before);
  });
});
