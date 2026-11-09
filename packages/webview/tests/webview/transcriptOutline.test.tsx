import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireEvent,
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
 * 点击跳转、注入消息不建刻度）走 jsdom。刻度在真实排版里的位置与宽度留给
 * e2e ——jsdom 不做布局，这里只能断言「有没有、点了会不会滚」。
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

describe("transcript outline (jsdom)", () => {
  /**
   * jsdom 不做排版，`getBoundingClientRect` 恒返回全 0 —— 而大纲的显隐判据正是
   * 「内容列左侧的留白够不够」，全 0 等于「窗口和列一样宽」，大纲会正确地不
   * 显示。所以这里给两个盒子造一份几何：`containerWidth` 宽的滚动面上居中放
   * 一个 `columnWidth` 宽的列，其余元素维持 jsdom 的 0。
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

  beforeEach(() => stubColumnGeometry());

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
    const container = screen.getByTestId("messages-container");
    const ticks = screen.getAllByTestId("outline-tick");

    fireEvent.click(ticks[4]);
    await waitFor(() => expect(container.scrollTop).toBeGreaterThan(0));
  });

  it("highlights the round the sticky bar is showing", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateMessages", { messages: rounds(6) });
    });
    await waitFor(() =>
      expect(screen.getByTestId("transcript-outline")).toBeInTheDocument(),
    );
    const container = screen.getByTestId("messages-container");

    act(() => {
      container.scrollTop = 300;
      fireEvent.scroll(container);
    });

    await waitFor(() => {
      const active = document.querySelector(".outline-tick--active");
      expect(active).not.toBeNull();
      // 与吸顶条同一个候选：大纲的当前项必须就是吸顶条显示的那条消息。
      expect(active?.getAttribute("aria-label")).toBe("问题 1");
      expect(screen.getByTestId("sticky-user-message")).toHaveTextContent(
        "问题 1",
      );
    });
  });
});
