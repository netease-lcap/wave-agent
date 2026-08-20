import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * Virtualized MessageList branch (VIRTUAL_SCROLL_THRESHOLD = 200).
 *
 * jsdom cannot do layout, so geometry assertions (spacer height, scroll
 * pinning, bounded row counts in a real viewport) live in the Playwright demo
 * harness (e2e/demo/virtual-message-list.demo.ts). Here we only pin the
 * structural contract of the virtualized branch: the branch is taken above
 * the threshold, rows are message-granularity with timeline run classes, and
 * the DOM row count stays bounded (never all messages).
 */
describe("MessageList virtualization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function buildMessages(count: number) {
    const messages: ReturnType<typeof MockDataGenerator.createUserMessage>[] =
      [];
    for (let i = 0; i < count; i++) {
      // Runs of two consecutive assistant messages (multi-dot timeline runs),
      // so the virtualized branch exercises the run classes.
      if (i % 4 === 0 || i % 4 === 3) {
        messages.push(
          MockDataGenerator.createUserMessage(`问题 ${i}`, `u${i}`),
        );
      } else {
        messages.push(
          MockDataGenerator.createAssistantMessage(`回答 ${i}`, `a${i}`),
        );
      }
    }
    return messages;
  }

  it("keeps small chats on the plain path (no virtualization)", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: buildMessages(10),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    const container = screen.getByTestId("messages-container");
    expect(container.classList.contains("messages-container--virtual")).toBe(
      false,
    );
    expect(container.querySelector(".virtual-spacer")).toBeNull();
    expect(container.querySelector(".virtual-row")).toBeNull();
    // Plain path keeps the assistant-group wrapper.
    expect(container.querySelector(".assistant-group")).not.toBeNull();
  });

  it("virtualizes large message lists with bounded DOM rows", async () => {
    // jsdom has no layout: the virtualizer reads the viewport from
    // offsetWidth/offsetHeight (always 0 in jsdom), so it would render no
    // rows. Stub a fake viewport size so the window math produces rows.
    const hDesc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const wDesc = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetWidth",
    );
    try {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get: () => 600,
      });
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get: () => 800,
      });
      renderChatApp();
      act(() => {
        sendCommand("updateMessages", {
          messages: buildMessages(250),
        });
      });
      await waitFor(() =>
        expect(
          screen
            .getByTestId("messages-container")
            .querySelector(".virtual-spacer"),
        ).not.toBeNull(),
      );

      const container = screen.getByTestId("messages-container");
      expect(container.classList.contains("messages-container--virtual")).toBe(
        true,
      );

      // In-flow spacer carries the total virtualized height; rows are the
      // message-granularity virtual rows.
      const spacer = container.querySelector(".virtual-spacer") as HTMLElement;
      expect(spacer).not.toBeNull();
      expect(parseFloat(spacer.style.height)).toBeGreaterThan(0);
      const rows = container.querySelectorAll(".virtual-row");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(100);

      // The initial load pinned the viewport to the bottom; scroll back to the
      // top so the run-start row enters the rendered window.
      act(() => {
        container.scrollTop = 0;
        fireEvent.scroll(container);
      });
      await waitFor(() =>
        expect(container.querySelector(".timeline-run--start")).not.toBeNull(),
      );

      // Timeline run classes are assigned to consecutive assistant messages.
      expect(container.querySelector(".timeline-run--end")).not.toBeNull();
      // Run-interior rows are flush (no bottom padding) so the timeline line
      // stays continuous; standalone rows keep the 10px spacing.
      const startRow = container.querySelector(
        ".timeline-run--start",
      ) as HTMLElement;
      expect(startRow.style.paddingBottom).toBe("0px");
    } finally {
      if (hDesc)
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", hDesc);
      if (wDesc)
        Object.defineProperty(HTMLElement.prototype, "offsetWidth", wDesc);
    }
  });

  it("falls back to the plain path when a large chat compacts below the threshold", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: buildMessages(250),
      });
    });
    await waitFor(() =>
      expect(
        screen
          .getByTestId("messages-container")
          .querySelector(".virtual-spacer"),
      ).not.toBeNull(),
    );

    // Compaction replaces the list with a small summary.
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("继续", "u0"),
          MockDataGenerator.createAssistantMessage("已压缩", "c1"),
        ],
      });
    });
    await waitFor(() => {
      const container = screen.getByTestId("messages-container");
      expect(container.classList.contains("messages-container--virtual")).toBe(
        false,
      );
      expect(container.querySelector(".assistant-group")).not.toBeNull();
    });
  });
});
