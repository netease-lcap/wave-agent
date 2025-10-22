import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteFileTool } from "@/tools/deleteFileTool.js";
import type { ToolResult, ToolContext } from "@/tools/types.js";

const testContext: ToolContext = { workdir: "/test/workdir" };

// Mock fs/promises module
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    unlink: vi.fn(),
  };
});

// Mock path module
vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("path")>();
  return {
    ...actual,
    resolve: vi.fn((...paths: string[]) => {
      if (paths.length === 1) return paths[0];
      return paths.join("/").replace(/\/+/g, "/");
    }),
  };
});

const mockUnlink = vi.mocked(await import("fs/promises")).unlink;

describe("deleteFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should successfully delete an existing file", async () => {
    mockUnlink.mockResolvedValue();

    const result: ToolResult = await deleteFileTool.execute(
      {
        target_file: "test.js",
      },
      testContext,
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringMatching(/.*test\.js$/),
    );
    expect(result.success).toBe(true);
    expect(result.content).toBe("Successfully deleted file: test.js");
  });

  it("should handle file not found error gracefully", async () => {
    const notFoundError = new Error(
      "ENOENT: no such file or directory",
    ) as NodeJS.ErrnoException;
    notFoundError.code = "ENOENT";

    mockUnlink.mockRejectedValue(notFoundError);

    const result: ToolResult = await deleteFileTool.execute(
      {
        target_file: "nonexistent.js",
      },
      testContext,
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringMatching(/.*nonexistent\.js$/),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("File does not exist: nonexistent.js");
  });

  it("should handle permission denied errors", async () => {
    const permissionError = new Error(
      "Permission denied",
    ) as NodeJS.ErrnoException;
    permissionError.code = "EACCES";

    mockUnlink.mockRejectedValue(permissionError);

    const result: ToolResult = await deleteFileTool.execute(
      {
        target_file: "protected.js",
      },
      testContext,
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringMatching(/.*protected\.js$/),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("should validate required parameters", async () => {
    // Test missing target_file
    const result = await deleteFileTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "target_file parameter is required and must be a string",
    );
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("should handle invalid target_file types", async () => {
    // Test non-string target_file
    const result = await deleteFileTool.execute(
      {
        target_file: 123 as unknown as string,
      },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "target_file parameter is required and must be a string",
    );
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it("should work with relative paths in context", async () => {
    mockUnlink.mockResolvedValue();

    // Store original resolve function
    const mockResolve = vi.mocked(await import("path")).resolve;
    const originalResolve = mockResolve.getMockImplementation();

    // Mock path.resolve to simulate different working directory for this test only
    mockResolve.mockImplementation((...paths: string[]) => {
      if (paths.length === 1 && !paths[0].startsWith("/")) {
        return `/project/root/${paths[0]}`;
      }
      return paths.join("/").replace(/\/+/g, "/");
    });

    try {
      const result: ToolResult = await deleteFileTool.execute(
        {
          target_file: "src/test.js",
        },
        testContext,
      );

      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringMatching(/.*src\/test\.js$/),
      );
      expect(result.success).toBe(true);
      expect(result.content).toBe("Successfully deleted file: src/test.js");
    } finally {
      // Restore original mock
      if (originalResolve) {
        mockResolve.mockImplementation(originalResolve);
      } else {
        mockResolve.mockImplementation((...paths: string[]) => {
          if (paths.length === 1) return paths[0];
          return paths.join("/").replace(/\/+/g, "/");
        });
      }
    }
  });

  it("should handle other filesystem errors", async () => {
    const unknownError = new Error("Disk full") as NodeJS.ErrnoException;
    unknownError.code = "ENOSPC";

    mockUnlink.mockRejectedValue(unknownError);

    const result: ToolResult = await deleteFileTool.execute(
      {
        target_file: "test.js",
      },
      testContext,
    );

    expect(mockUnlink).toHaveBeenCalledWith(
      expect.stringMatching(/.*test\.js$/),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Disk full");
  });
});
