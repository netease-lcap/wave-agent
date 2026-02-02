import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";
import { PromptHistoryManager } from "../../src/utils/promptHistory.js";

vi.mock("fs");
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

      await PromptHistoryManager.addEntry("hello world");

      expect(appendFileSpy).toHaveBeenCalledWith(
        "/mock/path/history.jsonl",
        expect.stringContaining('"prompt":"hello world"'),
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

    it("should return parsed entries in reverse order", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const mockData =
        JSON.stringify({ prompt: "first", timestamp: 1000 }) +
        "\n" +
        JSON.stringify({ prompt: "second", timestamp: 2000 }) +
        "\n";

      vi.spyOn(fs.promises, "readFile").mockResolvedValue(mockData);

      const history = await PromptHistoryManager.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].prompt).toBe("second");
      expect(history[1].prompt).toBe("first");
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
});
