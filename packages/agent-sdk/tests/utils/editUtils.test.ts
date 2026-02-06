import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdir, writeFile } from "fs/promises";
import os from "os";
import {
  saveEditErrorSnapshot,
  findIndentationInsensitiveMatch,
  escapeRegExp,
} from "../../src/utils/editUtils.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("fs/promises");
vi.mock("os");
vi.mock("path", async () => {
  const actual = (await vi.importActual("path")) as Record<string, unknown>;
  return {
    ...actual,
    join: vi.fn((...args: string[]) => args.join("/")),
    basename: vi.fn((p: string) => p.split("/").pop()),
  };
});
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe("findIndentationInsensitiveMatch", () => {
  it("should return searchString if exact match exists", () => {
    const content = "line 1\n  line 2\nline 3";
    const searchString = "  line 2";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBe(
      searchString,
    );
  });

  it("should find match with consistent indentation offset", () => {
    const content = "  line 1\n    line 2";
    const searchString = "line 1\n  line 2";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBe(
      content,
    );
  });

  it("should return null if indentation offset is inconsistent", () => {
    const content = "  line 1\n    line 2";
    const searchString = "line 1\nline 2";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBeNull();
  });

  it("should handle empty lines in search string", () => {
    const content = "  line 1\n\n    line 2";
    const searchString = "line 1\n\n  line 2";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBe(
      content,
    );
  });

  it("should return null if multiple different smart matches exist", () => {
    const content = "A\n  A";
    const searchString = "   A";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBeNull();
  });

  it("should return match if multiple identical smart matches exist", () => {
    const content = " A\n A";
    const searchString = "  A";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBe(" A");
  });

  it("should return null if trimmed content does not match", () => {
    const content = "  line 1";
    const searchString = "line 2";
    expect(findIndentationInsensitiveMatch(content, searchString)).toBeNull();
  });
});

describe("escapeRegExp", () => {
  it("should escape special characters", () => {
    const input = ".*+?^${}()|[\\]\\";
    const expected = "\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\\\\\]\\\\";
    expect(escapeRegExp(input)).toBe(expected);
  });

  it("should return same string if no special characters", () => {
    const input = "abc123";
    expect(escapeRegExp(input)).toBe(input);
  });
});

describe("saveEditErrorSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.tmpdir).mockReturnValue("/tmp");
  });

  it("should create directory and write files correctly", async () => {
    const filePath = "/path/to/file.ts";
    const oldString = "old content";
    const currentContent = "current content";
    const toolName = "editTool";

    const result = await saveEditErrorSnapshot(
      filePath,
      oldString,
      currentContent,
      toolName,
    );

    expect(mkdir).toHaveBeenCalledWith(
      expect.stringContaining("/tmp/wave-agent-edit-errors/"),
      { recursive: true },
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("old_string.txt"),
      oldString,
      "utf-8",
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("file_content.txt"),
      currentContent,
      "utf-8",
    );
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Edit error snapshot saved to:"),
    );
    expect(result).toContain("/tmp/wave-agent-edit-errors/");
  });

  it("should return null and log error if saving fails", async () => {
    vi.mocked(mkdir).mockRejectedValueOnce(new Error("Failed to create dir"));

    const result = await saveEditErrorSnapshot(
      "/path/to/file.ts",
      "old",
      "current",
      "editTool",
    );

    expect(result).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to save edit error snapshot: Error: Failed to create dir",
      ),
    );
  });
});
