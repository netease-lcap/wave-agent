import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { JsonlHandler } from "@/services/jsonlHandler.js";
import type { Message } from "@/types/messaging.js";
import { generateMessageId } from "@/utils/messageOperations.js";

vi.mock("fs/promises", () => ({
  appendFile: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  rename: vi.fn(),
}));

vi.mock("@/utils/fileUtils.js", () => ({
  getLastLine: vi.fn(),
  readFirstLine: vi.fn(),
  readFirstNLines: vi.fn(),
  readTailLines: vi.fn(),
}));

const customTitleLine = (title: string, sessionId = "s-1") =>
  JSON.stringify({ type: "custom-title", customTitle: title, sessionId });

const messageLine = (content: string, timestamp = "2024-01-01T00:00:00.000Z") =>
  JSON.stringify({
    id: generateMessageId(),
    role: "user",
    blocks: [{ type: "text", content }],
    timestamp,
  } satisfies Message);

describe("JsonlHandler custom-title entries", () => {
  let handler: JsonlHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    const fsPromises = await import("fs/promises");
    vi.mocked(fsPromises.stat).mockResolvedValue({
      size: 1024,
    } as unknown as Awaited<ReturnType<typeof fsPromises.stat>>);
    handler = new JsonlHandler();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("appendCustomTitle()", () => {
    it("appends a custom-title entry as its own JSONL line", async () => {
      const fsPromises = await import("fs/promises");
      const appendFile = vi.mocked(fsPromises.appendFile);

      await handler.appendCustomTitle("/p/s.jsonl", "我的标题", "s-1");

      expect(appendFile).toHaveBeenCalledWith(
        "/p/s.jsonl",
        `${customTitleLine("我的标题")}\n`,
        "utf8",
      );
    });
  });

  describe("readCustomTitle()", () => {
    it("returns undefined when the file has no custom-title entry", async () => {
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fileUtils.readTailLines).mockResolvedValue([
        JSON.stringify({ type: "metadata", workdir: "/repo" }),
        messageLine("first user message"),
      ]);

      expect(await handler.readCustomTitle("/p/s.jsonl")).toBeUndefined();
    });

    it("returns the newest entry when a session was renamed twice", async () => {
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fileUtils.readTailLines).mockResolvedValue([
        customTitleLine("old name"),
        messageLine("a message in between"),
        customTitleLine("new name"),
      ]);

      expect(await handler.readCustomTitle("/p/s.jsonl")).toBe("new name");
    });

    it("returns undefined for an unreadable file", async () => {
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fileUtils.readTailLines).mockResolvedValue([]);

      expect(await handler.readCustomTitle("/p/missing.jsonl")).toBeUndefined();
    });
  });

  describe("reserved entries are never mistaken for messages", () => {
    it("read() skips custom-title lines", async () => {
      const fsPromises = await import("fs/promises");
      vi.mocked(fsPromises.readFile).mockResolvedValue(
        [
          JSON.stringify({ type: "metadata", workdir: "/repo" }),
          messageLine("hello"),
          customTitleLine("我的标题"),
          "",
        ].join("\n"),
      );

      const messages = await handler.read("/p/s.jsonl");

      expect(messages).toHaveLength(1);
      expect(messages[0]!.blocks).toEqual([{ type: "text", content: "hello" }]);
    });

    it("getLastMessage() walks back past a trailing custom-title entry", async () => {
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fileUtils.getLastLine).mockResolvedValue(
        customTitleLine("我的标题"),
      );
      vi.mocked(fileUtils.readTailLines).mockResolvedValue([
        messageLine("last real message", "2024-05-05T00:00:00.000Z"),
        customTitleLine("我的标题"),
      ]);

      const last = await handler.getLastMessage("/p/s.jsonl");

      // A custom-title entry has no timestamp: returning it would make the
      // listing's lastActiveAt an Invalid Date.
      expect(last?.timestamp).toBe("2024-05-05T00:00:00.000Z");
    });

    it("getLatestTotalTokens() ignores custom-title entries", async () => {
      const fileUtils = await import("@/utils/fileUtils.js");
      vi.mocked(fileUtils.readTailLines).mockResolvedValue([
        JSON.stringify({
          id: generateMessageId(),
          role: "assistant",
          blocks: [{ type: "text", content: "done" }],
          timestamp: "2024-05-05T00:00:00.000Z",
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 42 },
        } satisfies Message),
        customTitleLine("我的标题"),
      ]);

      expect(await handler.getLatestTotalTokens("/p/s.jsonl")).toBe(42);
    });
  });
});
