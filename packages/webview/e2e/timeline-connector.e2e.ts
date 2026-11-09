import { test, expect } from "./utils/webviewTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import fs from "fs";
import path from "path";

/**
 * 一轮「文本 + 运行中的 Bash」的助手消息：工具未收尾时这条消息末尾会挂上
 * 「把本轮转到后台」按钮（`.message-actions`），它也是 `.message` 的子元素。
 */
async function injectRunningBashTurn(page: Page) {
  const injector = new MessageInjector(page);
  const messages: Message[] = [
    {
      id: "u1",
      role: "user",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [{ type: "text", content: "推送镜像并部署。" }],
    },
    {
      id: "a1",
      role: "assistant",
      timestamp: "2025-07-09T10:30:01.000Z",
      blocks: [
        { type: "text", content: "我来推送镜像并部署。" },
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          stage: "running",
          parameters: JSON.stringify({ command: "docker push" }),
        },
      ],
    },
  ];
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: true,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  await injector.startStreaming();
}

/**
 * Timeline connector geometry (设计稿: assistant 时间线竖线跨消息贯穿).
 *
 * Every message renders as a virtualized row; consecutive assistant messages
 * form a timeline run. Verifies the per-row `.timeline-row::after` segments on
 * a `.timeline-run--start` row and a `.timeline-run--end` row abut seamlessly
 * into one continuous vertical line, and that a single-dot run
 * (`.timeline-run--single`) draws no line.
 */
