import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolResultDisplay } from "@/components/ToolResultDisplay";
import type { ToolBlock } from "@/types";

// Mock toolRegistry - no longer needed since we removed display fields
vi.mock("@/plugins/tools", () => ({
  toolRegistry: {},
}));

describe("ToolResultDisplay Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Collapsed view display", () => {
    it("should display shortResult when available", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "read_file",
          success: true,
        },
        parameters: JSON.stringify({
          target_file: "src/test.ts",
          explanation: "Testing file reading",
          start_line_one_indexed: 1,
          end_line_one_indexed_inclusive: 50,
        }),
        result: "File content here...",
        shortResult: "Read 50 lines from src/test.ts",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show tool name and status
      expect(output).toContain("🔧 read_file");
      expect(output).toContain("✅");

      // Should show shortResult (without "Result:" label)
      expect(output).toContain("Read 50 lines from src/test.ts");
      expect(output).not.toContain("Result:");

      // Should NOT show parameters in collapsed view
      expect(output).not.toContain("Parameters:");
    });

    it("should display fallback shortResult when shortResult is not available", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "read_file",
          success: true,
        },
        parameters: JSON.stringify({
          target_file: "src/test.ts",
          explanation: "Testing file reading",
        }),
        result: "Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6\nLine 7",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should NOT show parameters in collapsed view
      expect(output).not.toContain("Parameters:");

      // Should show last 5 lines from result as fallback for shortResult (without "Result:" label)
      expect(output).toContain("Line 3");
      expect(output).toContain("Line 4");
      expect(output).toContain("Line 5");
      expect(output).toContain("Line 6");
      expect(output).toContain("Line 7");
      expect(output).not.toContain("Result:");
    });

    it("should not show result indicator when both shortResult and result are not available", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "read_file",
          success: true,
        },
        parameters: JSON.stringify({
          target_file: "src/test.ts",
          explanation: "Testing file reading",
        }),
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should NOT show parameters in collapsed view
      expect(output).not.toContain("Parameters:");

      // Should not show result indicator when neither shortResult nor result is available
      expect(output).not.toContain("Result:");
    });

    it("should show shortResult when available in collapsed view", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "some_tool",
          success: true,
        },
        parameters: JSON.stringify({
          param1: "value1",
        }),
        result: "Some result...",
        shortResult: "Operation completed successfully",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);

      const output = lastFrame();

      // Should show shortResult but NOT "Result:" label in collapsed view
      expect(output).toContain("Operation completed successfully");
      expect(output).not.toContain("Result:");
      expect(output).not.toContain("Parameters:");
    });
  });

  describe("Tool status display", () => {
    it("should show success status", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "test_tool",
          success: true,
        },
        parameters: "{}",
        result: "Success",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain("✅");
    });

    it("should show error status with message", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "test_tool",
          success: false,
          error: "File not found",
        },
        parameters: "{}",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain("❌ Failed");
      expect(output).toContain("Error: File not found");
    });

    it("should show running status", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        attributes: {
          name: "test_tool",
          isRunning: true,
        },
        parameters: "{}",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain("🔄 Running...");
    });
  });
});
