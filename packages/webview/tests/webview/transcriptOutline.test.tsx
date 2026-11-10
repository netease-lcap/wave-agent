import { describe, it, expect, afterEach, vi } from "vitest";
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
import { MockDataGenerator } from "../fixtures/mockData";
import {
  outlineGap,
  shouldShowOutline,
  OUTLINE_GAP_MAX_PX,
  OUTLINE_GAP_MIN_PX,
  OUTLINE_MIN_GUTTER_PX,
} from "../../src/utils/transcriptOutline";
import type { Message } from "wave-agent-sdk/types";

/**
 * 会话消息大纲（spec ui/transcript-outline.md）。
 *
 * 几何部分（间距/隐藏阈值）是纯函数，直接钉；结构性契约（刻度数、预览卡、
 * 点击跳转、注入消息不建刻度）在这里断。刻度的像素位置与宽度留给 e2e ——
 * 这里只断言「有没有、点了会不会滚」。
 */
afterEach(() => {
  vi.restoreAllMocks();
});

const round = (question: string, answer: string, i: number): Message[] => [
  MockDataGenerator.createUserMessage(question, `u${i}`),
  MockDataGenerator.createAssistantMessage(answer, `a${i}`),
];

const rounds = (count: number): Message[] =>
  Array.from({ length: count }, (_, i) =>
    round(`问题 ${i}`, `回答 ${i}`, i),
  ).flat();

/**
 * 大纲的「当前这一轮」。
 *
 * 语义始终挂在 `aria-current` 上（读屏要靠它），但那条深色**只在操作期画**
 * ——静止的一列短横上留一笔深色会被读成「被选中的东西」（1110 第 15 轮）。
 * 所以「高亮是谁」这类断言读 `aria-current`，视觉那笔另用一条用例断。
 */
const currentTick = (): HTMLElement | null =>
  document.querySelector('[data-testid="outline-tick"][aria-current="true"]');

describe("transcriptOutline geometry", () => {
  it("needs at least two user messages", () => {
    expect(shouldShowOutline(800, 200, 0)).toBe(false);
    expect(shouldShowOutline(800, 200, 1)).toBe(false);
    expect(shouldShowOutline(800, 200, 2)).toBe(true);
  });

  it("needs the gutter left of the message column", () => {
    // 留白不够（列还没撑满最大宽度、或窗口只比列宽一点点）：整体不显示。
    expect(shouldShowOutline(800, 0, 5)).toBe(false);
    expect(shouldShowOutline(800, OUTLINE_MIN_GUTTER_PX - 1, 5)).toBe(false);
    expect(shouldShowOutline(800, OUTLINE_MIN_GUTTER_PX, 5)).toBe(true);
    expect(shouldShowOutline(800, 200, 5)).toBe(true);
    // 0 = 还没量到列宽：宁可先画一次，也不要因为测量缺失就永远不出现。
    expect(shouldShowOutline(0, 0, 5)).toBe(true);
  });

  it("caps the gap for short conversations", () => {
    expect(outlineGap(3, 800)).toBe(OUTLINE_GAP_MAX_PX);
  });

  it("compresses the gap as items grow and stops at the floor", () => {
    expect(outlineGap(10, 800)).toBe(OUTLINE_GAP_MAX_PX);
    expect(outlineGap(40, 800)).toBeLessThan(OUTLINE_GAP_MAX_PX);
    expect(outlineGap(400, 800)).toBe(OUTLINE_GAP_MIN_PX);
  });
});

