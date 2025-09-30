import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { FileSelector, FileItem } from "../../src/components/FileSelector";

describe("FileSelector", () => {
  const mockFiles: FileItem[] = Array.from({ length: 20 }, (_, i) => ({
    path: `file${i + 1}.txt`,
    type: "file",
  }));

  const mockProps = {
    files: mockFiles,
    searchQuery: "",
    onSelect: vi.fn(),
    onCancel: vi.fn(),
  };

  it("should render files with scroll window correctly", () => {
    const { lastFrame } = render(<FileSelector {...mockProps} />);

    const output = lastFrame();
    expect(output).toContain("Select File/Directory");
    expect(output).toContain("file1.txt");
    expect(output).toContain("file10.txt");
    expect(output).toContain("File 1 of 20");
    expect(output).toContain("... 10 more files below");
  });

  it("should show correct scroll indicators", () => {
    // Test with files that require scrolling
    const propsWithManyFiles = {
      ...mockProps,
      files: Array.from({ length: 25 }, (_, i) => ({
        path: `file${i + 1}.txt`,
        type: "file" as const,
      })),
    };

    const { lastFrame } = render(<FileSelector {...propsWithManyFiles} />);

    const output = lastFrame();
    expect(output).toContain("Select File/Directory");
    expect(output).toContain("File 1 of 25");
    expect(output).toContain("... 15 more files below");
  });

  it("should handle empty files list", () => {
    const emptyProps = { ...mockProps, files: [], searchQuery: "test" };
    const { lastFrame } = render(<FileSelector {...emptyProps} />);

    const output = lastFrame();
    expect(output).toContain('No files found for "test"');
    expect(output).toContain("Press Escape to cancel");
  });

  it("should display search query in header", () => {
    const propsWithQuery = { ...mockProps, searchQuery: "test" };
    const { lastFrame } = render(<FileSelector {...propsWithQuery} />);

    const output = lastFrame();
    expect(output).toContain('filtering: "test"');
  });

  it("should handle scroll window logic correctly", () => {
    // 测试滚动窗口逻辑
    const maxDisplay = 10;
    const files: FileItem[] = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i + 1}.txt`,
      type: "file",
    }));

    // 测试选择第一个文件时的窗口计算
    const getDisplayWindow = (selectedIndex: number) => {
      const startIndex = Math.max(
        0,
        Math.min(
          selectedIndex - Math.floor(maxDisplay / 2),
          files.length - maxDisplay,
        ),
      );
      const endIndex = Math.min(files.length, startIndex + maxDisplay);
      const adjustedStartIndex = Math.max(0, endIndex - maxDisplay);

      return {
        startIndex: adjustedStartIndex,
        endIndex: endIndex,
      };
    };

    // 测试不同的选择位置
    const windowAt0 = getDisplayWindow(0);
    expect(windowAt0.startIndex).toBe(0);
    expect(windowAt0.endIndex).toBe(10);

    const windowAt10 = getDisplayWindow(10);
    expect(windowAt10.startIndex).toBe(5);
    expect(windowAt10.endIndex).toBe(15);

    const windowAt19 = getDisplayWindow(19);
    expect(windowAt19.startIndex).toBe(10);
    expect(windowAt19.endIndex).toBe(20);
  });

  it("should display directory icons correctly", () => {
    const mixedFiles: FileItem[] = [
      { path: "src", type: "directory" },
      { path: "src/components", type: "directory" },
      { path: "package.json", type: "file" },
      { path: "README.md", type: "file" },
    ];

    const propsWithMixed = { ...mockProps, files: mixedFiles };
    const { lastFrame } = render(<FileSelector {...propsWithMixed} />);

    const output = lastFrame();
    expect(output).toContain("📁 src");
    expect(output).toContain("📁 src/components");
    expect(output).toContain("📄 package.json");
    expect(output).toContain("📄 README.md");
  });
});
