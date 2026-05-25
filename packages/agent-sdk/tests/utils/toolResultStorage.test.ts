import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock os
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  };
});

// Mock logger
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getToolResultsDir,
  persistToolResult,
  generatePreview,
  buildPersistedOutputMessage,
  processToolResult,
} from "../../src/utils/toolResultStorage.js";
import {
  PREVIEW_SIZE_BYTES,
  DEFAULT_MAX_RESULT_SIZE_CHARS,
} from "../../src/constants/toolLimits.js";

describe("toolResultStorage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("generatePreview", () => {
    it("should return content unchanged when under preview size", () => {
      const content = "short content";
      expect(generatePreview(content)).toBe(content);
    });

    it("should return content unchanged when exactly at preview size", () => {
      const content = "a".repeat(PREVIEW_SIZE_BYTES);
      expect(generatePreview(content)).toBe(content);
    });

    it("should truncate and append ellipsis when over preview size", () => {
      const content = "a".repeat(PREVIEW_SIZE_BYTES + 100);
      const result = generatePreview(content);
      expect(result).toBe("a".repeat(PREVIEW_SIZE_BYTES) + "\n...");
      expect(result.length).toBe(PREVIEW_SIZE_BYTES + 4); // +4 for "\n..."
    });

    it("should use custom preview size", () => {
      const content = "a".repeat(200);
      const result = generatePreview(content, 50);
      expect(result).toBe("a".repeat(50) + "\n...");
    });
  });

  describe("buildPersistedOutputMessage", () => {
    it("should wrap content in persisted-output XML tags with char count, file path, and preview", () => {
      const result = buildPersistedOutputMessage(
        150000,
        "/tmp/wave-tool-results/tool_123.txt",
        "preview text",
      );

      expect(result).toBe(
        "<persisted-output>\n" +
          "Output too large (150,000 characters). Full output saved to: /tmp/wave-tool-results/tool_123.txt\n" +
          "Preview (first 2,048 characters):\n" +
          "preview text\n" +
          "</persisted-output>",
      );
    });

    it("should format char count with locale-specific grouping", () => {
      const result = buildPersistedOutputMessage(
        50000,
        "/tmp/wave-tool-results/bash_456.txt",
        "data",
      );
      expect(result).toContain("50,000 characters");
    });

    it("should include preview size in the header", () => {
      const result = buildPersistedOutputMessage(100, "/path", "x");
      expect(result).toContain(
        `first ${PREVIEW_SIZE_BYTES.toLocaleString()} characters`,
      );
    });
  });

  describe("getToolResultsDir", () => {
    it("should create directory with mkdirSync recursive", () => {
      const dir = getToolResultsDir();
      expect(dir).toBe("/tmp/wave-tool-results");
      expect(fs.mkdirSync).toHaveBeenCalledWith("/tmp/wave-tool-results", {
        recursive: true,
      });
    });

    it("should use os.tmpdir() as base path", () => {
      const dir = getToolResultsDir();
      expect(dir.startsWith("/tmp/")).toBe(true);
      expect(dir).toContain("wave-tool-results");
    });
  });

  describe("persistToolResult", () => {
    it("should write content to a file and return the path", () => {
      const content = "test output";
      const result = persistToolResult(content, "bash");

      expect(result).toMatch(
        /\/tmp\/wave-tool-results\/bash_\d+_[a-z0-9]+\.txt$/,
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/wave-tool-results/bash_"),
        content,
        "utf8",
      );
    });

    it("should use default prefix 'tool' when none provided", () => {
      const result = persistToolResult("content");
      expect(result).toMatch(
        /\/tmp\/wave-tool-results\/tool_\d+_[a-z0-9]+\.txt$/,
      );
    });

    it("should return undefined on write failure", () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("disk full");
      });

      const result = persistToolResult("content", "bash");
      expect(result).toBeUndefined();
    });

    it("should return undefined when mkdirSync fails", () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => {
        throw new Error("permission denied");
      });

      const result = persistToolResult("content", "bash");
      expect(result).toBeUndefined();
    });
  });

  describe("processToolResult", () => {
    it("should return content unchanged when under maxChars", () => {
      const content = "small result";
      expect(processToolResult(content, 1000)).toBe(content);
    });

    it("should return content unchanged when exactly at maxChars", () => {
      const content = "a".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS);
      expect(processToolResult(content)).toBe(content);
    });

    it("should persist and return wrapper when content exceeds maxChars", () => {
      const content = "x".repeat(100);
      const result = processToolResult(content, 50, "bash");

      expect(result).toContain("<persisted-output>");
      expect(result).toContain("100 characters");
      expect(result).toContain("/tmp/wave-tool-results/bash_");
      expect(result).toContain("</persisted-output>");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("bash_"),
        content,
        "utf8",
      );
    });

    it("should use default maxChars when not specified", () => {
      const content = "a".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 1);
      const result = processToolResult(content);

      expect(result).toContain("<persisted-output>");
      expect(result).toContain(
        `${(DEFAULT_MAX_RESULT_SIZE_CHARS + 1).toLocaleString()} characters`,
      );
    });

    it("should include preview in the wrapper", () => {
      const content = "a".repeat(100);
      const result = processToolResult(content, 50, "tool");

      // Preview should be first PREVIEW_SIZE_BYTES chars + "\n..."
      // But since content is only 100 chars and PREVIEW_SIZE_BYTES is 2048,
      // the preview will be the full content (under preview size)
      expect(result).toContain(content);
    });

    it("should fall back to truncation when persistence fails", () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("write failed");
      });

      const content = "a".repeat(100);
      const result = processToolResult(content, 50, "bash");

      expect(result).toContain("a".repeat(50));
      expect(result).toContain(
        "... (output truncated, failed to persist full output)",
      );
      expect(result).not.toContain("<persisted-output>");
    });

    it("should use default prefix 'tool' when none provided", () => {
      const content = "a".repeat(100);
      processToolResult(content, 50);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("/tmp/wave-tool-results/tool_"),
        content,
        "utf8",
      );
    });
  });
});
