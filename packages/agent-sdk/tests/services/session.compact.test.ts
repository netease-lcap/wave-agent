import { describe, it, expect, beforeEach, vi } from "vitest";
import { join } from "path";
import { homedir } from "os";

// Shared mock functions so every `new JsonlHandler()` returns the same mocks
const mockRead = vi.fn();
const mockAppend = vi.fn();

vi.mock("fs", () => ({
  promises: {
    access: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  rmdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("@/utils/fileUtils.js", () => ({
  readFirstLine: vi.fn(),
  getLastLine: vi.fn(),
}));

vi.mock("@/services/jsonlHandler.js", () => ({
  JsonlHandler: vi.fn().mockImplementation(function () {
    return {
      read: mockRead,
      append: mockAppend,
      isValidSessionFilename: vi.fn().mockReturnValue(true),
      parseSessionFilename: vi.fn().mockReturnValue({
        sessionId: "test",
        sessionType: "main",
      }),
      generateSessionFilename: vi
        .fn()
        .mockImplementation((sessionId: string) => `${sessionId}.jsonl`),
      getLastMessage: vi.fn(),
      createSession: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock("@/utils/pathEncoder.js", () => ({
  PathEncoder: vi.fn().mockImplementation(function () {
    return {
      createProjectDirectory: vi.fn(),
      getProjectDirectory: vi.fn().mockResolvedValue({
        originalPath: "/test/workdir",
        encodedName: "encoded-test",
        encodedPath: join(homedir(), ".wave", "projects", "encoded-test"),
        pathHash: undefined,
        isSymbolicLink: false,
      }),
      decode: vi.fn(),
    };
  }),
}));

import {
  appendMessages,
  loadSessionFromJsonl,
  loadFullMessageThread,
  listAllSessions,
} from "@/services/session.js";
import type { Message } from "@/types/index.js";
import { generateMessageId } from "@/utils/messageOperations.js";

describe("Session Append-Only Compaction", () => {
  const testWorkdir = "/test/workdir";

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRead.mockResolvedValue([]);
    mockAppend.mockResolvedValue(undefined);

    const fs = await import("fs/promises");
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readdir).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );
  });

  function makeMessage(role: "user" | "assistant", content: string): Message {
    return {
      id: generateMessageId(),
      role,
      blocks: [{ type: "text", content }],
      timestamp: new Date().toISOString(),
    };
  }

  function makeCompactMessage(content: string): Message {
    return {
      id: generateMessageId(),
      role: "assistant",
      blocks: [{ type: "compact", content }],
      timestamp: new Date().toISOString(),
    };
  }

  it("compaction appends to the same session file (not creating a new session)", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const sessionId = "test-session-1";
    const compactMsg = makeCompactMessage("summary of conversation");
    const retainedMsg = makeMessage("user", "hello");
    const messagesToAppend = [compactMsg, retainedMsg];

    await appendMessages(sessionId, messagesToAppend, testWorkdir, "main");

    expect(mockAppend).toHaveBeenCalledTimes(1);
    // append(filePath, messages, options)
    expect(mockAppend.mock.calls[0][0]).toContain(sessionId);
    expect(mockAppend.mock.calls[0][1]).toEqual(messagesToAppend);

    process.env.NODE_ENV = originalEnv;
  });

  it("multiple compactions append multiple compact boundaries to the same file", async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const sessionId = "test-session-2";

    // First compaction
    const compact1 = makeCompactMessage("first summary");
    const retained1 = makeMessage("user", "msg after first compact");
    await appendMessages(sessionId, [compact1, retained1], testWorkdir, "main");

    // Second compaction
    const compact2 = makeCompactMessage("second summary");
    const retained2 = makeMessage("user", "msg after second compact");
    await appendMessages(sessionId, [compact2, retained2], testWorkdir, "main");

    // Both appends go to the same file path
    expect(mockAppend).toHaveBeenCalledTimes(2);
    const filePath1 = mockAppend.mock.calls[0][0];
    const filePath2 = mockAppend.mock.calls[1][0];
    expect(filePath1).toBe(filePath2);
    expect(filePath1).toContain(sessionId);

    process.env.NODE_ENV = originalEnv;
  });

  it("loadSessionFromJsonl returns only messages after the last compact boundary", async () => {
    const sessionId = "test-session-3";

    // File contains: [old_user, old_assistant, compact1, user1, assistant1, compact2, user2]
    const allMessagesInFile: Message[] = [
      makeMessage("user", "old_user"),
      makeMessage("assistant", "old_assistant"),
      makeCompactMessage("first summary"),
      makeMessage("user", "user1"),
      makeMessage("assistant", "assistant1"),
      makeCompactMessage("second summary"),
      makeMessage("user", "user2"),
    ];

    mockRead.mockResolvedValue(allMessagesInFile);

    const result = await loadSessionFromJsonl(sessionId, testWorkdir, "main");

    expect(result).not.toBeNull();
    // Should return only [compact2, user2] — last compact boundary forward
    expect(result!.messages.length).toBe(2);
    expect(result!.messages[0].blocks[0].type).toBe("compact");
    expect((result!.messages[0].blocks[0] as { content: string }).content).toBe(
      "second summary",
    );
    expect((result!.messages[1].blocks[0] as { content: string }).content).toBe(
      "user2",
    );
  });

  it("loadSessionFromJsonl returns all messages when no compact boundary exists", async () => {
    const sessionId = "test-session-4";
    const messages = [
      makeMessage("user", "hello"),
      makeMessage("assistant", "hi"),
      makeMessage("user", "bye"),
    ];

    mockRead.mockResolvedValue(messages);

    const result = await loadSessionFromJsonl(sessionId, testWorkdir, "main");

    expect(result).not.toBeNull();
    expect(result!.messages.length).toBe(3);
    expect((result!.messages[0].blocks[0] as { content: string }).content).toBe(
      "hello",
    );
    expect((result!.messages[2].blocks[0] as { content: string }).content).toBe(
      "bye",
    );
  });

  it("loadFullMessageThread returns current session's active messages only (no session chain)", async () => {
    const sessionId = "test-session-5";
    const messages = [
      makeCompactMessage("summary"),
      makeMessage("user", "current msg"),
    ];

    mockRead.mockResolvedValue(messages);

    const result = await loadFullMessageThread(sessionId, testWorkdir);

    // Returns only this session's active messages, single session ID
    expect(result.messages.length).toBe(2);
    expect(result.sessionIds).toEqual([sessionId]);
    expect(result.sessionIds.length).toBe(1);
  });

  it("no sessions-index.json is created or read during listAllSessions", async () => {
    // session.ts imports { promises as fs } from "fs", not from "fs/promises"
    const fs = await import("fs");
    vi.mocked(fs.promises.readdir).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>,
    );

    const sessions = await listAllSessions();

    expect(sessions).toEqual([]);

    // Verify writeFile was NOT called to create an index file
    expect(fs.promises.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining("sessions-index"),
      expect.anything(),
    );
    // Verify readFile was NOT called to read an index file
    expect(fs.promises.readFile).not.toHaveBeenCalledWith(
      expect.stringContaining("sessions-index"),
    );
  });
});
