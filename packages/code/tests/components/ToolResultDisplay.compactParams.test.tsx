import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ToolResultDisplay } from "../../src/components/ToolResultDisplay.js";
import type { ToolBlock } from "wave-agent-sdk";

describe("ToolResultDisplay - CompactParams from Attributes", () => {
  it("should display compactParams from attributes when available", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"target_file": "example.ts", "query": "useState"}',
      name: "test_tool",

      success: true,

      compactParams: 'example.ts: "useState"',
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 应该显示从 attributes 获取的 compactParams
    expect(output).toContain('(example.ts: "useState")');
  });

  it("should not show compactParams when not provided in attributes", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 不应该显示 compactParams
    expect(output).not.toContain("(");
    expect(output).not.toContain(")");
  });

  it("should handle empty compactParams gracefully", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,

      compactParams: "",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 应该正常渲染，不显示 compactParams
    expect(output).toContain("test_tool");
    expect(output).not.toContain("(");
  });

  it("should not show compactParams in expanded mode", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"target_file": "test.ts", "query": "function"}',
      name: "test_tool",

      success: true,

      compactParams: 'test.ts: "function"',
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={true} />,
    );

    const output = lastFrame();
    // 展开模式下不应该显示 compactParams
    expect(output).not.toContain('(test.ts: "function")');
  });

  it("should handle undefined compactParams", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,

      compactParams: undefined,
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 应该正常渲染，不显示 compactParams
    expect(output).toContain("test_tool");
    expect(output).not.toContain("(");
  });
});
