import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ToolResultDisplay } from "@/components/ToolResultDisplay";
import type { ToolBlock } from "@/types";

// Mock toolRegistry
vi.mock("@/plugins/tools", () => ({
  toolRegistry: {
    list: () => [
      {
        name: "test_tool",
        formatCompactParams: (params: Record<string, unknown>) => {
          if (params.target_file && params.query) {
            return `${params.target_file}: "${params.query}"`;
          }
          return "test params";
        },
      },
    ],
  },
}));

describe("ToolResultDisplay - Dynamic CompactParams", () => {
  it("should dynamically generate compactParams when parameters are available", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"target_file": "example.ts", "query": "useState"}',
      attributes: {
        name: "test_tool",
        success: true,
      },
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 应该动态生成 compactParams
    expect(output).toContain('(example.ts: "useState")');
  });

  it("should not show compactParams when tool plugin not found", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      attributes: {
        name: "unknown_tool",
        success: true,
      },
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 不应该显示 compactParams
    expect(output).not.toContain("(");
    expect(output).not.toContain(")");
  });

  it("should handle invalid JSON parameters gracefully", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: "invalid json",
      attributes: {
        name: "test_tool",
        success: true,
      },
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
      attributes: {
        name: "test_tool",
        success: true,
      },
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={true} />,
    );

    const output = lastFrame();
    // 展开模式下不应该显示 compactParams
    expect(output).not.toContain('(test.ts: "function")');
  });

  it("should handle missing formatCompactParams method", () => {
    // Mock toolRegistry with a tool that doesn't have formatCompactParams
    vi.doMock("@/plugins/tools", () => ({
      toolRegistry: {
        list: () => [
          {
            name: "simple_tool",
            // 没有 formatCompactParams 方法
          },
        ],
      },
    }));

    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      attributes: {
        name: "simple_tool",
        success: true,
      },
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // 应该正常渲染，不显示 compactParams
    expect(output).toContain("simple_tool");
    expect(output).not.toContain("(");
  });
});
