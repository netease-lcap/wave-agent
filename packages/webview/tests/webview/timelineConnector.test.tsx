/**
 * 时间线竖线的几何（设计稿：assistant 时间线竖线跨消息贯穿）。
 *
 * 每条消息渲染成一个虚拟行；连续的 assistant 消息构成一段 timeline run。圆点与
 * 竖线段都挂在消息根节点上（一条助手消息 = 一个 API 回合 = 一个点，见 spec
 * ui/message-rendering-system.md「时间线圆点按助手回合出现（行级）」）。这里量
 * `.timeline-run--start` 与 `.timeline-run--end` 两条消息的
 * `.message.timeline-message::after` 段是否能无缝相接成一根竖线，以及单点 run
 * （`.timeline-run--single`）不画线。
 *
 * 迁移自 `e2e/timeline-connector.e2e.ts`：pseudo 元素的 `getComputedStyle` 与
 * `getBoundingClientRect` 在真 Chromium 里都是原生的，本套件就跑在真 Chromium 里。
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
// 桌面档那条（圆点 12px、收尾段 21px）在 host-desktop.css 里，所有选择器都带
// `[data-host="desktop"]`。
import "../../src/styles/host-desktop.css";

/** `18px` → 18；`auto` 之类 → NaN。 */
const px = (value: string) => (value.endsWith("px") ? parseFloat(value) : NaN);

const text = (content: string) => ({ type: "text", content });

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  permissionMode: "default",
};

/**
 * 一轮「文本 + 运行中的 Bash」的助手消息：工具未收尾时这条消息末尾会挂上
 * 「把本轮转到后台」按钮（`.message-actions`），它也是 `.message` 的子元素。
 *
 * 前面垫一条纯文本助手消息（a1），让 a2 成为**多点 run 的末条**——收尾规则
 * （`--end` 那一段只画到圆点中心）就落在 a2 身上；单条消息自成一个单点 run，
 * 根本不画线，量不到收尾段。
 */
function injectRunningBashTurn() {
  renderChatApp();
  sendCommand("setInitialState", { ...initialState, isStreaming: true });
  sendCommand("updateMessages", {
    messages: [
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [text("推送镜像并部署。")],
      },
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.500Z",
        blocks: [text("先看一眼当前分支。")],
      },
      {
        id: "a2",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [
          text("我来推送镜像并部署。"),
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "running",
            parameters: JSON.stringify({ command: "docker push" }),
          },
        ],
      },
    ],
  });
  sendCommand("startStreaming");
}

/** 两帧：让 ResizeObserver 落地并完成定位。 */
const twoFrames = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );

afterEach(() => {
  delete document.documentElement.dataset.host;
  document.documentElement.removeAttribute("data-theme");
});

