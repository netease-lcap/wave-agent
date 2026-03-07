import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import { PromptHistoryManager } from "../../src/utils/promptHistory.js";

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    promises: {
      appendFile: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      mkdir: vi.fn(),
    },
  },
  existsSync: vi.fn(),
  promises: {
    appendFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  },
}));
vi.mock("../../src/utils/constants.js", () => ({
  PROMPT_HISTORY_FILE: "/mock/path/history.jsonl",
  DATA_DIRECTORY: "/mock/path",
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe("PromptHistoryManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addEntry", () => {
    it("should append a new entry to the history file", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const appendFileSpy = vi
        .spyOn(fs.promises, "appendFile")
        .mockResolvedValue(undefined);

      await PromptHistoryManager.addEntry(
        "hello world",
        "session-1",
        {
          "[LongText#1]": "very long text",
        },
        "/home/user/project",
      );

      expect(appendFileSpy).toHaveBeenCalledWith(
        "/mock/path/history.jsonl",
        expect.stringContaining('"prompt":"hello world"'),
        "utf-8",
      );
      expect(appendFileSpy).toHaveBeenCalledWith(
        "/mock/path/history.jsonl",
        expect.stringContaining('"sessionId":"session-1"'),
        "utf-8",
      );
      expect(appendFileSpy).toHaveBeenCalledWith(
        "/mock/path/history.jsonl",
        expect.stringContaining(
          '"longTextMap":{"[LongText#1]":"very long text"}',
        ),
        "utf-8",
      );
      expect(appendFileSpy).toHaveBeenCalledWith(
        "/mock/path/history.jsonl",
        expect.stringContaining('"workdir":"/home/user/project"'),
        "utf-8",
      );
    });

    it("should not add empty prompts", async () => {
      const appendFileSpy = vi.spyOn(fs.promises, "appendFile");
      await PromptHistoryManager.addEntry("  ");
      expect(appendFileSpy).not.toHaveBeenCalled();
    });
  });

  describe("getHistory", () => {
    it("should return an empty array if the file does not exist", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const history = await PromptHistoryManager.getHistory();
      expect(history).toEqual([]);
    });

    it("should return parsed entries in reverse order and deduplicated", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({ prompt: "first", timestamp: 1000 }) +
        "\n" +
        JSON.stringify({ prompt: "second", timestamp: 2000 }) +
        "\n" +
        JSON.stringify({ prompt: "first", timestamp: 3000 }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const history = await PromptHistoryManager.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].prompt).toBe("first");
      expect(history[0].timestamp).toBe(3000);
      expect(history[1].prompt).toBe("second");
    });

    it("should filter by sessionId if provided", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({
          prompt: "session1-a",
          timestamp: 1000,
          sessionId: "s1",
        }) +
        "\n" +
        JSON.stringify({
          prompt: "session2-a",
          timestamp: 2000,
          sessionId: "s2",
        }) +
        "\n" +
        JSON.stringify({
          prompt: "session1-b",
          timestamp: 3000,
          sessionId: "s1",
        }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const history = await PromptHistoryManager.getHistory({
        sessionId: "s1",
      });
      expect(history).toHaveLength(2);
      expect(history[0].prompt).toBe("session1-b");
      expect(history[1].prompt).toBe("session1-a");
    });

    it("should filter by multiple sessionIds if provided", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({
          prompt: "s1-a",
          timestamp: 1000,
          sessionId: "s1",
        }) +
        "\n" +
        JSON.stringify({
          prompt: "s2-a",
          timestamp: 2000,
          sessionId: "s2",
        }) +
        "\n" +
        JSON.stringify({
          prompt: "s3-a",
          timestamp: 3000,
          sessionId: "s3",
        }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const history = await PromptHistoryManager.getHistory({
        sessionId: ["s1", "s2"],
      });
      expect(history).toHaveLength(2);
      expect(history[0].prompt).toBe("s2-a");
      expect(history[1].prompt).toBe("s1-a");
    });

    it("should filter by workdir if provided", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({
          prompt: "w1-a",
          timestamp: 1000,
          workdir: "w1",
        }) +
        "\n" +
        JSON.stringify({
          prompt: "w2-a",
          timestamp: 2000,
          workdir: "w2",
        }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const history = await PromptHistoryManager.getHistory({ workdir: "w1" });
      expect(history).toHaveLength(1);
      expect(history[0].prompt).toBe("w1-a");
    });
  });

  describe("searchHistory", () => {
    it("should filter entries case-insensitively", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({ prompt: "Hello World", timestamp: 1000 }) +
        "\n" +
        JSON.stringify({ prompt: "foo bar", timestamp: 2000 }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const results = await PromptHistoryManager.searchHistory("hello");
      expect(results).toHaveLength(1);
      expect(results[0].prompt).toBe("Hello World");
    });

    it("should return all history if query is empty", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({ prompt: "test", timestamp: 1000 }) + "\n";
      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const results = await PromptHistoryManager.searchHistory("");
      expect(results).toHaveLength(1);
    });
  });

  describe("trimHistory", () => {
    it("should trim history when it exceeds limit", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.spyOn(Math, "random").mockReturnValue(0.01); // Trigger trim

      const manyLines = Array.from({ length: 1300 }, (_, i) =>
        JSON.stringify({ prompt: `prompt ${i}`, timestamp: i }),
      ).join("\n");

      const readFileSpy = vi
        .spyOn(fs.promises, "readFile")
        .mockResolvedValue(manyLines);
      const writeFileSpy = vi
        .spyOn(fs.promises, "writeFile")
        .mockResolvedValue(undefined);
      vi.spyOn(fs.promises, "appendFile").mockResolvedValue(undefined);

      await PromptHistoryManager.addEntry("new prompt");

      expect(readFileSpy).toHaveBeenCalled();
      expect(writeFileSpy).toHaveBeenCalled();
      // Should keep last 1000 entries
      const writtenData = (writeFileSpy.mock.calls[0][1] as string)
        .trim()
        .split("\n");
      expect(writtenData.length).toBe(1000);
      expect(writtenData[writtenData.length - 1]).toContain("prompt 1299");
    });
  });
});
