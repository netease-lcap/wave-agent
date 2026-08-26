import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";

describe("User message tool block output", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the full result as markdown instead of shortResult", () => {
    renderChatApp();

    // Forked-skill output lands on a user-message tool block: result carries
    // the complete markdown output, shortResult is only the running summary.
    const userToolMessage = {
      id: "msg-u1",
      role: "user",
      blocks: [
        { type: "text", content: "/deep-research" },
        {
          type: "tool",
          name: "deep-research",
          stage: "end",
          success: true,
          shortResult: "Research complete, 5 sources",
          result: "# Report Title\n\nSome **bold** content",
        },
      ],
    };

    sendCommand("updateMessages", { messages: [userToolMessage as unknown] });

    const output = document.querySelector(".command-output");
    expect(output).toBeInTheDocument();

    // Full result is rendered (markdown: heading + bold), not the summary.
    expect(output).toHaveTextContent("Report Title");
    expect(output).toHaveTextContent("bold");
    expect(output).not.toHaveTextContent("Research complete");
  });

  it("should show the shortResult progress summary while running", () => {
    renderChatApp();

    const runningMessage = {
      id: "msg-u2",
      role: "user",
      blocks: [
        { type: "text", content: "/deep-research" },
        {
          type: "tool",
          name: "deep-research",
          stage: "running",
          shortResult: "Working on it...",
        },
      ],
    };

    sendCommand("updateMessages", { messages: [runningMessage as unknown] });

    const output = document.querySelector(".command-output");
    expect(output).toBeInTheDocument();
    expect(output).toHaveTextContent("Working on it...");
  });

  it("should keep the tool card rendering for assistant tool blocks", () => {
    renderChatApp();

    const assistantToolMessage = {
      id: "msg-u3",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "some-tool",
          stage: "end",
          success: true,
          result: "assistant tool result",
        },
      ],
    };

    sendCommand("updateMessages", {
      messages: [assistantToolMessage as unknown],
    });

    // Assistant-message tool blocks are untouched: no command-output wrapper.
    expect(document.querySelector(".command-output")).not.toBeInTheDocument();
  });
});
