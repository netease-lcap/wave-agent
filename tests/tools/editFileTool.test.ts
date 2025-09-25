import { describe, it, expect, vi, beforeEach } from "vitest";
import { editFileTool } from "@/tools/editFileTool";
import type { ToolResult } from "@/tools/types";

// Mock file system operations
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock path operations
vi.mock("path", () => ({
  resolve: vi.fn(),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock AI service
vi.mock("@/services/aiService", () => ({
  applyEdit: vi.fn(),
}));

// Mock string utils
vi.mock("@/utils/stringUtils", () => ({
  removeCodeBlockWrappers: vi.fn(),
}));

const mockReadFile = vi.mocked((await import("fs/promises")).readFile);
const mockWriteFile = vi.mocked((await import("fs/promises")).writeFile);
const mockResolve = vi.mocked((await import("path")).resolve);
const mockApplyEdit = vi.mocked(
  (await import("@/services/aiService")).applyEdit,
);
const mockRemoveCodeBlockWrappers = vi.mocked(
  (await import("@/utils/stringUtils")).removeCodeBlockWrappers,
);

describe("editFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockImplementation((...paths) => paths.join("/"));
    mockRemoveCodeBlockWrappers.mockImplementation((content) => content);
  });

  it("should successfully edit an existing file with existing code markers", async () => {
    const existingContent = 'console.log("old");';
    const editedContent = 'console.log("new");';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });

    expect(mockReadFile).toHaveBeenCalledWith("test.js", "utf-8");
    expect(mockApplyEdit).toHaveBeenCalledWith({
      targetFile: existingContent,
      codeEdit:
        '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "test.js",
      editedContent,
      "utf-8",
    );
    expect(result.success).toBe(true);
    expect(result.content).toBe('-console.log("old");\n+console.log("new");');
    expect(result.originalContent).toBe(existingContent);
    expect(result.newContent).toBe(editedContent);
    expect(result.filePath).toBe("test.js");
    expect(result.diffResult).toBeDefined();
    expect(result.shortResult).toMatch(/Modified file \(\+\d+ -\d+ lines\)/);
  });

  it("should include diff output when existing code markers are used", async () => {
    const existingContent = 'const value = "old";\nconsole.log(value);\n';
    const editedContent = 'const value = "new";\nconsole.log(value);\n';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconst value = "new";\nconsole.log(value);\n// ... existing code ...',
    });

    expect(result.content).toBe(
      '-const value = "old";\n+const value = "new";\n console.log(value);',
    );
  });

  it("should successfully create a new file", async () => {
    const newFileContent =
      'export const newFunction = () => {\n  return "hello";\n};';

    mockReadFile.mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );
    mockRemoveCodeBlockWrappers.mockReturnValue(newFileContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "newFile.ts",
      code_edit: newFileContent,
    });

    expect(mockReadFile).toHaveBeenCalledWith("newFile.ts", "utf-8");
    // For new files without existing code markers, applyEdit should NOT be called
    expect(mockApplyEdit).not.toHaveBeenCalled();
    expect(mockRemoveCodeBlockWrappers).toHaveBeenCalledWith(newFileContent);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "newFile.ts",
      newFileContent,
      "utf-8",
    );
    expect(result.success).toBe(true);
    expect(result.content).toMatch(/Created new file \(\d+ lines\)/);
    expect(result.originalContent).toBe("");
    expect(result.newContent).toBe(newFileContent);
    expect(result.filePath).toBe("newFile.ts");
  });

  it("should rewrite an existing file without existing code markers", async () => {
    const existingContent = 'function oldFunction() {\n  return "old";\n}';
    const newContent = 'function newFunction() {\n  return "new";\n}';

    mockReadFile.mockResolvedValue(existingContent);
    mockRemoveCodeBlockWrappers.mockReturnValue(newContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit: newContent,
    });

    expect(mockReadFile).toHaveBeenCalledWith("test.js", "utf-8");
    expect(mockApplyEdit).not.toHaveBeenCalled(); // Should not call AI service for rewrite
    expect(mockWriteFile).toHaveBeenCalledWith("test.js", newContent, "utf-8");
    expect(result.success).toBe(true);
    expect(result.content).toMatch(/Rewrote file \(\d+ lines\)/);
    expect(result.originalContent).toBe(existingContent);
    expect(result.newContent).toBe(newContent);
    expect(result.filePath).toBe("test.js");
  });

  it("should handle workdir context correctly", async () => {
    const existingContent = "function test() {}";
    const editedContent = 'function test() { console.log("test"); }';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);

    const result: ToolResult = await editFileTool.execute(
      {
        target_file: "src/test.js",
        code_edit:
          '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
      },
      {
        workdir: "/project",
      },
    );

    expect(mockReadFile).toHaveBeenCalledWith("/project/src/test.js", "utf-8");
    expect(mockWriteFile).toHaveBeenCalledWith(
      "/project/src/test.js",
      editedContent,
      "utf-8",
    );
    expect(result.success).toBe(true);
    expect(result.filePath).toBe("src/test.js"); // Should preserve original relative path
  });

  it("should handle AI service error", async () => {
    const existingContent = "function test() {}";

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockRejectedValue(new Error("AI service error"));

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("AI service error");
  });

  it("should validate required parameters", async () => {
    // Test missing target_file
    let result = await editFileTool.execute({
      code_edit: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "target_file parameter is required and must be a string",
    );

    // Test missing code_edit
    result = await editFileTool.execute({
      target_file: "test.js",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "code_edit parameter is required and must be a string",
    );

    // Test invalid parameter types
    result = await editFileTool.execute({
      target_file: 123,
      code_edit: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "target_file parameter is required and must be a string",
    );
  });

  it("should handle AI service network errors", async () => {
    const existingContent = "function test() {}";

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockRejectedValue(
      new Error("Failed to apply edit via AI service: Network error"),
    );

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Failed to apply edit via AI service: Network error",
    );
  });

  it("should handle file write errors", async () => {
    const existingContent = "function test() {}";
    const editedContent = 'function test() { console.log("test"); }';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);
    mockWriteFile.mockRejectedValue(new Error("Permission denied"));

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission denied");
  });

  it("should handle code block wrapper removal", async () => {
    const existingContent = "function test() {}";
    const rawEditedContent =
      '```javascript\nfunction test() { console.log("test"); }\n```';
    const cleanEditedContent = 'function test() { console.log("test"); }';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(rawEditedContent);
    mockRemoveCodeBlockWrappers.mockReturnValue(cleanEditedContent);
    mockWriteFile.mockResolvedValue(undefined); // Ensure write succeeds

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      code_edit:
        '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(mockRemoveCodeBlockWrappers).toHaveBeenCalledWith(rawEditedContent);
    expect(mockWriteFile).toHaveBeenCalledWith(
      "test.js",
      cleanEditedContent,
      "utf-8",
    );
    expect(result.success).toBe(true);
    expect(result.newContent).toBe(cleanEditedContent);
  });

  it("should provide proper shortResult for different operations", async () => {
    // Clear all mocks before starting this test
    vi.clearAllMocks();
    mockResolve.mockImplementation((...paths) => paths.join("/"));
    mockRemoveCodeBlockWrappers.mockImplementation((content) => content);

    // Test new file creation
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockApplyEdit.mockResolvedValue("new content\nline 2");
    mockWriteFile.mockResolvedValue(undefined);

    let result = await editFileTool.execute({
      target_file: "new.js",
      code_edit: "new content\nline 2",
    });

    expect(result.shortResult).toMatch(/Created new file \(\d+ lines\)/);

    // Test file rewrite
    mockReadFile.mockResolvedValue("old content");
    mockRemoveCodeBlockWrappers.mockReturnValue("new content\nline 2");
    mockWriteFile.mockResolvedValue(undefined);

    result = await editFileTool.execute({
      target_file: "existing.js",
      code_edit: "new content\nline 2", // No existing code markers
    });

    expect(result.shortResult).toMatch(/Rewrote file \(\d+ lines\)/);

    // Test file modification
    mockReadFile.mockResolvedValue("old content");
    mockApplyEdit.mockResolvedValue("modified content");
    mockWriteFile.mockResolvedValue(undefined);

    result = await editFileTool.execute({
      target_file: "existing.js",
      code_edit: "// ... existing code ...\nmodified content",
    });

    expect(result.shortResult).toMatch(/Modified file \(\+\d+ -\d+ lines\)/);
  });

  describe("formatCompactParams", () => {
    it("should format parameters correctly", () => {
      const params = {
        target_file: "test.js",
      };

      const result = editFileTool.formatCompactParams?.(params);
      expect(result).toBe("test.js");
    });

    it("should handle empty target_file", () => {
      const params = {};

      const result = editFileTool.formatCompactParams?.(params);
      expect(result).toBe("");
    });
  });
});
