import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
  pinMessageListViewport,
  scrollRowAboveFold,
} from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

// A user-role row that renders but carries NO text block (here a notice line, the
// one non-text block that still produces a row — a `task_notification` one is
// filtered out of the list entirely, see `rendersNothing`). It must never become
// the sticky candidate, and scrolling past it must not clear the bar.
const textlessMsg = (id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [
    { type: "notice" as const, level: "info" as const, content: "🔄 第 3 轮" },
  ],
});

/**
 * The viewport the list scrolls in.
 *
 * The app chrome around the list is not what these cases are about — pin a
 * small one so a handful of messages already overflow it. The sticky
 * computation only reads `scrollTop` against the row offsets, so how tall the
 * window is changes nothing but how much filler a case needs below its target.
 */
const VIEWPORT_HEIGHT = 200;

function showList(): HTMLElement {
  return pinMessageListViewport(
    screen.getByTestId("messages-container"),
    VIEWPORT_HEIGHT,
  );
}

/**
 * Trailing messages. Scrolling a row above the fold only stays put when there
 * is something below it to fill the rest of the viewport — otherwise the write
 * is clamped and the row never crosses the fold at all.
 */
const filler = (count: number): ReturnType<typeof userMsg>[] =>
  Array.from({ length: count }, (_, i) => userMsg(`充实内容 ${i}`, `f${i}`));

describe("sticky user message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has no sticky header before scrolling", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("第一条问题", "u1")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("sticky-user-message")).not.toBeInTheDocument();
  });

  it("pins the most recent user message scrolled above the viewport top", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
          ...filler(4),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // 第三条的上沿压到折线之上：前两条早已在折线以上，候选就是"最后一个在
    // 折线之上的用户消息"——第三条。
    const container = showList();
    await scrollRowAboveFold(container, "u3");

    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第三条问题",
      );
    });
  });

  it("switches the pinned message as scroll position changes", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
          ...filler(4),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // 只把第二条压过折线：第三条还在视口里（折线以下），候选是第二条。
    const container = showList();
    await scrollRowAboveFold(container, "u2");
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第二条问题",
      );
    });
  });

  it("clicking the sticky header scrolls the original message to the viewport center", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: Array.from({ length: 20 }, (_, i) =>
          userMsg(`问题 ${i}`, `u${i}`),
        ),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    const container = showList();
    const row = await scrollRowAboveFold(container, "u3");
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "问题 3",
      ),
    );

    // 跳转走 `container.scrollTo`：让它真滚（spy 只是旁听），然后把结论读成
    // 「那条消息是不是落到了视口中间」——比断言一个算出来的像素值更像用户看到
    // 的东西。
    const scrollTo = vi.spyOn(Element.prototype, "scrollTo");
    act(() => {
      fireEvent.click(screen.getByTestId("sticky-user-message"));
    });

    const target = scrollTo.mock.calls[0]?.[0] as ScrollToOptions;
    // 瞬时落位，不是平滑：平滑跳转逐帧推进期间，进入视口的行会被首次测量，
    // 虚拟列表的尺寸补偿会把它拽回记录中的偏移（仍是底部）从而取消跳转
    // ——流式时表现为「点了吸顶条没反应」。见 MessageList.scrollToMessage。
    expect(target.behavior).toBe("auto");

    await waitFor(() => {
      const viewport = container.getBoundingClientRect();
      const rect = row.getBoundingClientRect();
      // 容差来自账面行高与实测行高的估算差：居中落点用的是账本里的尺寸。
      expect(
        Math.abs(
          rect.top + rect.height / 2 - (viewport.top + viewport.height / 2),
        ),
      ).toBeLessThan(12);
    });
  });

  it("renders sticky content with the 3-line clamp class", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          ...filler(4),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    const container = showList();
    await scrollRowAboveFold(container, "u2");
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );
    expect(document.querySelector(".sticky-user-content")).toBeInTheDocument();
  });

  it("keeps the bar when a text-less user message scrolls past", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          textlessMsg("n3"),
          userMsg("第四条问题", "u4"),
          ...filler(4),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // 没有正文的那一行压过折线时，吸顶条必须停在它上面最近的一条有正文的
    // 用户消息（第二条），而不是整条消失（回归：以前会清空吸顶状态）。
    const container = showList();
    await scrollRowAboveFold(container, "n3");
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第二条问题",
      );
    });

    // 有正文的第四条也压过折线后，候选换成它。
    await scrollRowAboveFold(container, "u4");
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第四条问题",
      );
    });
  });

  it("keeps the bar when the last user message has no text", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          textlessMsg("n2"),
          userMsg("第三条问题", "u3"),
          ...filler(4),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // 第三条压过折线后，候选是它自己；中间那条没有正文的第二条从来不是候选。
    const container = showList();
    await scrollRowAboveFold(container, "u3");
    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第三条问题",
      );
    });
  });

  it("renders no bar at all when the list holds no user message", async () => {
    // 压缩点可以落在一轮对话的中间（会话首条是注入的系统消息时更是如此）：
    // 这份列表里没有任何能挂的锚点。此时吸顶条整条不渲染，也不留一行「没有更早」
    // 之类的占位——读者看到的就是一段没有问题的回答。
    const assistantMsg = (content: string, id: string) => ({
      id,
      role: "assistant" as const,
      timestamp: "2025-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content }],
    });
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: Array.from({ length: 10 }, (_, i) =>
          assistantMsg(`工具阶段 ${i}`, `a${i}`),
        ),
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    const container = showList();
    act(() => {
      // 滚到内容末尾：视口顶落在列表中间，若吸顶逻辑认错了行这里就会露出来。
      container.scrollTop = container.scrollHeight;
      fireEvent.scroll(container);
    });
    await waitFor(() => expect(container.scrollTop).toBeGreaterThan(0));
    expect(screen.queryByTestId("sticky-user-message")).toBeNull();
    expect(document.querySelector(".sticky-user-wrapper")).toBeNull();
  });
});
