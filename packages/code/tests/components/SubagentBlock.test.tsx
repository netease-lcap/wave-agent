import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { SubagentBlock } from "../../src/components/SubagentBlock.js";
import type { SubagentBlock as SubagentBlockType } from "wave-agent-sdk";

// Mock useChat context
const mockSubagentMessages = {
  "sub-1": [
    {
      role: "assistant",
      blocks: [
        { type: "text", content: "Thinking..." },
        { type: "tool", name: "ls", compactParams: "." },
      ],
    },
    {
      role: "assistant",
      blocks: [{ type: "text", content: "Final result from subagent" }],
    },
  ],
};

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    subagentMessages: mockSubagentMessages,
  }),
}));

describe("SubagentBlock Component", () => {
  it("should show the last text message when completed", () => {
    const block: SubagentBlockType = {
      subagentId: "sub-1",
      subagentName: "Test Subagent",
      status: "completed",
      type: "subagent",
      sessionId: "session-1",
      configuration: {
        name: "test",
        description: "test",
        systemPrompt: "test",
        filePath: "test",
        scope: "project",
        priority: 1,
      },
    };

    const { lastFrame } = render(<SubagentBlock block={block} />);
    const output = lastFrame();

    expect(output).toContain("🤖 Test Subagent");
    expect(output).toContain("✅");
    expect(output).toContain("Final result from subagent");
    expect(output).not.toContain("🔧 ls");
  });

  it("should NOT show the last text message when active", () => {
    const block: SubagentBlockType = {
      subagentId: "sub-1",
      subagentName: "Test Subagent",
      status: "active",
      type: "subagent",
      sessionId: "session-1",
      configuration: {
        name: "test",
        description: "test",
        systemPrompt: "test",
        filePath: "test",
        scope: "project",
        priority: 1,
      },
    };

    const { lastFrame } = render(<SubagentBlock block={block} />);
    const output = lastFrame();

    expect(output).toContain("🤖 Test Subagent");
    expect(output).toContain("🔄");
    expect(output).not.toContain("Final result from subagent");
    expect(output).toContain("🔧 ls");
  });
});
