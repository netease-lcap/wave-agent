import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";

const userMsg = (content: string, id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

// A background task notification: user role but NO text block, so it renders
// no .user-content and must never become the sticky candidate.
const notifMsg = (id: string) => ({
  id,
  role: "user" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [
    {
      type: "task_notification" as const,
      taskId: "task_1",
      taskType: "shell" as const,
      status: "completed" as const,
      summary: "Command completed with exit code 0",
      outputFile: "/tmp/task.log",
    },
  ],
});

/**
 * The sticky candidate is computed from the virtualizer's offset table (see
 * computeSticky): rows are estimated at 600px (the stubbed jsdom viewport
 * height) plus a 10px paddingStart, so message N occupies
 * [10 + N*600, 610 + N*600). Fake the container geometry, set scrollTop into
 * the middle of a row, then dispatch a scroll event so both the virtualizer
 * and MessageList's handler recompute.
 */
function fakeGeometryAndScroll(scrollTop: number) {
  const container = screen.getByTestId("messages-container");
  Object.defineProperty(container, "scrollTop", {
    value: scrollTop,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: 400,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", {
    value: 2000,
    configurable: true,
    writable: true,
  });
  act(() => {
    fireEvent.scroll(container);
  });
}

describe("sticky user message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 1300 → u3 (1210..1810) is at the viewport top; u1 (10..610)
    // and u2 (610..1210) are above the fold; the last one above is u3.
    fakeGeometryAndScroll(1300);

    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument();
    });
    expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
      "第三条问题",
    );
  });

  it("switches the pinned message as scroll position changes", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          userMsg("第三条问题", "u3"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 700 → u2 (610..1210) tops the viewport; u1 is above the fold,
    // u3 is below it → the candidate is u2.
    fakeGeometryAndScroll(700);
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
        messages: [userMsg("第一条问题", "u1"), userMsg("第二条问题", "u2")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    fakeGeometryAndScroll(700);
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );

    // The virtualizer's scrollToFn calls Element.scrollTo (polyfilled in
    // tests/setup.ts); replace it with a spy to observe the jump.
    const scrollTo = vi.fn();
    window.Element.prototype.scrollTo = scrollTo;
    act(() => {
      fireEvent.click(screen.getByTestId("sticky-user-message"));
    });
    expect(scrollTo).toHaveBeenCalledWith({
      top: 610, // u2 start 610 + (600 - viewport 600) / 2 = 610
      // 瞬时落位，不是平滑：平滑跳转逐帧推进期间，进入视口的行会被首次测量，
      // 虚拟列表的尺寸补偿会把它拽回记录中的偏移（仍是底部）从而取消跳转
      // ——流式时表现为「点了吸顶条没反应」。见 MessageList.scrollToMessage。
      behavior: "auto",
    });
  });

  it("renders sticky content with the 3-line clamp class", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [userMsg("第一条问题", "u1"), userMsg("第二条问题", "u2")],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    fakeGeometryAndScroll(700);
    await waitFor(() =>
      expect(screen.getByTestId("sticky-user-message")).toBeInTheDocument(),
    );
    expect(document.querySelector(".sticky-user-content")).toBeInTheDocument();
  });

  it("keeps the bar when a text-less notification user message scrolls past", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("第一条问题", "u1"),
          userMsg("第二条问题", "u2"),
          notifMsg("n3"),
          userMsg("第四条问题", "u4"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 1300 → u1 (10..610), u2 (610..1210) are above the fold and n3
    // (1210..1810) tops the viewport; the notification has no text, so the bar
    // must stay on u2 ("第二条问题") instead of vanishing (regression: it used
    // to clear the sticky state).
    fakeGeometryAndScroll(1300);

    await waitFor(() => {
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "第二条问题",
      );
    });

    // Once the text-bearing u4 (1810..2410) also scrolls past, it becomes the
    // candidate.
    fakeGeometryAndScroll(1900);
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
          notifMsg("n2"),
          userMsg("第三条问题", "u3"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    // scrollTop 1300 → u1 (10..610) and n2 (610..1210) are above the fold, u3
    // (1210..1810) tops the viewport; the newest text-bearing user is u3.
    fakeGeometryAndScroll(1300);
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
        messages: [
          assistantMsg("工具阶段 0", "a0"),
          assistantMsg("工具阶段 1", "a1"),
          assistantMsg("工具阶段 2", "a2"),
        ],
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );

    fakeGeometryAndScroll(1300);
    expect(screen.queryByTestId("sticky-user-message")).toBeNull();
    expect(document.querySelector(".sticky-user-wrapper")).toBeNull();
  });
});
