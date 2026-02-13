/**
 * Test for dynamic action descriptions in Confirmation
 */

import React from "react";
import { render } from "ink-testing-library";
import { vi, describe, it, expect, beforeEach } from "vitest";
import {
  ConfirmationDetails,
  type ConfirmationDetailsProps,
} from "../../src/components/ConfirmationDetails.js";
import {
  ConfirmationSelector,
  type ConfirmationSelectorProps,
} from "../../src/components/ConfirmationSelector.js";

const Confirmation = (
  props: ConfirmationSelectorProps & ConfirmationDetailsProps,
) => (
  <>
    <ConfirmationDetails {...props} />
    <ConfirmationSelector {...props} />
  </>
);

describe("Confirmation Dynamic Actions", () => {
  const mockOnDecision = vi.fn();
  const mockOnCancel = vi.fn();
  const mockOnAbort = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should display Bash command in action description", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Bash"
        toolInput={{ command: "pwd", description: "Show current directory" }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Bash");
    expect(frame).toContain("Execute command: pwd");
  });

  it("should display Edit file path in action description", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Edit"
        toolInput={{
          file_path: "/home/user/test.txt",
          old_string: "old",
          new_string: "new",
        }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Edit");
    expect(frame).toContain("Edit file: /home/user/test.txt");
  });

  it("should display Delete file path in action description", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Delete"
        toolInput={{ target_file: "/home/user/unwanted.log" }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Delete");
    expect(frame).toContain("Delete file: /home/user/unwanted.log");
  });

  it("should display Write file path in action description", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Write"
        toolInput={{
          file_path: "/home/user/output.txt",
          content: "Hello World",
        }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Write");
    expect(frame).toContain("Write to file: /home/user/output.txt");
  });

  it("should display MultiEdit file path in action description", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="MultiEdit"
        toolInput={{
          file_path: "/home/user/config.js",
          edits: [{ old_string: "old", new_string: "new" }],
        }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: MultiEdit");
    expect(frame).toContain("Edit multiple sections in: /home/user/config.js");
  });

  it("should fall back to generic description for unknown tools", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="UnknownTool"
        toolInput={{ some_param: "value" }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: UnknownTool");
    expect(frame).toContain("Execute operation");
  });

  it("should handle missing toolInput gracefully", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Bash"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Bash");
    expect(frame).toContain("Execute operation");
  });

  it("should handle missing file paths gracefully", () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Edit"
        toolInput={{ old_string: "old", new_string: "new" }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    const frame = lastFrame();
    expect(frame).toContain("Tool: Edit");
    expect(frame).toContain("Edit file: unknown file");
  });
});
