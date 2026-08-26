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

  it("Tab on the activated row's last inner focusable returns to the list selector and deactivates the row", async () => {
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
    // Returning to the selector deactivates the row: its inner focusables are
    // frozen again, so the next Tab leaves the list instead of re-entering it.
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
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

  it("focus re-entering the container (Tab/click) deactivates a leftover active row", async () => {
    const container = await renderList(urlMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // The active row's links are tabbable while focus stays inside the row.
    const row2 = container.querySelector(
      '.virtual-row[data-index="2"]',
    ) as HTMLElement;
    const row2Links = Array.from(row2.querySelectorAll<HTMLElement>("a[href]"));
    expect(row2Links[0].tabIndex).toBe(0);
    // Focus returns to the selector itself (e.g. the user clicks it): the
    // leftover activation is cleared so Tab cannot walk back into the row.
    act(() => {
      container.focus();
    });
    expect(document.activeElement).toBe(container);
    links(container).forEach((a) => expect(a.tabIndex).toBe(-1));
  });

  // ---- Scrollable markdown containers (pre / wide-table wrapper) ----
  // The markdown renderer (Message.tsx) emits tabindex="0" on fenced code
  // blocks (<pre>, overflow-x: auto) and on the wrapper div of GFM tables
  // (.markdown-table-wrapper, overflow-x: auto), so both enter the roving
  // focus circle via the [tabindex] branch of FOCUSABLE_SELECTOR — an
  // activated row can Tab to them and scroll the overflow horizontally.
  // The last row is code-only: initial selection (last row) activates it.
  const scrollableMessages = (): Message[] => [
    MockDataGenerator.createAssistantMessage(
      "| a | b |\n|---|---|\n| 1 | 2 |",
      "table-only",
    ),
    MockDataGenerator.createAssistantMessage(
      "回答 https://example.com/a2\n\n```ts\nconst y = 2;\n```",
      "code-and-link",
    ),
    MockDataGenerator.createAssistantMessage(
      "```ts\nconst x = 1;\n```",
      "code-only",
    ),
  ];

  const pres = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(".markdown-content pre"),
    );
  const tableWrappers = (container: HTMLElement) =>
    Array.from(
      container.querySelectorAll<HTMLElement>(".markdown-table-wrapper"),
    );

  it("pre and table wrappers carry tabindex=0 and are frozen before activation", async () => {
    const container = await renderList(scrollableMessages());
    const pre = pres(container)[0];
    const wrapper = tableWrappers(container)[0];
    // The renderer emits a DOM tabindex="0" attribute (not CSS); applyRoving
    // picked both up via the [tabindex] branch of FOCUSABLE_SELECTOR and froze
    // them to -1 on mount — the freeze mutation is visible on the attribute.
    expect(pre.getAttribute("tabindex")).toBe("-1");
    expect(wrapper.getAttribute("tabindex")).toBe("-1");
    // Not activated: both are inside the single-Tab-stop circle and frozen.
    expect(pre.tabIndex).toBe(-1);
    expect(wrapper.tabIndex).toBe(-1);
  });

  it("Enter activation restores tabindex 0 on the row's pre and focuses it when it is the row's only focusable", async () => {
    const container = await renderList(scrollableMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // The last row is the code-only row: its pre is the only inner focusable,
    // so activation focuses it directly.
    const row2 = container.querySelector(
      '.virtual-row[data-index="2"]',
    ) as HTMLElement;
    const row2Pre = row2.querySelector<HTMLElement>(".markdown-content pre");
    expect(row2Pre).not.toBeNull();
    expect(row2Pre?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(row2Pre);
    // The other rows' scroll containers stay frozen.
    const otherPres = pres(container).filter((p) => !row2.contains(p));
    otherPres.forEach((p) => expect(p.tabIndex).toBe(-1));
    const otherWrappers = tableWrappers(container).filter(
      (w) => !row2.contains(w),
    );
    otherWrappers.forEach((w) => expect(w.tabIndex).toBe(-1));
  });

  it("the pre joins the activated row's Tab cycle and is its last focusable", async () => {
    const container = await renderList(scrollableMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // Back to the selector (row 2 stays selected), move up to the
    // code-and-link row and activate it.
    act(() => {
      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "Escape",
      });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // The row carries a link followed by a code block: the focusable order is
    // [link, pre], so the pre is part of the Tab cycle and its last stop.
    const row1 = container.querySelector(
      '.virtual-row[data-index="1"]',
    ) as HTMLElement;
    const row1Focusables = Array.from(
      row1.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
      ),
    );
    const row1Pre = row1.querySelector<HTMLElement>(".markdown-content pre");
    expect(row1Pre).not.toBeNull();
    expect(row1Focusables[0]?.matches("a[href]")).toBe(true);
    expect(row1Focusables[row1Focusables.length - 1]).toBe(row1Pre);
    expect(row1Pre?.tabIndex).toBe(0);
    // Tab on the pre (the row's last focusable) returns to the list selector
    // and re-freezes the row's scroll container.
    act(() => {
      fireEvent.keyDown(row1Pre as HTMLElement, { key: "Tab" });
    });
    expect(document.activeElement).toBe(container);
    expect(row1Pre?.tabIndex).toBe(-1);
  });

  it("Tab (no shift) on the pre of a code-only row returns to the selector (pre is both first and last)", async () => {
    const container = await renderList(scrollableMessages());
    act(() => {
      container.focus();
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    // Enter already focused the code-only row's pre (see test above).
    const row2Pre = container.querySelector<HTMLElement>(
      '.virtual-row[data-index="2"] .markdown-content pre',
    );
    expect(document.activeElement).toBe(row2Pre);
    act(() => {
      fireEvent.keyDown(row2Pre as HTMLElement, { key: "Tab" });
    });
    expect(document.activeElement).toBe(container);
    expect((row2Pre as HTMLElement).tabIndex).toBe(-1);
  });

  it("a focused pre/table wrapper can be scrolled horizontally (scrollLeft)", async () => {
    const container = await renderList(scrollableMessages());
    act(() => {
      container.focus();
    });
    // Activate the code-only row (index 2): Enter focuses its pre.
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    const row2Pre = container.querySelector<HTMLElement>(
      '.virtual-row[data-index="2"] .markdown-content pre',
    );
    expect(document.activeElement).toBe(row2Pre);
    (row2Pre as HTMLElement).scrollLeft = 100;
    expect((row2Pre as HTMLElement).scrollLeft).toBe(100);
    // Back to the selector, move up twice to the table row (index 0) and
    // activate: the table wrapper is its only focusable and receives focus.
    act(() => {
      fireEvent.keyDown(document.activeElement as HTMLElement, {
        key: "Escape",
      });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "ArrowUp" });
    });
    act(() => {
      fireEvent.keyDown(container, { key: "Enter" });
    });
    const row0Wrapper = container.querySelector<HTMLElement>(
      '.virtual-row[data-index="0"] .markdown-table-wrapper',
    );
    expect(document.activeElement).toBe(row0Wrapper);
    (row0Wrapper as HTMLElement).scrollLeft = 40;
    expect((row0Wrapper as HTMLElement).scrollLeft).toBe(40);
  });
});
