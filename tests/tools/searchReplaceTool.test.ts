import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchReplaceTool } from '../../src/plugins/tools/searchReplaceTool';
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

const mockReadFile = vi.mocked(await import('fs/promises')).readFile;
const mockWriteFile = vi.mocked(await import('fs/promises')).writeFile;

describe('searchReplaceTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully replace unique text in file', async () => {
    const fileContent = `function test() {
  console.log("old message");
  return true;
}

function other() {
  console.log("different message");
}`;

    const expectedContent = `function test() {
  console.log("new message");
  return true;
}

function other() {
  console.log("different message");
}`;

    mockReadFile.mockResolvedValue(fileContent);
    mockWriteFile.mockResolvedValue();

    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'function test() {\n  console.log("old message");\n  return true;\n}',
      new_string: 'function test() {\n  console.log("new message");\n  return true;\n}',
    });

    expect(mockReadFile).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('test.js', expectedContent, 'utf-8');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Successfully replaced 1 occurrence in test.js');
  });

  it('should fail when old_string is not found', async () => {
    const fileContent = `function test() {
  console.log("message");
}`;

    mockReadFile.mockResolvedValue(fileContent);

    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'nonexistent text',
      new_string: 'replacement text',
    });

    expect(mockReadFile).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe('old_string not found in file');
  });

  it('should fail when old_string appears multiple times', async () => {
    const fileContent = `function test1() {
  console.log("message");
}

function test2() {
  console.log("message");
}`;

    mockReadFile.mockResolvedValue(fileContent);

    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'console.log("message");',
      new_string: 'console.log("new message");',
    });

    expect(mockReadFile).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'old_string appears 2 times in the file. It must be unique. Please include more context to make it unique.',
    );
  });

  it('should validate required parameters', async () => {
    // Test missing file_path
    let result = await searchReplaceTool.execute({
      old_string: 'test',
      new_string: 'replacement',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('file_path parameter is required and must be a string');

    // Test missing old_string
    result = await searchReplaceTool.execute({
      file_path: 'test.js',
      new_string: 'replacement',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('old_string parameter is required and must be a string');

    // Test missing new_string
    result = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('new_string parameter is required and must be a string');

    // Test identical old_string and new_string
    result = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'test',
      new_string: 'test',
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('old_string and new_string must be different');
  });

  it('should handle file read errors', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'));

    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'nonexistent.js',
      old_string: 'test',
      new_string: 'replacement',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('File not found');
  });

  it('should handle file write errors', async () => {
    const fileContent = 'function test() { console.log("old"); }';

    mockReadFile.mockResolvedValue(fileContent);
    mockWriteFile.mockRejectedValue(new Error('Permission denied'));

    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'console.log("old")',
      new_string: 'console.log("new")',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Permission denied');
  });

  it('should work with context to ensure uniqueness', async () => {
    const fileContent = `function test1() {
  console.log("message");
  return 1;
}

function test2() {
  console.log("message");
  return 2;
}`;

    const expectedContent = `function test1() {
  console.log("new message");
  return 1;
}

function test2() {
  console.log("message");
  return 2;
}`;

    mockReadFile.mockResolvedValue(fileContent);
    mockWriteFile.mockResolvedValue();

    // Use context to make the replacement unique
    const result: ToolResult = await searchReplaceTool.execute({
      file_path: 'test.js',
      old_string: 'function test1() {\n  console.log("message");\n  return 1;\n}',
      new_string: 'function test1() {\n  console.log("new message");\n  return 1;\n}',
    });

    expect(mockReadFile).toHaveBeenCalledWith('test.js', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('test.js', expectedContent, 'utf-8');
    expect(result.success).toBe(true);
    expect(result.content).toBe('Successfully replaced 1 occurrence in test.js');
  });
});
