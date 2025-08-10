import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listDirTool } from '../../src/plugins/tools/listDirTool';
import type { ToolResult, ToolContext } from '../../src/plugins/tools/types';
import type { Stats } from 'fs';

// Mock fs/promises module
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      stat: vi.fn(),
      readdir: vi.fn(),
    },
  };
});

// Mock path module
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return {
    ...actual,
    resolve: vi.fn((...paths: string[]) => paths.join('/')),
    join: vi.fn((...paths: string[]) => paths.join('/')),
  };
});

const mockStat = vi.mocked((await import('fs')).promises.stat);
const mockReaddir = vi.mocked((await import('fs')).promises.readdir);

describe('listDirTool with real fs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list directory contents using real fs', async () => {
    const context: ToolContext = {
      flatFiles: [],
      workdir: '/test/project',
    };

    // Mock fs.promises.stat to return directory stats
    mockStat.mockImplementation((path) => {
      const pathStr = path.toString();
      if (pathStr === '/test/project' || pathStr === '/test/project/') {
        return Promise.resolve({ isDirectory: () => true } as Stats);
      }
      if (pathStr.includes('/src')) {
        return Promise.resolve({
          isDirectory: () => false,
          size: 0,
        } as Stats);
      }
      return Promise.resolve({
        isDirectory: () => false,
        size: pathStr.includes('image.png') ? 1024 : pathStr.includes('document.pdf') ? 2048 : 500,
      } as Stats);
    });

    // Mock fs.promises.readdir to return mixed file types
    const mockReaddirFn = mockReaddir as unknown as ReturnType<typeof vi.fn>;
    mockReaddirFn.mockResolvedValue([
      { name: 'src', isDirectory: () => true, isFile: () => false },
      { name: 'package.json', isDirectory: () => false, isFile: () => true },
      { name: 'image.png', isDirectory: () => false, isFile: () => true },
      { name: 'document.pdf', isDirectory: () => false, isFile: () => true },
    ]);

    const result: ToolResult = await listDirTool.execute(
      {
        relative_workspace_path: '.',
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();

    // Should contain directory listing
    expect(result.content).toContain('Directory: .');
    expect(result.content).toContain('Total items: 4');

    // Should show directories first
    expect(result.content).toContain('📁 src');

    // Should show files with sizes
    expect(result.content).toContain('📄 document.pdf');
    expect(result.content).toContain('📄 package.json');
    expect(result.content).toContain('📄 image.png');

    // Should mark binary files
    expect(result.content).toContain('[binary]');
  });

  it('should handle non-existent directory', async () => {
    const context: ToolContext = {
      flatFiles: [],
      workdir: '/test/project',
    };

    mockStat.mockRejectedValue(new Error('ENOENT: no such file or directory'));

    const result: ToolResult = await listDirTool.execute(
      {
        relative_workspace_path: 'nonexistent',
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle file instead of directory', async () => {
    const context: ToolContext = {
      flatFiles: [],
      workdir: '/test/project',
    };

    mockStat.mockResolvedValue({ isDirectory: () => false } as Stats);

    const result: ToolResult = await listDirTool.execute(
      {
        relative_workspace_path: 'package.json',
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Path package.json is not a directory');
  });

  it('should require workdir in context', async () => {
    const context: ToolContext = {
      flatFiles: [],
    };

    const result: ToolResult = await listDirTool.execute(
      {
        relative_workspace_path: '.',
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('Context with workdir is required');
  });
});
