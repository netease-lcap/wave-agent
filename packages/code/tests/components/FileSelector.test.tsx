import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { FileSelector, FileItem } from "../../src/components/FileSelector.js";

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
    expect(output).toContain(", File 1 of 20");
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
    expect(output).toContain(", File 1 of 25");
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
    // Test scrolling window logic
    const maxDisplay = 10;
    const files: FileItem[] = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i + 1}.txt`,
      type: "file",
    }));

    // Test window calculation when selecting first file
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

    // Test different selection positions
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

  describe("Tab key functionality", () => {
    it("should trigger onSelect with correct file path when Tab is pressed", () => {
      const onSelectMock = vi.fn();
      const testProps = { ...mockProps, onSelect: onSelectMock };
      const { stdin } = render(<FileSelector {...testProps} />);

      // Press Tab key (should select first file by default)
      stdin.write("\t");

      expect(onSelectMock).toHaveBeenCalledWith("file1.txt");
      expect(onSelectMock).toHaveBeenCalledTimes(1);
    });

    it("should not call onSelect when Tab is pressed with empty files list", () => {
      const onSelectMock = vi.fn();
      const emptyProps = {
        ...mockProps,
        files: [],
        searchQuery: "test",
        onSelect: onSelectMock,
      };
      const { stdin } = render(<FileSelector {...emptyProps} />);

      // Press Tab key with empty files list
      stdin.write("\t");

      expect(onSelectMock).not.toHaveBeenCalled();
    });

    it("should work the same way as Enter key - both keys should trigger onSelect", () => {
      const onSelectMockTab = vi.fn();
      const onSelectMockEnter = vi.fn();

      // Test Tab key
      const tabProps = { ...mockProps, onSelect: onSelectMockTab };
      const { stdin: stdinTab } = render(<FileSelector {...tabProps} />);
      stdinTab.write("\t");

      // Test Enter key
      const enterProps = { ...mockProps, onSelect: onSelectMockEnter };
      const { stdin: stdinEnter } = render(<FileSelector {...enterProps} />);
      stdinEnter.write("\r");

      // Both should call onSelect with the same file (first file by default)
      expect(onSelectMockTab).toHaveBeenCalledWith("file1.txt");
      expect(onSelectMockEnter).toHaveBeenCalledWith("file1.txt");
      expect(onSelectMockTab).toHaveBeenCalledTimes(1);
      expect(onSelectMockEnter).toHaveBeenCalledTimes(1);
    });

    it("should trigger onSelect with correct file path when Tab is pressed with different files", () => {
      // Test with a smaller, different set of files to ensure Tab works correctly
      const testFiles: FileItem[] = [
        { path: "README.md", type: "file" },
        { path: "package.json", type: "file" },
        { path: "src", type: "directory" },
      ];

      const onSelectMock = vi.fn();
      const testProps = {
        ...mockProps,
        files: testFiles,
        onSelect: onSelectMock,
      };
      const { stdin } = render(<FileSelector {...testProps} />);

      // Press Tab key (should select first file by default)
      stdin.write("\t");

      expect(onSelectMock).toHaveBeenCalledWith("README.md");
      expect(onSelectMock).toHaveBeenCalledTimes(1);
    });

    it("should handle Tab key with single file", () => {
      const singleFile: FileItem[] = [
        { path: "single-file.txt", type: "file" },
      ];

      const onSelectMock = vi.fn();
      const testProps = {
        ...mockProps,
        files: singleFile,
        onSelect: onSelectMock,
      };
      const { stdin } = render(<FileSelector {...testProps} />);

      // Press Tab key
      stdin.write("\t");

      expect(onSelectMock).toHaveBeenCalledWith("single-file.txt");
      expect(onSelectMock).toHaveBeenCalledTimes(1);
    });

    it("should handle Tab key correctly with directory files", () => {
      const mixedFiles: FileItem[] = [
        { path: "src", type: "directory" },
        { path: "components", type: "directory" },
        { path: "index.ts", type: "file" },
      ];

      const onSelectMock = vi.fn();
      const testProps = {
        ...mockProps,
        files: mixedFiles,
        onSelect: onSelectMock,
      };
      const { stdin } = render(<FileSelector {...testProps} />);

      // Press Tab key (should select first item - directory)
      stdin.write("\t");

      expect(onSelectMock).toHaveBeenCalledWith("src");
      expect(onSelectMock).toHaveBeenCalledTimes(1);
    });
  });
});
