import { describe, it, expect, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";
import {
  renderChatApp,
  screen,
  sendCommand,
  createMockVscode,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";

// The message list (and thus the compaction hint) only renders once the
// conversation has at least one message; an empty conversation shows the
// welcome view instead. paneId tags the message for desktop split-view
// instances, which ignore untagged session-scoped commands.
function addUserMessage(paneId?: string) {
  sendCommand("updateMessages", {
    messages: [
      {
        id: "msg_user_1",
        role: "user",
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "/compact" }],
      },
    ],
    ...(paneId ? { paneId } : {}),
  });
}

describe("Compaction hint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the hint after the blinking cursor while compacting and hides it on completion", () => {
    renderChatApp();
    addUserMessage();

    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();

    sendCommand("compactionStateChange", { isCompacting: true });

    const hint = screen.getByTestId("compaction-hint");
    expect(hint).toHaveTextContent("正在压缩对话");
    expect(screen.getByTestId("messages-container").className).toContain(
      "compacting",
    );

    sendCommand("compactionStateChange", { isCompacting: false });

    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();
    expect(screen.getByTestId("messages-container").className).not.toContain(
      "compacting",
    );
  });

  it("does not add a system message to the list when compaction state changes", () => {
    renderChatApp();
    addUserMessage();

    sendCommand("compactionStateChange", { isCompacting: true });
    sendCommand("compactionStateChange", { isCompacting: false });

    const container = screen.getByTestId("messages-container");
    expect(container.querySelectorAll(".message")).toHaveLength(1);
  });

  it("shows the streaming tail after the hint and clears it on completion", () => {
    renderChatApp();
    addUserMessage();

    sendCommand("compactionStateChange", { isCompacting: true });
    // No streamed text yet — no tail
    expect(
      screen.queryByTestId("compaction-hint-tail"),
    ).not.toBeInTheDocument();

    // Short text shows verbatim, newlines flattened to "\n"
    sendCommand("compactionContentUpdate", {
      content: "line1\nline2",
    });
    expect(screen.getByTestId("compaction-hint-tail").textContent).toBe(
      "line1\\nline2",
    );

    // Longer than 30 characters: only the last 30 behind an ellipsis
    const longContent = "a".repeat(40) + "TAIL";
    sendCommand("compactionContentUpdate", { content: longContent });
    expect(screen.getByTestId("compaction-hint-tail").textContent).toBe(
      `…${"a".repeat(26)}TAIL`,
    );

    sendCommand("compactionStateChange", { isCompacting: false });
    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();
  });

  it("ignores compaction state tagged for a different pane (desktop split-view)", () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode}
        host={{ type: "desktop" } as never}
        paneId="pane-a"
      />,
    );
    sendCommand("authStatusResponse", { isAuthenticated: true });
    addUserMessage("pane-a");

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "compactionStateChange",
            isCompacting: true,
            paneId: "pane-b",
          },
        }),
      );
    });
    expect(screen.queryByTestId("compaction-hint")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "compactionStateChange",
            isCompacting: true,
            paneId: "pane-a",
          },
        }),
      );
    });
    expect(screen.getByTestId("compaction-hint")).toBeInTheDocument();
  });
});
