import React from "react";
import { render } from "ink-testing-library";
import { Confirmation } from "../src/components/Confirmation.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "wave-agent-sdk";
import { describe, it, expect, vi } from "vitest";

describe("Confirmation Component Other Input", () => {
  it('should allow typing and deleting in "Other" option', async () => {
    const onDecision = vi.fn();
    const toolInput = {
      questions: [
        {
          header: "Test",
          question: "What is your name?",
          options: [{ label: "Alice" }, { label: "Bob" }],
        },
      ],
    };

    const { stdin, lastFrame } = render(
      <Confirmation
        toolName={ASK_USER_QUESTION_TOOL_NAME}
        toolInput={toolInput}
        onDecision={onDecision}
        onCancel={() => {}}
        onAbort={() => {}}
      />,
    );

    // 1. Navigate to "Other" (it's the 3rd option: Alice, Bob, Other)
    stdin.write("\u001b[B"); // Down
    await vi.waitFor(() => expect(lastFrame()).toContain("> Bob"));
    stdin.write("\u001b[B"); // Down
    await vi.waitFor(() => expect(lastFrame()).toContain("> Other"));

    // 2. Type "123"
    stdin.write("1");
    await vi.waitFor(() => expect(lastFrame()).toContain("1"), {
      timeout: 2000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.write("2");
    await vi.waitFor(() => expect(lastFrame()).toContain("12"), {
      timeout: 2000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    stdin.write("3");
    await vi.waitFor(() => expect(lastFrame()).toContain("123"), {
      timeout: 2000,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 4. Try to delete "3"
    stdin.write("\u001b[3~"); // Delete key

    await vi.waitFor(
      () => {
        const frame = lastFrame();
        expect(frame).toContain("12");
        expect(frame).not.toContain("123");
      },
      { timeout: 2000 },
    );
  });
});