describe("transcript outline", () => {
  /**
   * 大纲的显隐判据是「内容列左侧的留白够不够」，而真浏览器里这份留白本来就
   * 存在（1280 宽的窗口里居中放一个 800 宽的列）。只有「窗口不比列宽出多少」
   * 这条路需要造一副几何：把两个盒子换成指定宽度的假 rect。
   */
  function stubColumnGeometry(containerWidth = 1200, columnWidth = 800): void {
    const rect = (left: number, width: number): DOMRect =>
      ({
        x: left,
        y: 0,
        left,
        top: 0,
        width,
        height: 600,
        right: left + width,
        bottom: 600,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        if (this.id === "messagesContainer") return rect(0, containerWidth);
        if (this.classList.contains("messages-column")) {
          return rect((containerWidth - columnWidth) / 2, columnWidth);
        }
        return rect(0, 0);
      },
    );
  }

  it("renders one tick per user message", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(3) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("outline-tick")).toHaveLength(3);
  });

  it("stays hidden with a single user message", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(1) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("transcript-outline")).toBeNull();
  });

  it("stays hidden while the window is no wider than the column", async () => {
    // 820 宽的窗口上放 800 宽的列：左侧留白 10px，放不下目录与正文的间距。
    stubColumnGeometry(820, 800);
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(3) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("messages-container")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("transcript-outline")).toBeNull();
  });

  it("does not build ticks for injected meta user messages", async () => {
    const messages = [
      ...rounds(2),
      {
        ...MockDataGenerator.createUserMessage("规则注入", "meta1"),
        isMeta: true,
      } as Message,
    ];
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId("outline-tick")).toHaveLength(2);
  });

  it("shows the question on hover, without the assistant reply", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(3) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const ticks = screen.getAllByTestId("outline-tick");

    fireEvent.mouseEnter(ticks[1]);
    const card = screen.getByTestId("outline-card");
    // 卡片里只有这一条用户消息，不带助手回答（spec 场景 5）。
    expect(card).toHaveTextContent("问题 1");
    expect(card).not.toHaveTextContent("回答 1");

    fireEvent.mouseLeave(ticks[1]);
    expect(screen.queryByTestId("outline-card")).toBeNull();
  });

  it("scrolls the list to the clicked round", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    // 视口高度来自列表外面的布局：不钉一个，六轮内容撑不开容器，点了也不会滚。
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );
    const ticks = screen.getAllByTestId("outline-tick");

    fireEvent.click(ticks[4]);
    await waitFor(() => expect(container.scrollTop).toBeGreaterThan(0));
  });

  it("marks the round whose question is the topmost one on screen", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );

    // 「问题 1」压到折线以上但仍留在视口里：它就是屏幕上最靠上的那条用户消息，
    // 大纲的当前项必须是它（判据见 spec 场景 4：可见优先，而不是「滚出顶部的
    // 最近一条」）。落点由真实行高算出，不假设「一轮多高」。
    await scrollRowAboveFold(container, "u1");

    await waitFor(() => {
      expect(currentTick()?.getAttribute("aria-label")).toBe("问题 1");
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "问题 1",
      );
    });
  });

  it("marks the clicked tick, not the round before it", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );
    const ticks = screen.getAllByTestId("outline-tick");

    // 落位把目标放在视口中间，上一轮的问题此时往往还在视口里 —— 光靠可见判据
    // 算出来的会是上一轮。点击是显式意图，被点的那一条必须自己成为当前项（场景 6）。
    fireEvent.click(ticks[4]);
    await waitFor(() => expect(container.scrollTop).toBeGreaterThan(0));
    await waitFor(() => {
      expect(currentTick()?.getAttribute("aria-label")).toBe("问题 4");
    });
  });

  it("hands the judgement back to the scroll position once the reader scrolls", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );
    const ticks = screen.getAllByTestId("outline-tick");
    fireEvent.click(ticks[4]);
    await waitFor(() =>
      expect(currentTick()?.getAttribute("aria-label")).toBe("问题 4"),
    );

    // 用户再滚一次（这里滚回顶部）：钉住释放，当前项回到滚动判据 —— 屏幕上是
    // 「问题 0」，它就该是当前项。
    act(() => {
      container.scrollTop = 0;
      fireEvent.scroll(container);
    });
    await waitFor(() =>
      expect(currentTick()?.getAttribute("aria-label")).toBe("问题 0"),
    );
  });

  it("marks no round when no question is on screen", async () => {
    // 一轮带大段工具输出式的长回答：滚进它的正文中间时，屏里一条用户消息都
    // 没有，此时不得高亮任何刻度（也不退回吸顶那条）。
    const messages = [
      MockDataGenerator.createUserMessage("问题 0", "u0"),
      MockDataGenerator.createAssistantMessage(
        "很长的回答。".repeat(400),
        "a0",
      ),
      MockDataGenerator.createUserMessage("问题 1", "u1"),
      MockDataGenerator.createAssistantMessage("回答 1", "a1"),
    ];
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );

    // 先确认顶部确实标着「问题 0」，再滚进长回答中间，避免「一上来就没当前项」
    // 这种状态下测试假绿。
    await scrollRowAboveFold(container, "u0", 8);
    await waitFor(() =>
      expect(currentTick()?.getAttribute("aria-label")).toBe("问题 0"),
    );

    await scrollRowAboveFold(container, "a0", 200);
    await waitFor(() => expect(currentTick()).toBeNull());
  });

  it("only paints the current tick while the pointer is on the rail", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = pinMessageListViewport(
      screen.getByTestId("messages-container"),
      200,
    );
    await scrollRowAboveFold(container, "u1");

    await waitFor(() => expect(currentTick()).not.toBeNull());
    // 静止态整列不画那一笔深色：一列短横里单独一条深色会被读成「被选中的东西」。
    expect(document.querySelector(".outline-tick--active")).toBeNull();

    // 指针进到刻度列里才画出来。
    fireEvent.mouseEnter(currentTick()!);
    await waitFor(() =>
      expect(currentTick()!.className).toContain("outline-tick--active"),
    );

    // 离开整列（容器的 mouseleave）才收回：指针跨过两条刻度之间的缝不能让它闪。
    fireEvent.mouseLeave(
      screen.getByTestId("transcript-outline").querySelector(".outline-ticks")!,
    );
    await waitFor(() =>
      expect(document.querySelector(".outline-tick--active")).toBeNull(),
    );
  });
});
