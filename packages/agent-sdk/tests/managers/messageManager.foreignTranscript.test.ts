import { describe, it, expect, vi, beforeEach } from "vitest";
import { join } from "path";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import { SESSION_DIR } from "../../src/services/session.js";
import type { Message } from "../../src/types/index.js";

const appendMessages = vi.hoisted(() => vi.fn().mockResolvedValue(0));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages,
    reAppendSessionMetadata: vi.fn().mockResolvedValue(false),
  };
});

const workdir = "/test/workdir";
const sessionId = "11111111-1111-1111-1111-111111111111";
const foreignPath = join(SESSION_DIR, "other-project", `${sessionId}.jsonl`);

const message = (id: string): Message =>
  ({
    id,
    role: "user",
    blocks: [{ type: "text", content: "hi" }],
    timestamp: new Date().toISOString(),
  }) as Message;

/** A session restored from another project directory: the transcript lives in
 * that directory while `workdir` stays where this process was started. */
function restoreFromOtherProject(manager: MessageManager): void {
  manager.initializeFromSession({
    id: sessionId,
    messages: [message("m1")],
    metadata: {
      workdir: "/other/project",
      lastActiveAt: new Date().toISOString(),
      latestTotalTokens: 0,
    },
    transcriptPath: foreignPath,
  });
}

describe("MessageManager: transcript adopted from another project directory", () => {
  let messageManager: MessageManager;
  const container = new Container();

  beforeEach(() => {
    vi.clearAllMocks();
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    } as unknown as Record<string, unknown>);
    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir,
    });
  });

  it("points at the adopted file and leaves the working directory alone", () => {
    restoreFromOtherProject(messageManager);

    expect(messageManager.getTranscriptPath()).toBe(foreignPath);
    // spec `session-management.md` 验收场景 5: tools keep running in the
    // directory the user started in; only the transcript write follows the
    // session.
    expect(messageManager.getCurrentWorkdir()).toBe(workdir);
  });

  it("appends the next messages to the adopted file", async () => {
    restoreFromOtherProject(messageManager);
    messageManager.addUserMessage({ content: "next turn" });

    await messageManager.saveSession();

    expect(appendMessages).toHaveBeenCalledWith(
      sessionId,
      expect.any(Array),
      workdir,
      "main",
      foreignPath,
    );
  });

  it("stops using it once the conversation is cleared", () => {
    restoreFromOtherProject(messageManager);

    messageManager.clearMessages();

    expect(messageManager.getTranscriptPath()).not.toBe(foreignPath);
    expect(messageManager.getTranscriptPath()).not.toContain("other-project");
    expect(messageManager.getTranscriptPath()).toContain(
      messageManager.getSessionId(),
    );
  });

  it("stops using it when the session moves to another directory", () => {
    restoreFromOtherProject(messageManager);

    messageManager.setCurrentWorkdir("/third/place");

    expect(messageManager.getCurrentWorkdir()).toBe("/third/place");
    expect(messageManager.getTranscriptPath()).not.toBe(foreignPath);
  });

  it("keeps deriving the path for an ordinary session", () => {
    // No `transcriptPath`: every normal session (and every subagent, whose
    // filename carries a `subagent-` prefix) keeps the workdir-derived path.
    messageManager.initializeFromSession({
      id: sessionId,
      messages: [message("m1")],
      metadata: {
        workdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    expect(messageManager.getTranscriptPath()).toBe(
      join(messageManager.getProjectDir(), `${sessionId}.jsonl`),
    );
  });
});
