import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolResultDisplay } from "../../src/components/ToolResultDisplay.js";
import type { ToolBlock } from "wave-agent-sdk";

// Mock toolManager - no longer needed since we removed display fields
vi.mock("wave-agent-sdk");

describe("ToolResultDisplay Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Collapsed view display", () => {
    it("should display shortResult when available", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "read_file",

        success: true,
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

      // Should show tool name
      expect(output).toContain("🔧 read_file");

      // Should show shortResult (without "Result:" label)
      expect(output).toContain("Read 50 lines from src/test.ts");
      expect(output).not.toContain("Result:");

      // Should NOT show parameters in collapsed view
      expect(output).not.toContain("Parameters:");
    });

    it("should display fallback shortResult when shortResult is not available", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "read_file",

        success: true,
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
        name: "read_file",

        success: true,
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
        name: "some_tool",

        success: true,
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
    it("should show error status with message", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "test_tool",

        success: false,

        error: "File not found",
        parameters: "{}",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain("❌");
      expect(output).toContain("Error: File not found");
    });

    it("should show running status", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "test_tool",

        isRunning: true,
        parameters: "{}",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();
      expect(output).toContain("🔄");
    });
  });

  describe("Image indicator display", () => {
    it("should show single image indicator when tool result has one image", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "screenshot_tool",

        success: true,
        parameters: JSON.stringify({ action: "capture" }),
        result: "Screenshot captured successfully",
        images: [
          {
            data: "base64_image_data",
            mediaType: "image/png",
          },
        ],
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();

      expect(output).toContain("🔧 screenshot_tool");
      expect(output).toContain("🖼️");
      expect(output).not.toContain("🖼️×");
    });

    it("should show multiple image indicator when tool result has multiple images", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "multi_screenshot_tool",

        success: true,
        parameters: JSON.stringify({ count: 3 }),
        result: "Multiple screenshots captured",
        images: [
          { data: "image1_data", mediaType: "image/png" },
          { data: "image2_data", mediaType: "image/png" },
          { data: "image3_data", mediaType: "image/png" },
        ],
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();

      expect(output).toContain("🔧 multi_screenshot_tool");
      expect(output).toContain("🖼️×3");
    });

    it("should not show image indicator when tool result has no images", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "text_tool",

        success: true,
        parameters: JSON.stringify({ action: "process" }),
        result: "Text processing completed",
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();

      expect(output).toContain("🔧 text_tool");
      expect(output).not.toContain("🖼️");
    });

    it("should not show image indicator when images array is empty", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "empty_images_tool",

        success: true,
        parameters: JSON.stringify({ action: "test" }),
        result: "Tool executed",
        images: [],
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();

      expect(output).toContain("🔧 empty_images_tool");
      expect(output).not.toContain("🖼️");
    });

    it("should show image indicator combined with status text", () => {
      const toolBlock: ToolBlock = {
        type: "tool",
        name: "screenshot_tool",

        isRunning: true,
        parameters: JSON.stringify({ action: "capture" }),
        images: [{ data: "image_data", mediaType: "image/png" }],
      };

      const { lastFrame } = render(<ToolResultDisplay block={toolBlock} />);
      const output = lastFrame();

      expect(output).toContain("🔧 screenshot_tool");
      expect(output).toContain("🔄"); // Running status
      expect(output).toContain("🖼️"); // Image indicator
    });
  });
});
