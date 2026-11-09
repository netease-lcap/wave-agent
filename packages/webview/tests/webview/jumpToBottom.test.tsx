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

const assistantMsg = (content: string, id: string) => ({
  id,
  role: "assistant" as const,
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content }],
});

const VIEWPORT = 400;

/**
 * jsdom 不排版，`scrollTop` / `clientHeight` / `scrollHeight` 全是 0。把几何量塞
 * 进容器（重定义属性）后，选择性地派发一次 `scroll`——「内容增长」那条路故意不
 * 派发，用来证明显隐不只靠滚动事件驱动。
 */
function setGeometry(
  scrollTop: number,
  scrollHeight: number,
  { dispatchScroll = true }: { dispatchScroll?: boolean } = {},
) {
  const container = screen.getByTestId("messages-container");
  Object.defineProperty(container, "scrollTop", {
    value: scrollTop,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "clientHeight", {
    value: VIEWPORT,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(container, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
    writable: true,
  });
  if (dispatchScroll) {
    act(() => {
      fireEvent.scroll(container);
    });
  }
}

async function renderWithMessages() {
  const scrollTo = vi.fn();
  window.Element.prototype.scrollTo = scrollTo;
  renderChatApp();
  act(() => {
    sendCommand("updateMessages", {
      messages: [
        userMsg("问题", "u1"),
        assistantMsg("正在回答", "a1"),
        userMsg("追问", "u2"),
        assistantMsg("继续回答", "a2"),
      ],
    });
  });
  await waitFor(() =>
    expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
  );
  // 首屏的自动置底会写一次视口，清掉它，后续断言只看用户动作触发的写入。
  scrollTo.mockClear();
  return scrollTo;
}

const jumpButton = () => screen.getByTestId("jump-to-bottom");

describe("回到最新入口", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("视口离开底部 200px 以上时出现，滚回附近后收回", async () => {
    await renderWithMessages();

    // 距底 600px：出现，且可被 Tab 聚焦。（滚动侧的判定合并到下一帧）
    setGeometry(1000, 2000);
    await waitFor(() =>
      expect(jumpButton()).toHaveAttribute("aria-hidden", "false"),
    );
    expect(jumpButton()).toHaveAttribute("tabindex", "0");

    // 距底 100px：收回，且退出 Tab 序列。
    setGeometry(1500, 2000);
    await waitFor(() =>
      expect(jumpButton()).toHaveAttribute("aria-hidden", "true"),
    );
    expect(jumpButton()).toHaveAttribute("tabindex", "-1");
  });

  it("点击按钮回到真实底部并恢复跟随", async () => {
    const scrollTo = await renderWithMessages();

    setGeometry(1000, 2000);
    scrollTo.mockClear();

    act(() => {
      fireEvent.click(jumpButton());
    });
    // 滚到内容末尾（scrollHeight − clientHeight）。
    expect(scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 1600 }),
    );

    // 跟随已恢复：新内容到达时视口继续被写到底部，而不是停在历史里。
    scrollTo.mockClear();
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答", "a1"),
          userMsg("追问", "u2"),
          assistantMsg("继续回答，并且多了一段", "a2"),
        ],
      });
    });
    expect(scrollTo).toHaveBeenCalled();
  });

  it("内容增长时按几何更新，不依赖 scroll 事件", async () => {
    await renderWithMessages();

    // 停在距底 100px：按钮还没出现。
    setGeometry(1500, 2000);
    expect(jumpButton()).toHaveAttribute("aria-hidden", "true");

    // 内容在下方继续长（流式追加），不派发任何 scroll 事件。
    setGeometry(1500, 2400, { dispatchScroll: false });
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          userMsg("问题", "u1"),
          assistantMsg("正在回答", "a1"),
          userMsg("追问", "u2"),
          assistantMsg("继续回答，突然又长了一大段", "a2"),
        ],
      });
    });
    expect(jumpButton()).toHaveAttribute("aria-hidden", "false");
  });

  it("还没有消息时不渲染入口", () => {
    renderChatApp();
    expect(screen.queryByTestId("jump-to-bottom")).not.toBeInTheDocument();
  });
});
