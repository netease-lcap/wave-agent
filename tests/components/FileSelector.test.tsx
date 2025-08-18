import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { FileSelector } from "@/components/FileSelector";

describe("FileSelector Component", () => {
  const mockFiles = [
    { path: "src/index.ts" },
    { path: "src/components/App.tsx" },
    { path: "package.json" },
  ];

  it("should render file list correctly", () => {
    const { lastFrame } = render(
      <FileSelector
        files={mockFiles}
        searchQuery=""
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/index.ts");
    expect(lastFrame()).toContain("src/components/App.tsx");
    expect(lastFrame()).toContain("package.json");
  });

  it("should show search query in header when provided", () => {
    const filteredFiles = mockFiles.filter((file) => file.path.includes("tsx"));
    const { lastFrame } = render(
      <FileSelector
        files={filteredFiles}
        searchQuery="tsx"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('filtering: "tsx"');
    expect(lastFrame()).toContain("src/components/App.tsx");
    expect(lastFrame()).not.toContain("src/index.ts");
  });

  it("should show no files message when no matches", () => {
    const { lastFrame } = render(
      <FileSelector
        files={[]}
        searchQuery="nonexistent"
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(lastFrame()).toContain('No files found for "nonexistent"');
  });
});
