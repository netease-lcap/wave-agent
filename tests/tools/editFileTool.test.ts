import { describe, it, expect, vi, beforeEach } from 'vitest';
import { editFileTool } from '../../src/plugins/tools/editFileTool';
import type { ToolResult } from '../../src/plugins/tools/types';

// Mock fs/promises module
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
  };
});

// Mock path module
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    resolve: vi.fn((path: string) => path),
  };
});

// Mock aiService
vi.mock('../../src/services/aiService', () => ({
  applyEdit: vi.fn(),
}));

const mockReadFile = vi.mocked(await import('fs/promises')).readFile;
const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;
const mockApplyEdit = vi.mocked((await import('../../src/services/aiService')).applyEdit);

describe('editFileTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully edit an existing file', async () => {
    const existingContent = 'function test() {\n  console.log("old");\n}';
    const editedContent = 'function test() {\n  console.log("new");\n}';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: 'test.js',
      instructions: 'I am changing the console.log message from "old" to "new"',
      code_edit: '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });

    expect(mockReadFile).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(mockApplyEdit).toHaveBeenCalledWith({
      targetFile: existingContent,
      instructions: 'I am changing the console.log message from "old" to "new"',
      codeEdit: '// ... existing code ...\nconsole.log("new");\n// ... existing code ...',
    });
    expect(mockWriteFile).toHaveBeenCalledWith('test.js', editedContent, 'utf-8');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Successfully applied edit to test.js');
  });

  it('should successfully create a new file', async () => {
    const newFileContent = 'export const newFunction = () => {\n  return "hello";\n};';

    mockReadFile.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    mockApplyEdit.mockResolvedValue(newFileContent);

    const result: ToolResult = await editFileTool.execute({
      target_file: 'newFile.ts',
      instructions: 'I am creating a new file with a simple export function',
      code_edit: newFileContent,
    });

    expect(mockReadFile).toHaveBeenCalledWith('newFile.ts', 'utf-8');
    expect(mockApplyEdit).toHaveBeenCalledWith({
      targetFile: '', // empty content for new file
      instructions: 'I am creating a new file with a simple export function',
      codeEdit: newFileContent,
    });
    expect(mockWriteFile).toHaveBeenCalledWith('newFile.ts', newFileContent, 'utf-8');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Successfully created newFile.ts');
  });

  it('should handle AI service error', async () => {
    const existingContent = 'function test() {}';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockRejectedValue(new Error('AI service error'));

    const result: ToolResult = await editFileTool.execute({
      target_file: 'test.js',
      instructions: 'I am trying to edit the function',
      code_edit: '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('AI service error');
  });

  it('should validate required parameters', async () => {
    // Test missing target_file
    let result = await editFileTool.execute({
      instructions: 'test',
      code_edit: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('target_file parameter is required and must be a string');

    // Test missing instructions
    result = await editFileTool.execute({
      target_file: 'test.js',
      code_edit: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('instructions parameter is required and must be a string');

    // Test missing code_edit
    result = await editFileTool.execute({
      target_file: 'test.js',
      instructions: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('code_edit parameter is required and must be a string');
  });

  it('should handle AI service network errors', async () => {
    const existingContent = 'function test() {}';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockRejectedValue(new Error('Failed to apply edit via AI service: Network error'));

    const result: ToolResult = await editFileTool.execute({
      target_file: 'test.js',
      instructions: 'I am trying to edit the function',
      code_edit: '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to apply edit via AI service: Network error');
  });

  it('should handle file write errors', async () => {
    const existingContent = 'function test() {}';
    const editedContent = 'function test() { console.log("test"); }';

    mockReadFile.mockResolvedValue(existingContent);
    mockApplyEdit.mockResolvedValue(editedContent);
    mockWriteFile.mockRejectedValue(new Error('Permission denied'));

    const result: ToolResult = await editFileTool.execute({
      target_file: 'test.js',
      instructions: 'I am trying to edit the function',
      code_edit: '// ... existing code ...\nconsole.log("test");\n// ... existing code ...',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });
});
