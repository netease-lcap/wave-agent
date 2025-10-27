import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { multiEditTool } from "@/tools/multiEditTool.js";
import { readFile, writeFile } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe("multiEditTool", () => {
  const mockContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should have correct tool configuration", () => {
    expect(multiEditTool.name).toBe("MultiEdit");
    expect(multiEditTool.config.function.name).toBe("MultiEdit");
    expect(multiEditTool.config.function.description).toContain(
      "multiple edits to a single file",
    );
    expect(multiEditTool.config.type).toBe("function");

    // Type guard to access function properties
    if (multiEditTool.config.type === "function") {
      expect(multiEditTool.config.function.name).toBe("MultiEdit");
      if (multiEditTool.config.function.parameters) {
        expect(multiEditTool.config.function.parameters.required).toEqual([
          "file_path",
          "edits",
        ]);
      }
    }
  });

  it("should apply multiple edits sequentially", async () => {
    const mockContent =
      "function hello() {\n  console.log('Hello');\n  var x = 1;\n}";
    const expectedContent =
      "function hello() {\n  console.log('Hello World');\n  let x = 1;\n}";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [
          {
            old_string: "console.log('Hello');",
            new_string: "console.log('Hello World');",
          },
          {
            old_string: "var x",
            new_string: "let x",
          },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Applied 2 edits");
    expect(result.filePath).toBe("/test/file.js");
    expect(result.originalContent).toBe(mockContent);
    expect(result.newContent).toBe(expectedContent);
    expect(result.diffResult).toBeDefined();

    expect(readFile).toHaveBeenCalledWith("/test/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/test/file.js",
      expectedContent,
      "utf-8",
    );
  });

  it("should create new file when first edit has empty old_string", async () => {
    const content = "console.log('Hello World');";

    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/newfile.js",
        edits: [
          {
            old_string: "",
            new_string: content,
          },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Created file with");
    expect(result.originalContent).toBe("");
    expect(result.newContent).toBe(content);

    expect(writeFile).toHaveBeenCalledWith(
      "/test/newfile.js",
      content,
      "utf-8",
    );
  });

  it("should handle replace_all option in individual edits", async () => {
    const mockContent = "var x = 1;\nvar y = 2;\nlet z = 3;";
    const expectedContent = "let x = 1;\nlet y = 2;\nconst z = 3;";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [
          {
            old_string: "var",
            new_string: "let",
            replace_all: true,
          },
          {
            old_string: "let z",
            new_string: "const z",
          },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Applied 2 edits");
    expect(result.newContent).toBe(expectedContent);
  });

  it("should fail if any edit operation fails", async () => {
    const mockContent = "function hello() {\n  console.log('Hello');\n}";

    vi.mocked(readFile).mockResolvedValue(mockContent);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [
          {
            old_string: "console.log('Hello');",
            new_string: "console.log('Hello World');",
          },
          {
            old_string: "nonexistent",
            new_string: "replacement",
          },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Edit operation 2: old_string not found");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when edit makes old_string non-unique for later edits", async () => {
    const mockContent = "var x = 1;\nlet y = 2;";

    vi.mocked(readFile).mockResolvedValue(mockContent);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [
          {
            old_string: "var x = 1;",
            new_string: "let x = 1;\nlet a = 3;", // This will create two "let"
          },
          {
            old_string: "let",
            new_string: "const",
            replace_all: false, // Requires unique match, but now there are multiple "let"
          },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("appears 3 times in the current content");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when required parameters are missing", async () => {
    const result1 = await multiEditTool.execute(
      {
        edits: [{ old_string: "old", new_string: "new" }],
      },
      mockContext,
    );

    expect(result1.success).toBe(false);
    expect(result1.error).toContain("file_path parameter is required");

    const result2 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
      },
      mockContext,
    );

    expect(result2.success).toBe(false);
    expect(result2.error).toContain("edits parameter is required");

    const result3 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [],
      },
      mockContext,
    );

    expect(result3.success).toBe(false);
    expect(result3.error).toContain(
      "edits parameter is required and must be a non-empty array",
    );
  });

  it("should fail when edit operations are invalid", async () => {
    const result1 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [null],
      },
      mockContext,
    );

    expect(result1.success).toBe(false);
    expect(result1.error).toContain("Edit operation 1 must be an object");

    const result2 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [{ new_string: "new" }],
      },
      mockContext,
    );

    expect(result2.success).toBe(false);
    expect(result2.error).toContain("Edit operation 1: old_string is required");

    const result3 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [{ old_string: "old" }],
      },
      mockContext,
    );

    expect(result3.success).toBe(false);
    expect(result3.error).toContain("Edit operation 1: new_string is required");

    const result4 = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [{ old_string: "same", new_string: "same" }],
      },
      mockContext,
    );

    expect(result4.success).toBe(false);
    expect(result4.error).toContain(
      "Edit operation 1: old_string and new_string must be different",
    );
  });

  it("should fail when file cannot be read and is not a new file creation", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("Permission denied"));

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [{ old_string: "old", new_string: "new" }],
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read file: Permission denied");
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("should fail when file cannot be written", async () => {
    const mockContent = "function hello() {}";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockRejectedValue(new Error("Permission denied"));

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [{ old_string: "hello", new_string: "world" }],
      },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to write file: Permission denied");
  });

  it("should work with absolute file paths", async () => {
    const mockContent = "test content";
    const expectedContent = "new content";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await multiEditTool.execute(
      {
        file_path: "/absolute/path/file.js",
        edits: [{ old_string: "test", new_string: "new" }],
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(readFile).toHaveBeenCalledWith("/absolute/path/file.js", "utf-8");
    expect(writeFile).toHaveBeenCalledWith(
      "/absolute/path/file.js",
      expectedContent,
      "utf-8",
    );
  });

  it("should provide detailed operation information", async () => {
    const mockContent = "var x = 1;\nvar y = 2;";
    const expectedContent = "let x = 1;\nconst y = 2;";

    vi.mocked(readFile).mockResolvedValue(mockContent);
    vi.mocked(writeFile).mockResolvedValue(undefined);

    const result = await multiEditTool.execute(
      {
        file_path: "/test/file.js",
        edits: [
          { old_string: "var x", new_string: "let x" },
          { old_string: "var y", new_string: "const y" },
        ],
      },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Applied 2 edits");
    expect(result.content).toContain("Operations performed:");
    expect(result.content).toContain('1. Replaced "var x"');
    expect(result.content).toContain('2. Replaced "var y"');
    expect(result.newContent).toBe(expectedContent);
  });
});
