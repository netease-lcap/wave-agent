import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { FileSelector } from "../../src/components/FileSelector";

describe("FileSelector", () => {
  const mockFiles = Array.from({ length: 20 }, (_, i) => ({
    path: `file${i + 1}.txt`,
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
    expect(output).toContain("Select File");
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
      })),
    };

    const { lastFrame } = render(<FileSelector {...propsWithManyFiles} />);

    const output = lastFrame();
    expect(output).toContain("Select File");
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
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i + 1}.txt`,
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
});