test.describe("Timeline connector geometry demo", () => {
  test("continuous line through a multi-assistant run; none for single run", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const messages: Message[] = [
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "First assistant message." }],
      },
      {
        id: "a2",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [{ type: "text", content: "Second assistant message." }],
      },
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:02.000Z",
        blocks: [{ type: "text", content: "A follow-up question." }],
      },
      {
        id: "a3",
        role: "assistant",
        timestamp: "2025-07-09T10:30:03.000Z",
        blocks: [{ type: "text", content: "Third assistant message." }],
      },
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });

    await injector.updateMessages(messages);
    await injector.endStreaming();

    await webviewPage.waitForSelector(".virtual-row.timeline-run--start");

    // Geometry probe: read each run row's ::after segment in document
    // coordinates; the run is flush (paddingBottom 0 inside the run), so the
    // segments must abut at the row boundary.
    const geo = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const startRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--start",
      )!;
      const endRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--end",
      )!;
      const singleRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--single",
      )!;

      const startMsgRow = startRow.querySelector<HTMLElement>(".timeline-row")!;
      const endMsgRow = endRow.querySelector<HTMLElement>(".timeline-row")!;
      const startRect = startMsgRow.getBoundingClientRect();
      const endRect = endMsgRow.getBoundingClientRect();

      const startAfter = getComputedStyle(startMsgRow, "::after");
      const endAfter = getComputedStyle(endMsgRow, "::after");

      // start row: line runs from the first dot center (18px) to the row
      // bottom; end row: line runs from its top to the last dot center.
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
        singleRow.querySelector(".timeline-row") as HTMLElement,
        "::after",
      );

      return {
        startId: startRow.getAttribute("data-measured-message-id"),
        endId: endRow.getAttribute("data-measured-message-id"),
        singleIsSingleClass: singleRow.classList.contains(
          "timeline-run--single",
        ),
        seg1,
        seg2,
        firstDotCenter,
        lastDotCenter,
        singleAfterDisplay: singleAfter.display,
      };
    });

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
   * 助手消息。它若渲染出空 `.message` 外壳：收尾规则（`.timeline-row--last`
   * 那一段只画到圆点中心）落在它身上，而它内部没有 `.timeline-row`，前一条
   * 真实消息的最后一行于是保持全高线段——用户看到一条线一直连到列表底部、
   * 底部却没有块；那一行还占着行高与间距，底部凭空多出空白。
   */
  test("a message without any block leaves no row and no dangling connector", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const messages: Message[] = [
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "A question." }],
      },
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [{ type: "text", content: "First assistant message." }],
      },
      {
        id: "a2",
        role: "assistant",
        timestamp: "2025-07-09T10:30:02.000Z",
        blocks: [{ type: "text", content: "Second assistant message." }],
      },
      {
        id: "blank",
        role: "assistant",
        timestamp: "2025-07-09T10:30:03.000Z",
        blocks: [],
      },
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: true,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages(messages);
    await injector.startStreaming();
    await webviewPage.waitForSelector(".virtual-row.timeline-run--end");

    const geo = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const endRow = document.querySelector<HTMLElement>(
        ".virtual-row.timeline-run--end",
      )!;
      const rows = Array.from(
        endRow.querySelectorAll<HTMLElement>(".timeline-row"),
      );
      // 收尾类落在一条内部没有 `.timeline-row` 的行上时（本用例修的正是这个），
      // 这里读不到末行——用 null 兜住，让下面第一条断言报出「收尾落在谁身上」，
      // 而不是在 evaluate 里抛 TypeError。
      const lastRow = rows[rows.length - 1] ?? null;
      const after = lastRow ? getComputedStyle(lastRow, "::after") : null;
      return {
        rowIds: Array.from(
          document.querySelectorAll<HTMLElement>("[data-measured-message-id]"),
        ).map((row) => row.getAttribute("data-measured-message-id")),
        endId: endRow.getAttribute("data-measured-message-id"),
        lastRowHeight: lastRow ? lastRow.getBoundingClientRect().height : 0,
        lastSegmentHeight: after ? px(after.height) : NaN,
      };
    });

    // 空消息连虚拟行都不存在：既不占行高，也不占消息间的 14px 间距，更没有
    // `.message` 外壳。收尾落在最后一条真实消息上。
    expect(geo.rowIds).not.toContain("blank");
    expect(geo.endId).toBe("a2");
    // 收尾段只到圆点中心（base 档 18px），不会垂到行底。
    expect(geo.lastSegmentHeight).toBeCloseTo(18, 0);
    expect(geo.lastSegmentHeight).toBeLessThan(geo.lastRowHeight);
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
  test("a row joining an existing run re-measures the run's previous tail", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const u1: Message = {
      id: "u1",
      role: "user",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [{ type: "text", content: "A question." }],
    };
    const a1: Message = {
      id: "a1",
      role: "assistant",
      timestamp: "2025-07-09T10:30:01.000Z",
      blocks: [{ type: "text", content: "First assistant message." }],
    };
    const a2: Message = {
      id: "a2",
      role: "assistant",
      timestamp: "2025-07-09T10:30:02.000Z",
      blocks: [{ type: "text", content: "Second assistant message." }],
    };

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages([u1, a1]);
    await injector.endStreaming();
    await webviewPage.waitForSelector(".virtual-row.timeline-run--single");

    // 追加一条：a1 从「单点 run」变成「run 的开头」。等两帧让 RO 落地并完成定位。
    await injector.updateMessages([u1, a1, a2]);
    await webviewPage.waitForSelector(".virtual-row.timeline-run--end");
    await webviewPage.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve(null)),
          ),
        ),
    );

    const gap = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".virtual-row.timeline-run--start, .virtual-row.timeline-run--end",
        ),
      );
      const first = rows[0].querySelector<HTMLElement>(".timeline-row")!;
      const second = rows[1].querySelector<HTMLElement>(".timeline-row")!;
      const firstRect = first.getBoundingClientRect();
      const secondRect = second.getBoundingClientRect();
      const startAfter = getComputedStyle(first, "::after");
      const endAfter = getComputedStyle(second, "::after");
      return {
        segmentGap:
          secondRect.top +
          px(endAfter.top) -
          (firstRect.bottom - px(startAfter.bottom)),
        rowBoxGap:
          rows[1].getBoundingClientRect().top -
          rows[0].getBoundingClientRect().bottom,
      };
    });

    // 行盒相切（账本跟上 DOM），连线两段相接。容差 1px：行高是取整后记进账本的。
    expect(Math.abs(gap.rowBoxGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap.segmentGap)).toBeLessThanOrEqual(1);
  });

  /**
   * 「把本轮转到后台」按钮不能改变收尾行竖线的长度。
   *
   * 按钮（`.message-actions`）只在工具跑着时挂在 `.message` 末尾，跑完就消失。
   * 竖线收尾规则早先用 `.timeline-row:last-child` 选中最后一行——按钮一出现，
   * 最后一行就不再是 `:last-child`，规则失效、竖线画满整行；工具一结束按钮消失，
   * 竖线又缩回 18px。同一条工具行因此在「运行中 / 已完成」两种状态下变脸。
   */
  test("trailing action button doesn't stretch the last row's connector", async ({
    webviewPage,
  }) => {
    await injectRunningBashTurn(webviewPage);
    // 按钮默认是 hover 才显形的（`.message:hover .message-actions`），这里只要它在
    // DOM 里 —— 撑坏选择器的是节点本身，不是可见性。
    await webviewPage.waitForSelector(
      '[data-testid="background-current-task"]',
      { state: "attached" },
    );

    const geo = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const message = document.querySelector<HTMLElement>(
        '[data-message-id="a1"]',
      )!;
      const rows = Array.from(
        message.querySelectorAll<HTMLElement>(".timeline-row"),
      );
      const lastRow = rows[rows.length - 1];
      const after = getComputedStyle(lastRow, "::after");
      return {
        lineHeight: px(after.height),
        rowHeight: lastRow.getBoundingClientRect().height,
        // 末行标记落在最后一行上，而不是被末尾的按钮顶掉。
        lastRowIsMarked: lastRow.classList.contains("timeline-row--last"),
      };
    });

    expect(geo.lastRowIsMarked).toBe(true);
    // 收尾段只到圆点中心（base 档 18px），不随行高拉伸。
    expect(geo.lineHeight).toBeCloseTo(18, 0);
    expect(geo.lineHeight).toBeLessThan(geo.rowHeight);
  });

  /**
   * 桌面端的覆盖规则（host-desktop.css：圆点 12px，收尾段 21px）也必须绑在
   * 末行标记上。这一档最容易漏改：只改 base 的选择器，桌面用户看到的还是
   * 「工具跑着时整根线、跑完就缩没」。这里用 data-host="desktop" + 注入
   * host-desktop.css 复现桌面档，与真实桌面窗口同源（见
   * desktop-panel-root-layout.e2e.ts 的同一手法）。
   */
  test("desktop tier: the action button doesn't stretch the tail segment", async ({
    webviewPage,
  }) => {
    const hostCss = fs.readFileSync(
      path.join(process.cwd(), "src", "styles", "host-desktop.css"),
      "utf8",
    );
    await webviewPage.evaluate(() =>
      document.documentElement.setAttribute("data-host", "desktop"),
    );
    await webviewPage.addStyleTag({ content: hostCss });

    await injectRunningBashTurn(webviewPage);
    await webviewPage.waitForSelector(
      '[data-testid="background-current-task"]',
      { state: "attached" },
    );

    const geo = await webviewPage.evaluate(() => {
      const px = (v: string) => (v && v.endsWith("px") ? parseFloat(v) : NaN);
      const message = document.querySelector<HTMLElement>(
        '[data-message-id="a1"]',
      )!;
      const rows = Array.from(
        message.querySelectorAll<HTMLElement>(".timeline-row"),
      );
      const lastRow = rows[rows.length - 1];
      return {
        lineHeight: px(getComputedStyle(lastRow, "::after").height),
        rowHeight: lastRow.getBoundingClientRect().height,
        lastRowIsMarked: lastRow.classList.contains("timeline-row--last"),
      };
    });

    expect(geo.lastRowIsMarked).toBe(true);
    expect(geo.lineHeight).toBeCloseTo(21, 0);
    expect(geo.lineHeight).toBeLessThan(geo.rowHeight);
  });
});
