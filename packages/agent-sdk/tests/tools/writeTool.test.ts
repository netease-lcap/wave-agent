import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeTool } from "@/tools/writeTool.js";
import { TaskManager } from "@/services/taskManager.js";
import { readFile, writeFile, mkdir } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager("test-session"),
};

// Mock fs/promises
vi.mock("fs/promises");

describe("writeTool", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    mockContext = {
      abortSignal: new AbortController().signal,
      workdir: "/test/workdir",
      taskManager: new TaskManager("test-session"),
    };
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should have correct tool configuration", () => {
    expect(writeTool.name).toBe("Write");
    expect(writeTool.config.function.name).toBe("Write");
    expect(writeTool.config.function.description).toContain(
      "Writes a file to the local filesystem",
    );
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
    // No diff result since file content is the same

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
      const result = writeTool.formatCompactParams!(params, testContext);
      expect(result).toBe("/test/example.txt 3 lines, 16 chars");
    });

    it("should handle empty content", () => {
      const params = {
        file_path: "/test/empty.txt",
        content: "",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params, testContext);
      expect(result).toBe("/test/empty.txt");
    });

    it("should handle missing file_path", () => {
      const params = {
        content: "test content",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params, testContext);
      expect(result).toBe(" 1 lines, 12 chars");
    });

    it("should handle missing content", () => {
      const params = {
        file_path: "/test/file.txt",
      };

      expect(writeTool.formatCompactParams).toBeDefined();
      const result = writeTool.formatCompactParams!(params, testContext);
      expect(result).toBe("/test/file.txt");
    });
  });

  describe("Permissions", () => {
    it("should deny write if permission is denied", async () => {
      const mockPermissionManager = {
        createContext: vi.fn(),
        checkPermission: vi
          .fn()
          .mockResolvedValue({ behavior: "deny", message: "Write denied" }),
      };

      const result = await writeTool.execute(
        { file_path: "/test/file.txt", content: "test" },
        {
          ...mockContext,
          permissionManager:
            mockPermissionManager as unknown as ToolContext["permissionManager"],
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Write operation denied, reason: Write denied",
      );
    });

    it("should handle permission check failure", async () => {
      const mockPermissionManager = {
        createContext: vi.fn().mockImplementation(() => {
          throw new Error("Check failed");
        }),
      };

      const result = await writeTool.execute(
        { file_path: "/test/file.txt", content: "test" },
        {
          ...mockContext,
          permissionManager:
            mockPermissionManager as unknown as ToolContext["permissionManager"],
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission check failed");
    });
  });

  describe("Reversion", () => {
    it("should record and commit snapshot for new file", async () => {
      const mockReversionManager = {
        recordSnapshot: vi.fn().mockResolvedValue("snap-1"),
        commitSnapshot: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await writeTool.execute(
        { file_path: "/test/new.txt", content: "new content" },
        {
          ...mockContext,
          reversionManager:
            mockReversionManager as unknown as ToolContext["reversionManager"],
          messageId: "msg-1",
        },
      );

      expect(result.success).toBe(true);
      expect(mockReversionManager.recordSnapshot).toHaveBeenCalledWith(
        "msg-1",
        "/test/new.txt",
        "create",
      );
      expect(mockReversionManager.commitSnapshot).toHaveBeenCalledWith(
        "snap-1",
      );
    });

    it("should record and commit snapshot for existing file", async () => {
      const mockReversionManager = {
        recordSnapshot: vi.fn().mockResolvedValue("snap-2"),
        commitSnapshot: vi.fn().mockResolvedValue(undefined),
      };

      vi.mocked(readFile).mockResolvedValue("old content");
      vi.mocked(writeFile).mockResolvedValue(undefined);

      const result = await writeTool.execute(
        { file_path: "/test/existing.txt", content: "new content" },
        {
          ...mockContext,
          reversionManager:
            mockReversionManager as unknown as ToolContext["reversionManager"],
          messageId: "msg-2",
        },
      );

      expect(result.success).toBe(true);
      expect(mockReversionManager.recordSnapshot).toHaveBeenCalledWith(
        "msg-2",
        "/test/existing.txt",
        "modify",
      );
      expect(mockReversionManager.commitSnapshot).toHaveBeenCalledWith(
        "snap-2",
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle non-Error objects in catch block", async () => {
      vi.mocked(readFile).mockImplementation(() => {
        throw "String error";
      });

      await writeTool.execute(
        { file_path: "/test/file.txt", content: "test" },
        mockContext,
      );

      // The inner catch for readFile sets isExistingFile = false and continues
      // Then it tries to mkdir and writeFile.
      // To trigger the outer catch, we need something else to fail.
      vi.mocked(writeFile).mockImplementation(() => {
        throw "Write error";
      });

      const result2 = await writeTool.execute(
        { file_path: "/test/file.txt", content: "test" },
        mockContext,
      );

      expect(result2.success).toBe(false);
      expect(result2.error).toBe("Failed to write file: Write error");
    });

    it("should handle invalid content type", async () => {
      const result = await writeTool.execute(
        { file_path: "/test/file.txt", content: 123 },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "content parameter is required and must be a string",
      );
    });
  });
});
