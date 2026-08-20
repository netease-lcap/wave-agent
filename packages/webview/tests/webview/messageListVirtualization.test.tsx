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
 * Virtualized MessageList (every message renders through the virtualizer).
 *
 * jsdom cannot do layout, so geometry assertions (spacer height, scroll
 * pinning, bounded row counts in a real viewport) live in the Playwright demo
 * harness (e2e/virtual-message-list.e2e.ts). tests/setup.ts stubs a fixed
 * 600x800 viewport so the virtualizer's window math produces rows. Here we pin
 * the structural contract: rows are message-granularity with timeline run
 * classes, the DOM row count stays bounded (never all messages), and small
 * lists (below the visible window + overscan) render every row.
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

  it("renders small chats as bounded virtual rows (no plain path anymore)", async () => {
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
      true,
    );
    // All 10 rows fit in the stubbed 600px viewport + overscan, so every
    // message renders (as virtual rows).
    const rows = container.querySelectorAll(".virtual-row");
    expect(rows.length).toBe(10);
    expect(container.querySelector(".virtual-spacer")).not.toBeNull();
    // The plain path's assistant-group wrapper no longer exists.
    expect(container.querySelector(".assistant-group")).toBeNull();
  });

  it("virtualizes large message lists with bounded DOM rows", async () => {
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
  });

  it("stays virtualized when a large chat compacts below the viewport", async () => {
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

    // Compaction replaces the list with a small summary; the virtualized
    // branch stays and renders both messages.
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
        true,
      );
      expect(container.querySelectorAll(".virtual-row").length).toBe(2);
    });
  });
});
