import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readTool } from "@/tools/readTool.js";
import { TaskManager } from "@/services/taskManager.js";
import { readFile, stat } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

// Mock messageOperations for image conversion
vi.mock("@/utils/messageOperations.js", () => ({
  convertImageToBase64: vi.fn(),
}));

// Get mocked function
import { convertImageToBase64 } from "@/utils/messageOperations.js";

// Mock path utilities
vi.mock("@/utils/path.js", () => ({
  resolvePath: vi.fn((path: string, workdir: string) =>
    path.startsWith("/") ? path : `${workdir}/${path}`,
  ),
  getDisplayPath: vi.fn((path: string) => path),
}));

// Mock file format utilities
vi.mock("@/utils/fileFormat.js", () => ({
  isBinaryDocument: vi.fn(() => false),
  getBinaryDocumentError: vi.fn(() => "Binary document error"),
}));

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager("test-session"),
};

// Mock file contents for different test scenarios
const mockFiles: Record<string, string> = {
  "/test/workdir/small.txt": `Line 1
Line 2
Line 3
Line 4
Line 5`,
  "/test/workdir/medium.txt": Array.from(
    { length: 50 },
    (_, i) => `Line ${i + 1}`,
  ).join("\n"),
  "/test/workdir/large.txt": Array.from(
    { length: 3000 },
    (_, i) => `Line ${i + 1}`,
  ).join("\n"),
  "/test/workdir/empty.txt": "",
  "/test/workdir/long-lines.txt": `Short line
${"x".repeat(2500)}
Another short line`,
  "/test/workdir/unicode.txt": `Hello 世界
Emoji: 🚀 🌟 ✨
Multi-byte: café naïve résumé`,
  "/test/workdir/subdir/nested.txt": "Nested file content",
  "/test/workdir/mixed-endings.txt": "Line 1\r\nLine 2\nLine 3\r\n",
  "/test/workdir/test.bmp": "BMP content that should be processed as text",
  "/test/workdir/special-chars.txt": "Normal text\x00\x01\x02More text",
};

const mockReadFile = vi.mocked(readFile);

