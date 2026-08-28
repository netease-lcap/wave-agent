import { describe, it, expect, beforeEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";

function getLastMessage(): HTMLElement {
  const container = document.querySelector(
    '[data-testid="messages-container"]',
  )!;
  const msgs = Array.from(container.querySelectorAll(".message"));
  return msgs[msgs.length - 1] as HTMLElement;
}

describe("timeline dot color by stage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("text block dot is yellow while streaming and green when done", () => {
    renderChatApp();

    // streaming text → yellow dot
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "streaming" }],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toContain(
      "Warning",
    );

    // finished text → green dot
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m1",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "hello", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toContain("Passed");
  });

  it("reasoning block dot is yellow while streaming and green when done", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [
            { type: "reasoning", content: "thinking", stage: "streaming" },
          ],
        },
      ],
    });
    const streamingRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(streamingRow.style.getPropertyValue("--dot-color")).toContain(
      "Warning",
    );

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m2",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "reasoning", content: "thinking", stage: "end" }],
        },
      ],
    });
    const doneRow = getLastMessage().querySelector(
      ".timeline-row",
    ) as HTMLElement;
    expect(doneRow.style.getPropertyValue("--dot-color")).toContain("Passed");
  });

  it("history text block without stage defaults to green dot", () => {
    renderChatApp();

    // A loaded-from-history text block has no stage → treated as done (green).
    sendCommand("updateMessages", {
      messages: [
        {
          id: "m3",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "text", content: "past message" }],
        },
      ],
    });
    const row = getLastMessage().querySelector(".timeline-row") as HTMLElement;
    expect(row.style.getPropertyValue("--dot-color")).toContain("Passed");
  });

  it("compact block is wrapped in a timeline row with the link-accent dot", () => {
    renderChatApp();

    sendCommand("updateMessages", {
      messages: [
        {
          id: "m4",
          role: "assistant",
          timestamp: "2024-01-01T00:00:00.000Z",
          blocks: [{ type: "compact", content: "对话摘要" }],
        },
      ],
    });
    const row = getLastMessage().querySelector(".timeline-row") as HTMLElement;
    // The compact block renders inside a .timeline-row so it gets the dot and
    // the 10px top spacing like text/tool/reasoning blocks.
    expect(row).not.toBeNull();
    expect(row.querySelector(".compact-block")).not.toBeNull();
    expect(row.style.getPropertyValue("--dot-color")).toContain("textLink");
  });
});