describe("时间线竖线几何", () => {
  it("多段 assistant run 的竖线贯穿；单点 run 不画线", async () => {
    renderChatApp();
    sendCommand("setInitialState", initialState);
    sendCommand("updateMessages", {
      messages: [
        {
          id: "a1",
          role: "assistant",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [text("First assistant message.")],
        },
        {
          id: "a2",
          role: "assistant",
          timestamp: "2025-07-09T10:30:01.000Z",
          blocks: [text("Second assistant message.")],
        },
        {
          id: "u1",
          role: "user",
          timestamp: "2025-07-09T10:30:02.000Z",
          blocks: [text("A follow-up question.")],
        },
        {
          id: "a3",
          role: "assistant",
          timestamp: "2025-07-09T10:30:03.000Z",
          blocks: [text("Third assistant message.")],
        },
      ],
    });
    sendCommand("endStreaming");

    await expect
      .poll(() => !!document.querySelector(".virtual-row.timeline-run--start"))
      .toBe(true);

    // Geometry probe: read each run message's ::after segment in document
    // coordinates; the run is flush (paddingBottom 0 inside the run), so the
    // segments must abut at the row boundary.
    const startRow = document.querySelector<HTMLElement>(
      ".virtual-row.timeline-run--start",
    )!;
    const endRow = document.querySelector<HTMLElement>(
      ".virtual-row.timeline-run--end",
    )!;
    const singleRow = document.querySelector<HTMLElement>(
      ".virtual-row.timeline-run--single",
    )!;

    const startMsg = startRow.querySelector<HTMLElement>(
      ".message.timeline-message",
    )!;
    const endMsg = endRow.querySelector<HTMLElement>(
      ".message.timeline-message",
    )!;
    const startRect = startMsg.getBoundingClientRect();
    const endRect = endMsg.getBoundingClientRect();

    const startAfter = getComputedStyle(startMsg, "::after");
    const endAfter = getComputedStyle(endMsg, "::after");

    // start message: line runs from its dot center (18px) to the message
    // bottom; end message: line runs from its top to its dot center.
    const seg1 = {
      start: startRect.top + px(startAfter.top),
      end: startRect.bottom,
      display: startAfter.display,
    };
    const seg2 = {
      start: endRect.top,
      end: endRect.top + px(endAfter.height),
      display: endAfter.display,
    };

    const firstDotCenter = startRect.top + 18;
    const lastDotCenter = endRect.top + 18;

    const singleAfter = getComputedStyle(
      singleRow.querySelector(".message.timeline-message") as HTMLElement,
      "::after",
    );

    const geo = {
      startId: startRow.getAttribute("data-measured-message-id"),
      endId: endRow.getAttribute("data-measured-message-id"),
      singleIsSingleClass: singleRow.classList.contains("timeline-run--single"),
      seg1,
      seg2,
      firstDotCenter,
      lastDotCenter,
      singleAfterDisplay: singleAfter.display,
    };

    // The run spans a1 → a2.
    expect(geo.startId).toBe("a1");
    expect(geo.endId).toBe("a2");

    // Every segment in the run is drawn (not display:none).
    expect(geo.seg1.display).not.toBe("none");
    expect(geo.seg2.display).not.toBe("none");

    // Segments abut seamlessly: seg1's end ≈ seg2's start (tolerance 1px).
    expect(Math.abs(geo.seg1.end - geo.seg2.start)).toBeLessThanOrEqual(1);

    // First segment starts at the first dot center (dot top 15 + radius 3 = 18px).
    expect(Math.abs(geo.seg1.start - geo.firstDotCenter)).toBeLessThanOrEqual(
      1,
    );

    // Last segment ends at the last dot center.
    expect(Math.abs(geo.seg2.end - geo.lastDotCenter)).toBeLessThanOrEqual(1);

    // The single-dot run draws no connecting line.
    expect(geo.singleIsSingleClass).toBe(true);
    expect(geo.singleAfterDisplay).toBe("none");
  });

  /**
   * 一条已经建出来、但还没有任何块的消息（流式刚开始那一刻，`blocks: []`）
   * 不能占位。
   *
   * codechat 网关上的 Claude 思考明文恒为空（只回 signature），流式期第一个
   * `thinking_delta` 是空串，SDK 于是在真内容到达前几百毫秒到几秒就先建出这条
   * 助手消息。它若渲染出空 `.message` 外壳：收尾规则（`--end` 那一段只画到圆点
   * 中心）落在它身上，而它没有圆点（`::after` 根本不存在），前一条真实消息于是
   * 保持全高线段——用户看到一条线一直连到列表底部、底部却没有块；那一行还占着
   * 行高与间距，底部凭空多出空白。
   */
  it("没有任何块的消息不占行，也不留悬空连线", async () => {
    renderChatApp();
    sendCommand("setInitialState", { ...initialState, isStreaming: true });
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [text("A question.")],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2025-07-09T10:30:01.000Z",
          blocks: [text("First assistant message.")],
        },
        {
          id: "a2",
          role: "assistant",
          timestamp: "2025-07-09T10:30:02.000Z",
          blocks: [text("Second assistant message.")],
        },
        {
          id: "blank",
          role: "assistant",
          timestamp: "2025-07-09T10:30:03.000Z",
          blocks: [],
        },
      ],
    });
    sendCommand("startStreaming");

    await expect
      .poll(() => !!document.querySelector(".virtual-row.timeline-run--end"))
      .toBe(true);

    const endRow = document.querySelector<HTMLElement>(
      ".virtual-row.timeline-run--end",
    )!;
    // 收尾类落在一个没有圆点的 `.message` 上时（本用例修的正是这个），这里读
    // 不到消息节点——用 null 兜住，让下面第一条断言报出「收尾落在谁身上」，而
    // 不是在探测里抛 TypeError。
    const endMessage = endRow.querySelector<HTMLElement>(
      ".message.timeline-message",
    );
    const after = endMessage ? getComputedStyle(endMessage, "::after") : null;
    const geo = {
      rowIds: Array.from(
        document.querySelectorAll<HTMLElement>("[data-measured-message-id]"),
      ).map((row) => row.getAttribute("data-measured-message-id")),
      endId: endRow.getAttribute("data-measured-message-id"),
      messageHeight: endMessage ? endMessage.getBoundingClientRect().height : 0,
      lastSegmentHeight: after ? px(after.height) : NaN,
    };

    // 空消息连虚拟行都不存在：既不占行高，也不占消息间的 14px 间距，更没有
    // `.message` 外壳。收尾落在最后一条真实消息上。
    expect(geo.rowIds).not.toContain("blank");
    expect(geo.endId).toBe("a2");
    // 收尾段只到圆点中心（base 档 18px），不会垂到消息底。
    expect(geo.lastSegmentHeight).toBeCloseTo(18, 0);
    expect(geo.lastSegmentHeight).toBeLessThan(geo.messageHeight);
  });

  /**
   * 一条消息**后加入**一段 run 时，连线不能断。
   *
   * run 的行间距（段内 0 / 段末 14px）是行自己的 padding-bottom，也就是行高的一
   * 部分：新消息一来，上一行从「段末」变成「段中」，padding 14→0、盒高跟着矮 14px。
   * 虚拟列表的 ResizeObserver 若只观测 content box，这次「只改 padding」的缩高
   * 一次都不回调 —— 账本留着旧值，新行按旧高定位，两行之间空出 14px，竖线就在那
   * 里断开（真机现象：盯着流式输出看会断，切到别的会话再切回来又好了，因为行重新
   * 挂载、重新量了一次）。这里断言的就是「账本跟上」后的几何。
   */
  it("加入已有 run 的行会让前一段的尾部重量一次", async () => {
    renderChatApp();
    sendCommand("setInitialState", initialState);
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [text("A question.")],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2025-07-09T10:30:01.000Z",
          blocks: [text("First assistant message.")],
        },
      ],
    });
    sendCommand("endStreaming");
    await expect
      .poll(() => !!document.querySelector(".virtual-row.timeline-run--single"))
      .toBe(true);

    // 追加一条：a1 从「单点 run」变成「run 的开头」。等两帧让 RO 落地并完成定位。
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [text("A question.")],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2025-07-09T10:30:01.000Z",
          blocks: [text("First assistant message.")],
        },
        {
          id: "a2",
          role: "assistant",
          timestamp: "2025-07-09T10:30:02.000Z",
          blocks: [text("Second assistant message.")],
        },
      ],
    });
    await expect
      .poll(() => !!document.querySelector(".virtual-row.timeline-run--end"))
      .toBe(true);
    await twoFrames();

    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".virtual-row.timeline-run--start, .virtual-row.timeline-run--end",
      ),
    );
    const first = rows[0].querySelector<HTMLElement>(
      ".message.timeline-message",
    )!;
    const second = rows[1].querySelector<HTMLElement>(
      ".message.timeline-message",
    )!;
    const firstRect = first.getBoundingClientRect();
    const secondRect = second.getBoundingClientRect();
    const startAfter = getComputedStyle(first, "::after");
    const endAfter = getComputedStyle(second, "::after");
    const gap = {
      segmentGap:
        secondRect.top +
        px(endAfter.top) -
        (firstRect.bottom - px(startAfter.bottom)),
      rowBoxGap:
        rows[1].getBoundingClientRect().top -
        rows[0].getBoundingClientRect().bottom,
      // 这两行是按账本绝对定位的，不是普通流式排布 —— 否则下面两条断言在任何
      // 实现下都成立（前提守卫，不是被测行为）。
      position: getComputedStyle(rows[0]).position,
    };

    expect(gap.position).toBe("absolute");
    // 行盒相切（账本跟上 DOM），连线两段相接。容差 1px：行高是取整后记进账本的。
    expect(Math.abs(gap.rowBoxGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap.segmentGap)).toBeLessThanOrEqual(1);
  });

  /**
   * 「把本轮转到后台」按钮不能改变收尾消息竖线的长度。
   *
   * 按钮（`.message-actions`）只在工具跑着时挂在 `.message` 末尾，跑完就消失。
   * 竖线收尾规则早先用 `:last-child` 选中最后一行——按钮一出现，最后一行就不再
   * 是 `:last-child`，规则失效、竖线画满整行；工具一结束按钮消失，竖线又缩回 18px。
   * 行级化之后圆点与竖线挂在消息根节点上，末尾的兄弟节点再也顶不掉它。
   */
  it("末尾的动作按钮不会把收尾消息的连线拉长", async () => {
    injectRunningBashTurn();
    // 按钮默认是 hover 才显形的（`.message:hover .message-actions`），这里只要它在
    // DOM 里 —— 撑坏选择器的是节点本身，不是可见性。
    await expect
      .poll(
        () =>
          !!document.querySelector('[data-testid="background-current-task"]'),
      )
      .toBe(true);

    const message = document.querySelector<HTMLElement>(
      '[data-message-id="a2"]',
    )!;
    // 前置条件：末尾动作按钮确实是这条消息的最后一个子元素。
    expect(
      message.lastElementChild?.classList.contains("message-actions"),
    ).toBe(true);

    const after = getComputedStyle(message, "::after");
    const geo = {
      lineHeight: px(after.height),
      messageHeight: message.getBoundingClientRect().height,
      // 圆点/竖线挂在消息根节点上，而不是被末尾的按钮顶到别的行上。
      isDotMessage: message.classList.contains("timeline-message"),
    };

    expect(geo.isDotMessage).toBe(true);
    // 收尾段只到圆点中心（base 档 18px），不随消息高度拉伸。
    expect(geo.lineHeight).toBeCloseTo(18, 0);
    expect(geo.lineHeight).toBeLessThan(geo.messageHeight);
  });

  /**
   * 桌面端的覆盖规则（host-desktop.css：圆点 12px，收尾段 21px）也必须挂在消息
   * 根节点上。这一档最容易漏改：只改 base 的选择器，桌面用户看到的还是「工具跑着
   * 时整根线、跑完就缩没」。这里用 `data-host="desktop"` 复现桌面档
   * （host-desktop.css 已在本文件顶部导入，它所有选择器都带这个属性前缀）。
   */
  it("桌面档：动作按钮同样不拉长收尾段", async () => {
    document.documentElement.dataset.host = "desktop";

    injectRunningBashTurn();
    await expect
      .poll(
        () =>
          !!document.querySelector('[data-testid="background-current-task"]'),
      )
      .toBe(true);

    const message = document.querySelector<HTMLElement>(
      '[data-message-id="a2"]',
    )!;
    const geo = {
      lineHeight: px(getComputedStyle(message, "::after").height),
      messageHeight: message.getBoundingClientRect().height,
      isDotMessage: message.classList.contains("timeline-message"),
    };

    expect(geo.isDotMessage).toBe(true);
    expect(geo.lineHeight).toBeCloseTo(21, 0);
    expect(geo.lineHeight).toBeLessThan(geo.messageHeight);
  });
});
