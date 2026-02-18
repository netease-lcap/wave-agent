import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { editTool } from "@/tools/editTool.js";
import { TaskManager } from "@/services/taskManager.js";
import { readFile, writeFile } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises");
vi.mock("../../src/utils/editUtils.js", () => ({
  escapeRegExp: vi.fn((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  analyzeEditMismatch: vi.fn(() => "old_string not found in file"),
}));

describe("editTool", () => {
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
    expect(editTool.name).toBe("Edit");
    expect(editTool.config.function.name).toBe("Edit");
    expect(editTool.config.function.description).toBe(
      "A tool for editing files",
    );
    expect(editTool.config.type).toBe("function");

    // Type guard to access function properties
    if (editTool.config.type === "function") {
      expect(editTool.config.function.name).toBe("Edit");
      if (editTool.config.function.parameters) {
        expect(editTool.config.function.parameters.required).toEqual([
          "file_path",
          "old_string",
          "new_string",
        ]);
      }
    }
  });

  it("should successfully replace unique string in file", async () => {
    const mockContent = "function hello() {\n  console.log('Hello');\n}";
    const expectedContent =
      "function hello() {\n  console.log('Hello World');\n}";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "console.log('Hello');",
        new_string: "console.log('Hello World');",
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Text replaced successfully");
    expect(result.filePath).toBe("/test/file.js");

    expect(readFile).toHaveBeenCalledWith("/test/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/test/file.js",
      expectedContent,
      "utf-8",
    );
  });

  it("should replace all occurrences when replace_all is true", async () => {
    const mockContent = "var x = 1;\nvar y = 2;\nvar z = 3;";
    const expectedContent = "let x = 1;\nlet y = 2;\nlet z = 3;";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "var",
        new_string: "let",
        replace_all: true,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Replaced 3 instances");

    expect(writeFile).toHaveBeenCalledWith(
      "/test/file.js",
      expectedContent,
      "utf-8",
    );
  });

  it("should fail when old_string is not unique and replace_all is false", async () => {
    const mockContent = "var x = 1;\nvar y = 2;\nvar z = 3;";

    vi.mocked(readFile).mockResolvedValue(mockContent);

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "var",
        new_string: "let",
        replace_all: false,
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("appears 3 times in the file");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when old_string is not found", async () => {
    const mockContent = "function hello() {\n  console.log('Hello');\n}";

    vi.mocked(readFile).mockResolvedValue(mockContent);

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "nonexistent text",
        new_string: "replacement",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("old_string not found in file");
  });

  it("should fail when file cannot be read", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

    const result = await editTool.execute(
      {
        file_path: "/test/nonexistent.js",
        old_string: "old",
        new_string: "new",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read file: File not found");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when file cannot be written", async () => {
    const mockContent = "function hello() {}";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockRejectedValue(new Error("Permission denied"));

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "hello",
        new_string: "world",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write file: Permission denied");
  });

  it("should fail when required parameters are missing", async () => {
    const result1 = await editTool.execute(
      {
        old_string: "old",
        new_string: "new",
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result1.success).toBe(false);
    expect(result1.error).toContain("file_path parameter is required");

    const result2 = await editTool.execute(
      {
        file_path: 123,
        old_string: "old",
        new_string: "new",
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result2.success).toBe(false);
    expect(result2.error).toContain("file_path parameter is required");

    const result3 = await editTool.execute(
      {
        file_path: "/test/file.js",
        new_string: "new",
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result3.success).toBe(false);
    expect(result3.error).toContain("old_string parameter is required");

    const result4 = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: 123,
        new_string: "new",
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result4.success).toBe(false);
    expect(result4.error).toContain("old_string parameter is required");

    const result5 = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "old",
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result5.success).toBe(false);
    expect(result5.error).toContain("new_string parameter is required");

    const result6 = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "old",
        new_string: 123,
      } as unknown as Parameters<typeof editTool.execute>[0],
      mockContext,
    );

    expect(result6.success).toBe(false);
    expect(result6.error).toContain("new_string parameter is required");
  });

  it("should fail when old_string and new_string are the same", async () => {
    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "same",
        new_string: "same",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "old_string and new_string must be different",
    );
  });

  it("should handle special regex characters in old_string", async () => {
    const mockContent = "function test() { return /^[a-z]+$/; }";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "/^[a-z]+$/",
        new_string: "/^[a-zA-Z]+$/",
        replace_all: true,
      },
      mockContext,
    );

    expect(result.success).toBe(true);
  });

  it("should work with absolute file paths", async () => {
    const mockContent = "test content";
    const expectedContent = "new content";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await editTool.execute(
      {
        file_path: "/absolute/path/file.js",
        old_string: "test",
        new_string: "new",
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    // Should preserve absolute path
    expect(readFile).toHaveBeenCalledWith("/absolute/path/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/absolute/path/file.js",
      expectedContent,
      "utf-8",
    );
  });

  it("should handle permission denial", async () => {
    const mockContent = "some content";
    vi.mocked(readFile).mockResolvedValue(mockContent);

    const mockPermissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.fn().mockResolvedValue({
        behavior: "deny",
        message: "User denied",
      }),
    };

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "some",
        new_string: "other",
      },
      {
        ...mockContext,
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "Edit operation denied, reason: User denied",
    );
  });

  it("should handle permission check failure", async () => {
    const mockContent = "some content";
    vi.mocked(readFile).mockResolvedValue(mockContent);

    const mockPermissionManager = {
      createContext: vi.fn().mockReturnValue({}),
      checkPermission: vi.fn().mockRejectedValue(new Error("Check failed")),
    };

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "some",
        new_string: "other",
      },
      {
        ...mockContext,
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission check failed");
  });

  it("should record and commit snapshot when reversionManager is present", async () => {
    const mockContent = "some content";
    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const mockReversionManager = {
      recordSnapshot: vi.fn().mockResolvedValue("snapshot-123"),
      commitSnapshot: vi.fn().mockResolvedValue(undefined),
    };

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "some",
        new_string: "other",
      },
      {
        ...mockContext,
        reversionManager:
          mockReversionManager as unknown as ToolContext["reversionManager"],
        messageId: "msg-123",
      },
    );

    expect(result.success).toBe(true);
    expect(mockReversionManager.recordSnapshot).toHaveBeenCalledWith(
      "msg-123",
      "/test/file.js",
      "modify",
    );
    expect(mockReversionManager.commitSnapshot).toHaveBeenCalledWith(
      "snapshot-123",
    );
  });

  it("should handle generic errors in execute", async () => {
    vi.mocked(readFile).mockImplementation(() => {
      throw new Error("Generic error");
    });

    const result = await editTool.execute(
      {
        file_path: "/test/file.js",
        old_string: "old",
        new_string: "new",
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Generic error");
  });

  it("should format compact params correctly", () => {
    const formatCompactParams = (
      editTool as unknown as {
        formatCompactParams: (
          params: { file_path: string },
          context: { workdir: string },
        ) => string;
      }
    ).formatCompactParams;
    const result = formatCompactParams(
      { file_path: "src/index.ts" },
      { workdir: "/test" },
    );
    expect(result).toBe("src/index.ts");
  });
});
