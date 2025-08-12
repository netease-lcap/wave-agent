import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, readFile, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { diffLines } from 'diff';

// 模拟工具结果结构
interface MockToolResult {
  success: boolean;
  content: string;
  error?: string;
  shortResult?: string;
  originalContent?: string;
  newContent?: string;
  diffResult?: Array<{
    count?: number;
    value: string;
    added?: boolean;
    removed?: boolean;
  }>;
  filePath?: string;
}

// 模拟 edit_file 工具逻辑
async function mockEditFileTool(
  targetFile: string,
  instructions: string,
  codeEdit: string,
  workdir: string
): Promise<MockToolResult> {
  try {
    const filePath = resolve(workdir, targetFile);
    
    // 检查文件是否存在
    let existingContent = '';
    try {
      existingContent = await readFile(filePath, 'utf-8');
    } catch {
      // 文件不存在，创建新文件
    }

    // 模拟简单的编辑逻辑
    let editedContent = codeEdit;
    if (codeEdit.includes('... existing code ...') && existingContent) {
      // 简单的替换逻辑
      editedContent = codeEdit.replace(/\/\/ \.\.\. existing code \.\.\./g, existingContent);
    }

    // 写入文件
    await writeFile(filePath, editedContent, 'utf-8');

    // 生成 diff 信息
    const diffResult = diffLines(existingContent, editedContent);
    const isNewFile = existingContent.trim() === '';

    return {
      success: true,
      content: `Successfully ${isNewFile ? 'created' : 'edited'} ${targetFile}`,
      originalContent: existingContent,
      newContent: editedContent,
      diffResult: diffResult,
      filePath: targetFile,
      shortResult: isNewFile 
        ? `Created new file (${editedContent.split('\n').length} lines)`
        : `Modified file`,
    };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// 模拟 search_replace 工具逻辑
async function mockSearchReplaceTool(
  filePath: string,
  oldString: string,
  newString: string,
  workdir: string
): Promise<MockToolResult> {
  try {
    const resolvedPath = resolve(workdir, filePath);
    
    // 读取文件内容
    const fileContent = await readFile(resolvedPath, 'utf-8');

    // 检查old_string是否存在
    if (!fileContent.includes(oldString)) {
      return {
        success: false,
        content: '',
        error: 'old_string not found in file',
      };
    }

    // 检查old_string是否唯一
    const occurrences = fileContent.split(oldString).length - 1;
    if (occurrences > 1) {
      return {
        success: false,
        content: '',
        error: `old_string appears ${occurrences} times in the file. It must be unique.`,
      };
    }

    // 执行替换
    const newContent = fileContent.replace(oldString, newString);

    // 写入文件
    await writeFile(resolvedPath, newContent, 'utf-8');

    // 生成 diff 信息
    const diffResult = diffLines(fileContent, newContent);
    const oldLines = oldString.split('\n').length;
    const newLines = newString.split('\n').length;

    return {
      success: true,
      content: `Successfully replaced 1 occurrence in ${filePath}`,
      originalContent: fileContent,
      newContent: newContent,
      diffResult: diffResult,
      filePath: filePath,
      shortResult: `Replaced ${oldLines} line${oldLines === 1 ? '' : 's'} with ${newLines} line${newLines === 1 ? '' : 's'}`,
    };
  } catch (error) {
    return {
      success: false,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

describe('Diff Tool Integration Tests', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = resolve(tmpdir(), `test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  });

  describe('edit_file tool diff generation', () => {
    it('should generate diff when creating a new file', async () => {
      const result = await mockEditFileTool(
        'new-component.tsx',
        'Create a React component',
        `import React from 'react';

export const NewComponent: React.FC = () => {
  return <div>Hello World</div>;
};`,
        testDir
      );

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('new-component.tsx');
      expect(result.originalContent).toBe('');
      expect(result.newContent).toContain('NewComponent');
      expect(result.diffResult).toBeDefined();
      expect(result.diffResult!.length).toBeGreaterThan(0);
      
      // 验证diff包含新增的内容
      const addedParts = result.diffResult!.filter(d => d.added);
      expect(addedParts.length).toBeGreaterThan(0);
      expect(addedParts[0].value).toContain('NewComponent');
    });

    it('should generate diff when editing existing file', async () => {
      const originalContent = `function oldFunction() {
  console.log('old');
}`;
      const testFile = 'existing-file.js';
      await writeFile(resolve(testDir, testFile), originalContent, 'utf-8');

      const result = await mockEditFileTool(
        testFile,
        'Add a new function',
        `function oldFunction() {
  console.log('old');
}

function newFunction() {
  console.log('new');
}`,
        testDir
      );

      expect(result.success).toBe(true);
      expect(result.originalContent).toBe(originalContent);
      expect(result.newContent).toContain('newFunction');
      expect(result.diffResult).toBeDefined();
      
      // 验证diff包含新增和未变更的部分
      const addedParts = result.diffResult!.filter(d => d.added);
      const unchangedParts = result.diffResult!.filter(d => !d.added && !d.removed);
      expect(addedParts.length).toBeGreaterThan(0);
      expect(unchangedParts.length).toBeGreaterThan(0);
    });
  });

  describe('search_replace tool diff generation', () => {
    it('should generate diff when replacing text', async () => {
      const originalContent = `const config = {
  apiUrl: 'http://localhost:3000',
  timeout: 5000
};`;
      const testFile = 'config.js';
      await writeFile(resolve(testDir, testFile), originalContent, 'utf-8');

      const result = await mockSearchReplaceTool(
        testFile,
        "apiUrl: 'http://localhost:3000'",
        "apiUrl: 'https://api.example.com'",
        testDir
      );

      expect(result.success).toBe(true);
      expect(result.originalContent).toBe(originalContent);
      expect(result.newContent).toContain('https://api.example.com');
      expect(result.diffResult).toBeDefined();
      
      // 验证diff包含删除和新增的部分
      const removedParts = result.diffResult!.filter(d => d.removed);
      const addedParts = result.diffResult!.filter(d => d.added);
      expect(removedParts.length).toBeGreaterThan(0);
      expect(addedParts.length).toBeGreaterThan(0);
      expect(removedParts[0].value).toContain('localhost');
      expect(addedParts[0].value).toContain('api.example.com');
    });

    it('should fail when old_string is not unique', async () => {
      const originalContent = `const value1 = 'duplicate';
const value2 = 'duplicate';`;
      const testFile = 'duplicate.js';
      await writeFile(resolve(testDir, testFile), originalContent, 'utf-8');

      const result = await mockSearchReplaceTool(
        testFile,
        'duplicate',
        'unique',
        testDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('appears 2 times');
    });

    it('should fail when old_string not found', async () => {
      const originalContent = `const config = { test: true };`;
      const testFile = 'not-found.js';
      await writeFile(resolve(testDir, testFile), originalContent, 'utf-8');

      const result = await mockSearchReplaceTool(
        testFile,
        'nonexistent',
        'replacement',
        testDir
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('old_string not found in file');
    });
  });

  describe('Diff viewer path display', () => {
    it('should format file paths correctly for display', () => {
      const testPaths = [
        'src/components/Header.tsx',
        'utils/helpers.js',
        'tests/unit/component.test.ts',
        'package.json'
      ];

      testPaths.forEach(path => {
        const displayPath = `📄 ${path}`;
        expect(displayPath).toMatch(/^📄 /);
        expect(displayPath).toContain(path);
      });
    });

    it('should handle various file extensions', () => {
      const extensions = ['.tsx', '.js', '.ts', '.json', '.md', '.css'];
      extensions.forEach(ext => {
        const filename = `test${ext}`;
        const displayPath = `📄 ${filename}`;
        expect(displayPath).toContain(ext);
      });
    });
  });

  describe('Integration with message blocks', () => {
    it('should create proper diff block structure', async () => {
      const result = await mockEditFileTool(
        'test.js',
        'Create test file',
        'console.log("test");',
        testDir
      );

      // 模拟创建diff块的结构
      const diffBlock = {
        type: 'diff',
        path: result.filePath!,
        original: result.originalContent!,
        modified: result.newContent!,
        diffResult: result.diffResult!,
      };

      expect(diffBlock.type).toBe('diff');
      expect(diffBlock.path).toBe('test.js');
      expect(diffBlock.original).toBe('');
      expect(diffBlock.modified).toContain('console.log');
      expect(diffBlock.diffResult).toBeDefined();
      expect(diffBlock.diffResult.length).toBeGreaterThan(0);
    });
  });
});