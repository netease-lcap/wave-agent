import { describe, it, expect, vi, beforeEach } from "vitest";
import { editFileTool } from "../../src/plugins/tools/editFileTool";
import type { ToolResult } from "../../src/plugins/tools/types";

// Mock fs/promises module
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

// Mock path module
vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("path")>();
  return {
    ...actual,
    resolve: vi.fn((...paths: string[]) => {
      if (paths.length === 1) {
        return paths[0];
      }
      return `${paths[0]}/${paths[1]}`.replace(/\/+/g, "/");
    }),
  };
});

// Mock aiService
vi.mock("../../src/services/aiService", () => ({
  applyEdit: vi.fn(),
}));

// Mock stringUtils
vi.mock("../../src/utils/stringUtils", () => ({
  removeCodeBlockWrappers: vi.fn((content: string) => content),
}));

// Mock logger
vi.mock("../../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
  },
}));

const mockReadFile = vi.mocked(await import("fs/promises")).readFile;
const mockWriteFile = vi.mocked(await import("fs/promises")).writeFile;
const mockApplyEdit = vi.mocked(
  (await import("../../src/services/aiService")).applyEdit,
);
const mockRemoveCodeBlockWrappers = vi.mocked(
  (await import("../../src/utils/stringUtils")).removeCodeBlockWrappers,
);

describe("editFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveCodeBlockWrappers.mockImplementation(
      (content: string) => content,
    );
    // Reset writeFile to resolve successfully by default
    mockWriteFile.mockResolvedValue(void 0);
  });

  it("should successfully edit an existing file with existing code markers", async () => {
    const existingContent = 'function test() {\n  console.log("old");\n}';
    const editedContent = 'function test() {\n  console.log("new");\n}';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      instructions: 'I am changing the console.log message from "old" to "new"',
      code_edit:
        '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });

    expect(mockReadFile).toHaveBeenCalledWith("test.js", "utf-8");
    expect(mockApplyEdit).toHaveBeenCalledWith({
      targetFile: existingContent,
      instructions: 'I am changing the console.log message from "old" to "new"',
      codeEdit:
        '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });
    expect(mockWriteFile).toHaveBeenCalledWith(
      "test.js",
      editedContent,
      "utf-8",
    );
    expect(result.success).toBe(true);
    expect(result.content).toMatch(/Modified file \(\+\d+ -\d+ lines\)/);
    expect(result.originalContent).toBe(existingContent);
    expect(result.newContent).toBe(editedContent);
    expect(result.filePath).toBe("test.js");
    expect(result.diffResult).toBeDefined();
  });

  it("should successfully create a new file", async () => {
    const newFileContent =
      'export const newFunction = () => {\n  return "hello";\n};';

    mockReadFile.mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );
    mockApplyEdit.mockResolvedValue(newFileContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: "newFile.ts",
      instructions: "I am creating a new file with a simple export function",
      code_edit: newFileContent,
    });

    expect(mockReadFile).toHaveBeenCalledWith("newFile.ts", "utf-8");
    expect(mockApplyEdit).toHaveBeenCalledWith({
      targetFile: "", // empty content for new file
      instructions: "I am creating a new file with a simple export function",
      codeEdit: newFileContent,
    });
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
      instructions: "I am completely rewriting this file",
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
        instructions: "I am adding a console.log",
        code_edit:
          '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
      },
      {
        workdir: "/project",
        flatFiles: [],
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
      instructions: "I am trying to edit the function",
      code_edit:
        '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("AI service error");
  });

  it("should validate required parameters", async () => {
    // Test missing target_file
    let result = await editFileTool.execute({
      instructions: "test",
      code_edit: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "target_file parameter is required and must be a string",
    );

    // Test missing instructions
    result = await editFileTool.execute({
      target_file: "test.js",
      code_edit: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "instructions parameter is required and must be a string",
    );

    // Test missing code_edit
    result = await editFileTool.execute({
      target_file: "test.js",
      instructions: "test",
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "code_edit parameter is required and must be a string",
    );

    // Test invalid parameter types
    result = await editFileTool.execute({
      target_file: 123,
      instructions: "test",
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
      instructions: "I am trying to edit the function",
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
      instructions: "I am trying to edit the function",
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

    const result: ToolResult = await editFileTool.execute({
      target_file: "test.js",
      instructions: "I am trying to edit the function",
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
    // Test new file creation
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockApplyEdit.mockResolvedValue("new content\nline 2");

    let result = await editFileTool.execute({
      target_file: "new.js",
      instructions: "Creating new file",
      code_edit: "new content\nline 2",
    });

    expect(result.shortResult).toMatch(/Created new file \(\d+ lines\)/);

    // Test file rewrite
    mockReadFile.mockResolvedValue("old content");
    mockRemoveCodeBlockWrappers.mockReturnValue(
      "completely new content\nline 2\nline 3",
    );

    result = await editFileTool.execute({
      target_file: "existing.js",
      instructions: "Rewriting file",
      code_edit: "completely new content\nline 2\nline 3",
    });

    expect(result.shortResult).toMatch(/Rewrote file \(\d+ lines\)/);

    // Test file modification
    mockReadFile.mockResolvedValue("existing content");
    mockApplyEdit.mockResolvedValue("modified content");

    result = await editFileTool.execute({
      target_file: "existing.js",
      instructions: "Modifying file",
      code_edit:
        "// ... existing code ...\nmodification\n// ... existing code ...",
    });

    expect(result.shortResult).toMatch(/Modified file \(\+\d+ -\d+ lines\)/);
  });
});
