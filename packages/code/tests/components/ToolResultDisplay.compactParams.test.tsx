import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ToolResultDisplay } from "../../src/components/ToolResultDisplay.js";
import type { ToolBlock } from "wave-agent-sdk";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("ToolResultDisplay - CompactParams from Attributes", () => {
  vi.mocked(useChat).mockReturnValue({
    isConfirmationVisible: false,
  } as unknown as ChatContextType);
  it("should display compactParams from attributes when available", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"target_file": "example.ts", "query": "useState"}',
      name: "test_tool",

      success: true,

      compactParams: 'example.ts: "useState"',
      stage: "end",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // Should display compactParams obtained from attributes
    expect(output).toContain('example.ts: "useState"');
  });

  it("should not show compactParams when not provided in attributes", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,
      stage: "end",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // Should not display compactParams
    expect(output).toContain("🔧 test_tool");
    expect(output).not.toContain('"some"');
  });

  it("should handle empty compactParams gracefully", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,

      compactParams: "",
      stage: "end",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // Should render normally, without displaying compactParams
    expect(output).toContain("test_tool");
    expect(output).not.toContain('"some"');
  });

  it("should not show compactParams in expanded mode", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"target_file": "test.ts", "query": "function"}',
      name: "test_tool",

      success: true,

      compactParams: 'test.ts: "function"',
      stage: "end",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={true} />,
    );

    const output = lastFrame();
    // Should not display compactParams in expanded mode (only in collapsed)
    expect(output).toContain("Parameters:");
    // CompactParams should not be shown in expanded mode
    const lines = output?.split("\n") || [];
    const toolLine = lines.find((line) => line.includes("🔧"));
    expect(toolLine).not.toContain('test.ts: "function"');
  });

  it("should handle undefined compactParams", () => {
    const block: ToolBlock = {
      type: "tool",
      parameters: '{"some": "params"}',
      name: "test_tool",

      success: true,

      compactParams: undefined,
      stage: "end",
    };

    const { lastFrame } = render(
      <ToolResultDisplay block={block} isExpanded={false} />,
    );

    const output = lastFrame();
    // Should render normally, without displaying compactParams
    expect(output).toContain("test_tool");
    expect(output).not.toContain('"some"');
  });
});
