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
import type { Message } from "wave-agent-sdk";

/**
 * MessageList roving focus circle (spec: message-rendering-system.md
 * 「消息列表键盘焦点圈」). The list is a single Tab stop: every focusable
 * inside a message row is frozen to tabIndex -1 until the user activates a
 * row with Enter; ArrowUp/Down move the selection while the container is
 * focused; Escape returns from an activated row.
 */
describe("MessageList roving focus circle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Messages whose text carries a bare URL, which renders as a focusable
  // `<a href>` inside the row (marked GFM autolink; user-message text is
  // plain text and does NOT linkify, so assistant rows are used throughout).
  const urlMessages = (): Message[] => [
    MockDataGenerator.createAssistantMessage(
      "回答一 https://example.com/a1",
      "a1",
    ),
    MockDataGenerator.createAssistantMessage(
      "回答二 https://example.com/a2",
      "a2",
    ),
    MockDataGenerator.createAssistantMessage(
      "回答三 https://example.com/a3",
      "a3",
    ),
  ];

  const renderList = async (messages: Message[]) => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    const container = screen.getByTestId("messages-container");
    await waitFor(() =>
      expect(container.querySelectorAll(".virtual-row").length).toBe(
        messages.length,
      ),
    );
    return container;
  };

  const links = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>("a[href]"));

  it("is a single Tab stop: container focusable, inner focusables frozen", async () => {
    const container = await renderList(urlMessages());
    expect(container.tabIndex).toBe(0);
    expect(links(container).length).toBeGreaterThan(0);
    // Not activated: every inner link is out of the Tab order.
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
  });

  it("focusing the container selects the last message", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    expect(document.activeElement).toBe(container);
    const selected = container.querySelector(".virtual-row.roving-selected");
    expect(selected).not.toBeNull();
    expect(selected?.getAttribute("data-index")).toBe("2");
  });

  it("ArrowUp/ArrowDown move the selection, ArrowUp clamps at the first row", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    expect(
      container
        .querySelector(".virtual-row.roving-selected")
        ?.getAttribute("data-index"),
    ).toBe("1");
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    expect(
      container
        .querySelector(".virtual-row.roving-selected")
        ?.getAttribute("data-index"),
    ).toBe("0");
    // Still frozen — selection alone never unfreezes inner focusables.
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
  });

  it("Enter activates the row: only its inner focusables become tabbable", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // The activated row's first link holds focus and is tabbable...
    const row2 = container.querySelector(
      '.virtual-row[data-index="2"]',
    ) as HTMLElement;
    const row2Links = Array.from(row2.querySelectorAll<HTMLElement>("a[href]"));
    expect(row2Links.length).toBeGreaterThan(0);
    row2Links.forEach((a) => expect(a.tabIndex).toBe(0));
    expect(document.activeElement).toBe(row2Links[0]);
    // ...while the other rows stay frozen.
    const otherLinks = links(container).filter((a) => !row2.contains(a));
    otherLinks.forEach((a) => expect(a.tabIndex).toBe(-1));
  });

  it("Tab on the activated row's last inner focusable returns to the list selector", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    const row2 = container.querySelector(
      '.virtual-row[data-index="2"]',
    ) as HTMLElement;
    const row2Links = Array.from(row2.querySelectorAll<HTMLElement>("a[href]"));
    act(() => {
      fireEvent.keyDown(row2Links[row2Links.length - 1], { key: "Tab" });
    });
    expect(document.activeElement).toBe(container);
  });

  it("Escape returns to the list selector and re-freezes the row", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    const row2 = container.querySelector(
      '.virtual-row[data-index="2"]',
    ) as HTMLElement;
    const row2Links = Array.from(row2.querySelectorAll<HTMLElement>("a[href]"));
    act(() => {
      fireEvent.keyDown(row2Links[0], { key: "Escape" });
    });
    expect(document.activeElement).toBe(container);
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
  });

  it("focus leaving the container deactivates and re-freezes everything", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    act(() => {
      fireEvent.blur(container, { relatedTarget: document.body });
    });
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
  });
});
