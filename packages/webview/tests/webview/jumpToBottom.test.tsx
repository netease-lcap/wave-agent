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
import { MockDataGenerator } from "../fixtures/mockData";

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

  /**
   * 聚焦视图里把展开的一轮收起，会把内容从「高过一屏」压回「一屏之内」。
   * 这一下 `scrollTop` 一动不动（浏览器没有可夹的量 ⇒ 不派发 scroll 事件），
   * 显隐若只跟着 scroll / 内容变化走，上一帧算出的「显示」就会一直挂着；而那颗
   * 按钮是 sticky 在内容列末尾的，内容一矮就贴到折叠后的内容上 —— 用户报障：
   * 「收起时那个 loading 图标被带到折叠态里，大概一秒钟后才消失」。账本一变
   * （行高从一大截压成一行）就得在同一帧里重新对一次账。
   */
  it("收起的这一轮把内容压回一屏内时，入口当场收回而不是等下一个事件", async () => {
    window.localStorage.setItem("wave.chat.focusView", "1");
    try {
      renderChatApp();
      act(() => {
        sendCommand("updateMessages", {
          messages: [
            MockDataGenerator.createUserMessage("问题", "u1"),
            MockDataGenerator.createAssistantMessage(tallText(40), "a1"),
            MockDataGenerator.createAssistantMessageWithTool(
              "",
              "Read",
              "{}",
              "文件内容",
            ),
            MockDataGenerator.createAssistantMessage("答复", "a3"),
          ],
        });
      });

      // 展开这一轮：内容高过一屏，入口才有出现的余地。
      act(() => {
        fireEvent.click(screen.getByTestId("focus-fold-head"));
      });
      await waitFor(() =>
        expect(screen.getByTestId("focus-fold-body")).toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          container().scrollHeight - container().clientHeight,
        ).toBeGreaterThan(800),
      );

      // 停在内容最顶上：离末尾很远 ⇒ 入口出现；收起后 scrollTop 仍是 0，
      // 浏览器没有可夹的量，所以整件事里一个 scroll 事件都不会有。
      act(() => {
        const c = container();
        c.scrollTop = 0;
        fireEvent.scroll(c);
      });
      await waitFor(() =>
        expect(jumpButton()).toHaveAttribute("aria-hidden", "false"),
      );

      act(() => {
        fireEvent.click(screen.getByTestId("focus-fold-head"));
      });
      await waitFor(() =>
        expect(
          container().scrollHeight - container().clientHeight,
        ).toBeLessThanOrEqual(0),
      );

      // 内容已经装进一屏：没有「更后面的内容」可回，入口必须已经收回 ——
      // 没跟上账本的话它会一直挂着（sticky 到折叠后的内容末尾）。
      expect(jumpButton()).toHaveAttribute("aria-hidden", "true");
    } finally {
      window.localStorage.clear();
    }
  });

  it("还没有消息时不渲染入口", () => {
    renderChatApp();
    expect(screen.queryByTestId("jump-to-bottom")).not.toBeInTheDocument();
  });
});