describe("readTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock behavior
    mockReadFile.mockImplementation(async (path: unknown) => {
      const pathStr = path as string;
      if (mockFiles[pathStr] !== undefined) {
        return mockFiles[pathStr];
      }
      throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be properly configured", () => {
    expect(readTool.name).toBe("Read");
    expect(readTool.config.type).toBe("function");
    if (
      readTool.config.type === "function" &&
      readTool.config.function.parameters
    ) {
      expect(readTool.config.function.name).toBe("Read");
      expect(readTool.config.function.description).toBe(
        "Read a file from the local filesystem.",
      );
      expect(readTool.config.function.parameters.required).toEqual([
        "file_path",
      ]);
    }
  });

  it("should read small file completely", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("File:");
    expect(result.content).toContain("Total lines: 5");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("     2\tLine 2");
    expect(result.content).toContain("     5\tLine 5");
    expect(result.shortResult).toBe("Read 5 lines");
  });

  it("should read file with absolute path", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 5");
  });

  it("should read file with offset", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 10,
        limit: 5,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 10-14 of 50");
    expect(result.content).toContain("    10\tLine 10");
    expect(result.content).toContain("    14\tLine 14");
    expect(result.content).not.toContain("Line 9");
    expect(result.content).not.toContain("Line 15");
  });

  it("should read file with limit", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        limit: 10,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 1-10 of 50");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("    10\tLine 10");
    expect(result.content).not.toContain("Line 11");
  });

  it("should truncate long lines", async () => {
    const filePath = "/test/workdir/long-lines.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Short line");
    expect(result.content).toContain("Another short line");
    // Long lines should be truncated and "..." added
    expect(result.content).toContain("...");
  });

  it("should handle empty file", async () => {
    const filePath = "/test/workdir/empty.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      "⚠️ System reminder: This file exists but has empty contents.",
    );
    expect(result.shortResult).toBe("Empty file");
  });

  it("should handle unicode content", async () => {
    const filePath = "/test/workdir/unicode.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Hello 世界");
    expect(result.content).toContain("🚀 🌟 ✨");
    expect(result.content).toContain("café naïve résumé");
  });

  it("should limit to 2000 lines by default for large files", async () => {
    const filePath = "/test/workdir/large.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 1-2000 of 3000");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("  2000\tLine 2000");
    expect(result.content).toContain("... 1000 more lines not shown");
    expect(result.shortResult).toBe("Read 2000 lines (truncated)");
  });

  it("should read from specific offset in large file", async () => {
    const filePath = "/test/workdir/large.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 2500,
        limit: 100,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 2500-2599 of 3000");
    expect(result.content).toContain("  2500\tLine 2500");
    expect(result.content).toContain("  2599\tLine 2599");
  });

  it("should handle relative paths", async () => {
    const result = await readTool.execute(
      {
        file_path: "small.txt",
      },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
  });

  it("should handle nested file paths", async () => {
    const filePath = "/test/workdir/subdir/nested.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Nested file content");
  });

  it("should return error for non-existent file", async () => {
    const filePath = "/test/workdir/non-existent.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read file");
  });

  it("should return error for missing file_path parameter", async () => {
    const result = await readTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("file_path parameter is required");
  });

  it("should return error for invalid file_path type", async () => {
    const result = await readTool.execute({ file_path: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "file_path parameter is required and must be a string",
    );
  });

  it("should return error for invalid offset", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 100, // Exceeds file line count
      },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Start line 100 exceeds total lines");
  });

  it("should adjust end line if it exceeds file length", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 3,
        limit: 10, // Exceeds file line count
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 3-5 of 5");
    expect(result.content).toContain("     3\tLine 3");
    expect(result.content).toContain("     5\tLine 5");
  });

  it("should format compact parameters correctly", () => {
    const params1 = { file_path: "/path/to/file.txt" };
    expect(readTool.formatCompactParams?.(params1, testContext)).toBe(
      "/path/to/file.txt",
    );

    const params2 = {
      file_path: "/path/to/file.txt",
      offset: 10,
      limit: 20,
    };
    expect(readTool.formatCompactParams?.(params2, testContext)).toBe(
      "/path/to/file.txt 10:20",
    );

    const params3 = {
      file_path: "/path/to/file.txt",
      offset: 5,
    };
    expect(readTool.formatCompactParams?.(params3, testContext)).toBe(
      "/path/to/file.txt 5:2000",
    );

    const params4 = {
      file_path: "/path/to/file.txt",
      limit: 50,
    };
    expect(readTool.formatCompactParams?.(params4, testContext)).toBe(
      "/path/to/file.txt 1:50",
    );
  });

  it("should handle files with different line endings", async () => {
    const filePath = "/test/workdir/mixed-endings.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 2");
    expect(result.content).toContain("Line 3");
  });

  it("should show proper line numbering with gaps", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 45,
        limit: 10,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("    45\tLine 45");
    expect(result.content).toContain("    50\tLine 50");
    // Ensure line number format is correctly aligned
    expect(result.content).toMatch(/\s+\d+\t/);
  });

  it("should handle binary-like content gracefully", async () => {
    const filePath = "/test/workdir/special-chars.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Normal text");
    expect(result.content).toContain("More text");
  });

  // Image processing tests
  describe("Image Processing", () => {
    beforeEach(() => {
      // Mock image file stats
      vi.mocked(stat).mockImplementation(async (path) => {
        if (typeof path === "string" && path.includes("large-image")) {
          return { size: 25 * 1024 * 1024 } as unknown as Awaited<
            ReturnType<typeof stat>
          >; // 25MB - exceeds limit
        }
        return { size: 1024 * 1024 } as unknown as Awaited<
          ReturnType<typeof stat>
        >; // 1MB - within limit
      });
    });

    it("should process PNG image files and return base64 data", async () => {
      const pngPath = "/test/workdir/test-image.png";
      const mockBase64Data =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8YBgAAAABJRU5ErkJggg==";

      vi.mocked(convertImageToBase64).mockReturnValue(
        `data:image/png;base64,${mockBase64Data}`,
      );

      const result = await readTool.execute(
        { file_path: pngPath },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Image file processed");
      expect(result.content).toContain("image/png");
      expect(result.images).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.images![0].data).toBe(mockBase64Data);
      expect(result.images![0].mediaType).toBe("image/png");
      expect(result.shortResult).toContain("Image processed");
    });

    it("should process JPEG image files and return base64 data", async () => {
      const jpegPath = "/test/workdir/test-image.jpeg";
      const mockBase64Data =
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGKAP/EABUQAQEAAAAAAAAAAAAAAAAAAAAAAf/aAAgBAQABBQJO/8QAFREBAQAAAAAAAAAAAAAAAAAAAAH/2gAIAQMBAT8B";

      vi.mocked(convertImageToBase64).mockReturnValue(
        `data:image/jpeg;base64,${mockBase64Data}`,
      );

      const result = await readTool.execute(
        { file_path: jpegPath },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Image file processed");
      expect(result.content).toContain("image/jpeg");
      expect(result.images).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.images![0].data).toBe(mockBase64Data);
      expect(result.images![0].mediaType).toBe("image/jpeg");
    });

    it("should handle image file not found error", async () => {
      const nonExistentPath = "/test/workdir/nonexistent.png";

      vi.mocked(stat).mockRejectedValue(
        new Error("ENOENT: no such file or directory"),
      );
      vi.mocked(convertImageToBase64).mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      const result = await readTool.execute(
        { file_path: nonExistentPath },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to process image");
    });

    it("should process GIF image files and return base64 data", async () => {
      const gifPath = "/test/workdir/test-image.gif";
      const mockBase64Data =
        "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

      vi.mocked(convertImageToBase64).mockReturnValue(
        `data:image/gif;base64,${mockBase64Data}`,
      );

      const result = await readTool.execute(
        { file_path: gifPath },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Image file processed");
      expect(result.content).toContain("image/gif");
      expect(result.images).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.images![0].data).toBe(mockBase64Data);
      expect(result.images![0].mediaType).toBe("image/gif");
    });

    it("should process WebP image files and return base64 data", async () => {
      const webpPath = "/test/workdir/test-image.webp";
      const mockBase64Data =
        "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

      vi.mocked(convertImageToBase64).mockReturnValue(
        `data:image/webp;base64,${mockBase64Data}`,
      );

      const result = await readTool.execute(
        { file_path: webpPath },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Image file processed");
      expect(result.content).toContain("image/webp");
      expect(result.images).toBeDefined();
      expect(result.images).toHaveLength(1);
      expect(result.images![0].data).toBe(mockBase64Data);
      expect(result.images![0].mediaType).toBe("image/webp");
    });

    it("should handle case-insensitive extension detection", async () => {
      const upperCasePath = "/test/workdir/test-image.PNG";
      const mockBase64Data =
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU8YBgAAAABJRU5ErkJggg==";

      vi.mocked(convertImageToBase64).mockReturnValue(
        `data:image/png;base64,${mockBase64Data}`,
      );

      const result = await readTool.execute(
        { file_path: upperCasePath },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("image/png");
      expect(result.images![0].mediaType).toBe("image/png");
    });

    it("should enforce 20MB file size limit", async () => {
      const largePath = "/test/workdir/large-image.png";

      // Mock a file larger than 20MB
      vi.mocked(stat).mockResolvedValue({
        size: 25 * 1024 * 1024,
      } as unknown as Awaited<ReturnType<typeof stat>>);

      const result = await readTool.execute(
        { file_path: largePath },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Image file exceeds 20MB limit");
      expect(result.error).toContain("25.00MB");
    });

    it("should handle corrupted image files gracefully", async () => {
      const corruptedPath = "/test/workdir/corrupted.png";

      vi.mocked(convertImageToBase64).mockImplementation(() => {
        throw new Error("Invalid image data");
      });

      const result = await readTool.execute(
        { file_path: corruptedPath },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to process image");
      expect(result.error).toContain("Invalid image data");
    });

    it("should handle unsupported image format gracefully", async () => {
      const unsupportedPath = "/test/workdir/test.bmp";

      // BMP files should not be processed as images (not in supported formats)
      const result = await readTool.execute(
        { file_path: unsupportedPath },
        testContext,
      );

      // Since BMP is not supported, it should fall back to text processing
      expect(result.success).toBe(true);
      // It should not contain image data
      expect(result.images).toBeUndefined();
    });

    it("should handle image processing error with non-Error object", async () => {
      const pngPath = "/test/workdir/test-image.png";
      vi.mocked(convertImageToBase64).mockImplementation(() => {
        throw "String error";
      });

      const result = await readTool.execute(
        { file_path: pngPath },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to process image: String error");
    });

    it("should handle image file size validation failure", async () => {
      const pngPath = "/test/workdir/test-image.png";
      vi.mocked(stat).mockRejectedValue(new Error("Stat failed"));

      const result = await readTool.execute(
        { file_path: pngPath },
        testContext,
      );

      // validateImageFileSize returns false on error, which triggers processImageFile error catch
      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to process image");
    });
  });

  describe("Binary Documents", () => {
    it("should return error for binary documents", async () => {
      const { isBinaryDocument } = await import("@/utils/fileFormat.js");
      vi.mocked(isBinaryDocument).mockReturnValue(true);

      const result = await readTool.execute(
        { file_path: "/test/doc.pdf" },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Binary document error");
    });
  });

  describe("Permissions", () => {
    it("should deny access if permission is denied", async () => {
      const mockPermissionManager = {
        createContext: vi.fn(),
        checkPermission: vi
          .fn()
          .mockResolvedValue({ behavior: "deny", message: "No access" }),
      };

      const result = await readTool.execute(
        { file_path: "/test/workdir/small.txt" },
        {
          ...testContext,
          permissionManager:
            mockPermissionManager as unknown as ToolContext["permissionManager"],
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("No access");
    });

    it("should allow access if permission is granted", async () => {
      const mockPermissionManager = {
        createContext: vi.fn(),
        checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
      };

      const result = await readTool.execute(
        { file_path: "/test/workdir/small.txt" },
        {
          ...testContext,
          permissionManager:
            mockPermissionManager as unknown as ToolContext["permissionManager"],
        },
      );

      expect(result.success).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large files with content truncation", async () => {
      const largeContent = "a".repeat(150 * 1024); // 150KB
      mockReadFile.mockResolvedValue(largeContent);

      const result = await readTool.execute(
        { file_path: "/test/workdir/very-large.txt" },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Content truncated at 102400 bytes");
      expect(result.content).toContain(
        "... content truncated due to size limit (102400 bytes)",
      );
    });

    it("should handle non-Error objects in catch block", async () => {
      mockReadFile.mockRejectedValue("String error");

      const result = await readTool.execute(
        { file_path: "/test/workdir/small.txt" },
        testContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to read file: String error");
    });
  });
});
