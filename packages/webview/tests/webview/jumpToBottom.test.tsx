import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
  pinScrollBoxHeight,
} from "./test-utils";

/**
 * 一段真的能撑出溢出的正文：每段一行（markdown 渲染成多个段落）。虚拟列表的
 * `scrollHeight` 来自它自己的 spacer，所以要「内容比视口高」必须真的写这么长的
 * 内容，凑不出 0 也没法靠改属性假装。
 */
const tallText = (lines: number) =>
  Array.from(
    { length: lines },
    (_, i) => `第 ${i + 1} 行：一段用来撑出真实溢出的正文。`,
  ).join("\n\n");

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

/** 视口高度（`.messages-container` 在真布局里由外层聊天区给，测试里由我们给）。 */
const VIEWPORT = 400;
/** 300px 的差距不够：下面「距底 600 / 100」两条要留出不碰 200px 阈值的余量。 */
const OVERFLOW_PX = 1200;

let restoreLayout: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  // 高度必须在挂载前就位：列表在挂载效应里就会滚到底，挂上之后再钉就晚了。
  restoreLayout = pinScrollBoxHeight(".messages-container", VIEWPORT);
});

afterEach(() => {
  restoreLayout();
});

const container = () => screen.getByTestId("messages-container");

/**
 * 等容器真的溢出到有 `gap` 余地为止（行长从估算变实测要几帧）。没有这一步，
 * 「停在距底 600px」在短内容上会被浏览器夹回 0，用例就成了假绿。
 */
async function waitForOverflow(minOverflow = OVERFLOW_PX) {
  const c = container();
  await waitFor(() =>
    expect(c.scrollHeight - c.clientHeight).toBeGreaterThan(minOverflow),
  );
  return c;
}

/** 把视口停在「离内容末尾 gapPx」的位置：真滚动位置，夹取交给浏览器。 */
function parkAtGap(gapPx: number) {
  const c = container();
  const maxScroll = c.scrollHeight - c.clientHeight;
  expect(maxScroll).toBeGreaterThan(gapPx);
  act(() => {
    c.scrollTop = maxScroll - gapPx;
    fireEvent.scroll(c);
  });
}

const messages = (extended = false) => [
  userMsg("问题", "u1"),
  assistantMsg(tallText(20), "a1"),
  userMsg("追问", "u2"),
  assistantMsg(extended ? tallText(52) : tallText(40), "a2"),
];

async function renderWithMessages() {
  renderChatApp();
  act(() => {
    sendCommand("updateMessages", { messages: messages() });
  });
  const c = await waitForOverflow();
  // 程序性置底走的是 Element.scrollTo：实例级 spy（方法照常执行，滚动是真的），
  // 用来观察「有没有把视口写到底」。首屏那次自动置底已经过去了，不用清。
  const scrollTo = vi.spyOn(c, "scrollTo");
  return { container: c, scrollTo };
}

const jumpButton = () => screen.getByTestId("jump-to-bottom");

describe("回到最新入口", () => {
  it("视口离开底部 200px 以上时出现，滚回附近后收回", async () => {
    await renderWithMessages();

    // 距底 600px：出现，且可被 Tab 聚焦。（滚动侧的判定合并到下一帧）
    parkAtGap(600);
    await waitFor(() =>
      expect(jumpButton()).toHaveAttribute("aria-hidden", "false"),
    );
    expect(jumpButton()).toHaveAttribute("tabindex", "0");

    // 距底 100px：收回，且退出 Tab 序列。
    parkAtGap(100);
    await waitFor(() =>
      expect(jumpButton()).toHaveAttribute("aria-hidden", "true"),
    );
    expect(jumpButton()).toHaveAttribute("tabindex", "-1");
  });

  it("点击按钮回到真实底部并恢复跟随", async () => {
    const { container: c, scrollTo } = await renderWithMessages();

    parkAtGap(600);
    await waitFor(() =>
      expect(jumpButton()).toHaveAttribute("aria-hidden", "false"),
    );
    scrollTo.mockClear();

    act(() => {
      fireEvent.click(jumpButton());
    });
    // 滚到内容末尾（scrollHeight − clientHeight）：落点是真实排版量出来的值，
    // 断言「瞄准的就是内容底」而不是某个写死的数字。
    const calls = scrollTo.mock.calls;
    const target = calls[calls.length - 1]?.[0] as ScrollToOptions;
    const bottom = c.scrollHeight - c.clientHeight;
    expect(target.behavior).toBe("smooth");
    expect(Math.abs((target.top ?? 0) - bottom)).toBeLessThanOrEqual(2);

    // 跟随已恢复：新内容到达时视口继续被写到底部，而不是停在历史里。
    scrollTo.mockClear();
    act(() => {
      sendCommand("updateMessages", {
        messages: messages(true),
      });
    });
    expect(scrollTo).toHaveBeenCalled();
  });

  it("内容增长时按几何更新，不依赖 scroll 事件", async () => {
    await renderWithMessages();

    // 停在距底 100px：按钮还没出现。
    parkAtGap(100);
    expect(jumpButton()).toHaveAttribute("aria-hidden", "true");

    // 内容在下方继续长（流式追加），不派发任何 scroll 事件。
    act(() => {
      sendCommand("updateMessages", {
        messages: messages(true),
      });
    });

    expect(jumpButton()).toHaveAttribute("aria-hidden", "false");
  });

  it("还没有消息时不渲染入口", () => {
    renderChatApp();
    expect(screen.queryByTestId("jump-to-bottom")).not.toBeInTheDocument();
  });
});
