import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeTool } from "@/tools/writeTool.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

describe("writeTool", () => {
  const mockContext: ToolContext = {
    abortSignal: new AbortController().signal,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should have correct tool configuration", () => {
    expect(writeTool.name).toBe("Write");
    expect(writeTool.description).toBe("Writes a file to the local filesystem");
    expect(writeTool.config.type).toBe("function");

    // Type guard to access function properties
    if (writeTool.config.type === "function") {
      expect(writeTool.config.function.name).toBe("Write");
      if (writeTool.config.function.parameters) {
        expect(writeTool.config.function.parameters.required).toEqual([
          "file_path",
          "content",
        ]);
      }
    }
  });

  it("should create new file successfully", async () => {
    const content = "console.log('Hello World');";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/newfile.js",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("File created");
    expect(result.shortResult).toBe("File created");
    expect(result.filePath).toBe("/test/newfile.js");
    expect(result.originalContent).toBe("");
    expect(result.newContent).toBe(content);
    expect(result.diffResult).toBeDefined();

    expect(mkdir).toHaveBeenCalledWith("/test", { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      "/test/newfile.js",
      content,
      "utf-8",
    );
  });

  it("should overwrite existing file successfully", async () => {
    const originalContent = "console.log('Hello');";
    const newContent = "console.log('Hello World');";

    vi.mocked(readFile).mockResolvedValue(originalContent);
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/file.js",
        content: newContent,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("File overwritten");
    expect(result.shortResult).toBe("File overwritten");
    expect(result.filePath).toBe("/test/file.js");
    expect(result.originalContent).toBe(originalContent);
    expect(result.newContent).toBe(newContent);
    expect(result.diffResult).toBeDefined();

    expect(readFile).toHaveBeenCalledWith("/test/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/test/file.js",
      newContent,
      "utf-8",
    );
  });

  it("should handle file with same content", async () => {
    const content = "console.log('Hello World');";

    vi.mocked(readFile).mockResolvedValue(content);

    const result = await writeTool.execute(
      {
        file_path: "/test/file.js",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("already has the same content");
    expect(result.shortResult).toBe("No changes needed");
    expect(result.originalContent).toBe(content);
    expect(result.newContent).toBe(content);
    expect(result.diffResult).toEqual([]);

    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when required parameters are missing", async () => {
    const result1 = await writeTool.execute(
      {
        content: "test content",
      },
      mockContext,
    );

    expect(result1.success).toBe(false);
    expect(result1.error).toContain("file_path parameter is required");

    const result2 = await writeTool.execute(
      {
        file_path: "/test/file.js",
      },
      mockContext,
    );

    expect(result2.success).toBe(false);
    expect(result2.error).toContain("content parameter is required");
  });

  it("should fail when file cannot be written", async () => {
    const content = "test content";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockRejectedValue(new Error("Permission denied"));

    const result = await writeTool.execute(
      {
        file_path: "/test/file.js",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write file: Permission denied");
  });

  it("should work with absolute file paths", async () => {
    const content = "test content";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/absolute/path/file.js",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(readFile).toHaveBeenCalledWith("/absolute/path/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/absolute/path/file.js",
      content,
      "utf-8",
    );
    expect(mkdir).toHaveBeenCalledWith("/absolute/path", { recursive: true });
  });

  it("should handle directory creation gracefully when directory exists", async () => {
    const content = "test content";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockRejectedValue(
      new Error("EEXIST: file already exists"),
    );
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/file.js",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("File created");
  });

  it("should provide detailed content information", async () => {
    const content = "line 1\nline 2\nline 3";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/file.txt",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("File created (3 lines, 20 characters)");
  });

  it("should handle empty content", async () => {
    const content = "";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/empty.txt",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("File created (1 lines, 0 characters)");
    expect(result.newContent).toBe("");
  });

  it("should handle content with special characters", async () => {
    const content = 'Special chars: €, 中文, 🎉, \n\t"quotes"';

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(mkdir).mockResolvedValue(undefined);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await writeTool.execute(
      {
        file_path: "/test/special.txt",
        content: content,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.newContent).toBe(content);
    expect(writeFile).toHaveBeenCalledWith(
      "/test/special.txt",
      content,
      "utf-8",
    );
  });

  describe("formatCompactParams", () => {
    it("should format parameters correctly", () => {
      const params = {
        file_path: "/test/example.txt",
        content: "Hello\nWorld\nTest",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params);
      expect(result).toBe("/test/example.txt 3 lines, 16 chars");
    });

    it("should handle empty content", () => {
      const params = {
        file_path: "/test/empty.txt",
        content: "",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params);
      expect(result).toBe("/test/empty.txt");
    });

    it("should handle missing file_path", () => {
      const params = {
        content: "test content",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params);
      expect(result).toBe(" 1 lines, 12 chars");
    });

    it("should handle missing content", () => {
      const params = {
        file_path: "/test/file.txt",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params);
      expect(result).toBe("/test/file.txt");
    });
  });
});
