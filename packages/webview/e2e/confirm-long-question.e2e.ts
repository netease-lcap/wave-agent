import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "wave-agent-sdk";

const WORKDIR = "/Users/dev/projects/wave-agent";

/**
 * 题干超长时在题干区域内滚动（ask-user-tool.md「题干超长时在题干区域内滚动」）。
 *
 * 几何只能在真实浏览器里量：jsdom 不解析外部样式表，`max-height` / 溢出 /
 * 滚动位置一律量不到。这里断的是「题干封顶后选项区还在屏上」——改前那条路径
 * 会把 .options-list 压成 clientHeight = 0（选项在 DOM 里但看不见也点不到）。
 *
 * 视口取三档：窄栏（插件端侧栏宽度）、小屏笔记本高度（min(70vh, 560px) 由 70vh
 * 绑定的一侧）、大窗口。
 */
const VIEWPORTS = [
  { width: 400, height: 600 },
  { width: 900, height: 520 },
  { width: 1400, height: 900 },
];

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 题干封顶：桌面层行高 22px × 6 行（见 host-desktop.css）。 */
const CHIP_MAX_HEIGHT = 132;
/** 选项区保底一行（桌面一个选项高，见 ConfirmationDialog.css 的 .options-list）。 */
const OPTION_MIN_HEIGHT = 40;

const longQuestion =
  "这一轮我想先确认一件事再动手：" +
  "我们的确认弹窗里题干本身有时候字数很多，".repeat(6) +
  "比如一次要交代背景、约束、期望产出和不要做的事，".repeat(6) +
  "这种时候弹窗里题干会占掉很大一块高度，".repeat(6) +
  "我想知道现在选项区还剩多少空间、能不能正常看到并点选。".repeat(6);

const options = [
  { label: "选项一", description: "第一条描述" },
  { label: "选项二", description: "第二条描述" },
  { label: "选项三", description: "第三条描述" },
  { label: "选项四", description: "第四条描述" },
];

const longQuestions = [
  { question: longQuestion, options, multiSelect: false },
  { question: `第二个问题：${longQuestion}`, options, multiSelect: false },
];

/** 题干 / 选项区的几何快照（全部 getBoundingClientRect + scrollHeight 实量）。 */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const geom = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    };

    const chipEl = document.querySelector(
      ".question-header-chip",
    ) as HTMLElement | null;
    const chip = geom(".question-header-chip");
    const list = geom(".options-list");
    const firstOption = geom(".option-item");

    // 「能滚到全文最后一行」：滚到底后用 Range 量最后一行文字的矩形，看它是否
    // 落在题干的可见区内（被 line-clamp 裁掉的内容不会随 scrollTop 进入可视区）。
    let lastLineVisibleAfterScrollToEnd = false;
    let chipMaxScroll = 0;
    if (chipEl) {
      chipMaxScroll = chipEl.scrollHeight - chipEl.clientHeight;
      chipEl.scrollTop = chipEl.scrollHeight;
      const range = document.createRange();
      range.selectNodeContents(chipEl);
      const rects = Array.from(range.getClientRects());
      const last = rects[rects.length - 1];
      const box = chipEl.getBoundingClientRect();
      lastLineVisibleAfterScrollToEnd = !!last && last.bottom <= box.bottom + 1;
      chipEl.scrollTop = 0;
    }

    // 第一个选项有多少落在选项区的可视范围内
    const firstOptionVisibleRatio =
      firstOption && list && firstOption.height > 0 && list.clientHeight > 0
        ? Math.max(
            0,
            Math.min(firstOption.bottom, list.top + list.clientHeight) -
              Math.max(firstOption.top, list.top),
          ) / firstOption.height
        : 0;

    return {
      chip,
      list,
      firstOption,
      body: geom(".confirmation-body"),
      chipMaxScroll,
      lastLineVisibleAfterScrollToEnd,
      firstOptionVisibleRatio,
      chipText: chipEl?.textContent?.trim() ?? "",
    };
  });
}

async function openDesktop(page: import("@playwright/test").Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("这一轮先确认几件事。", "msg-long-u1"),
    MockDataGenerator.createAssistantMessage(
      "好的，我把问题列出来。".repeat(6),
      "msg-long-a1",
    ),
  ]);
  await expect(page.locator(".message.assistant")).toBeVisible();
  return injector;
}

test.describe("AskUserQuestion long question", () => {
  test("a long question scrolls inside the chip and keeps the options on screen", async ({
    webviewPage,
  }) => {
    const injector = await openDesktop(webviewPage);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "long-question-1",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions: longQuestions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    for (const viewport of VIEWPORTS) {
      await webviewPage.setViewportSize(viewport);
      // 窗口尺寸变化会改排版（行数、选项区高度），等布局稳定再量。
      await webviewPage.waitForTimeout(150);
      const m = await measure(webviewPage);
      const label = `${viewport.width}x${viewport.height}`;

      expect(m.chip, label).not.toBeNull();
      expect(m.list, label).not.toBeNull();
      // 题干内容完整（不截断：DOM 里是整段文字，只是可视区封顶）
      expect(m.chipText, label).toBe(longQuestion);
      // 封顶：题干高度停在 6 行，且真的溢出（内容比可视区高，可滚）
      expect(m.chip!.clientHeight, label).toBeLessThanOrEqual(
        CHIP_MAX_HEIGHT + 1,
      );
      expect(m.chip!.clientHeight, label).toBeGreaterThan(0);
      expect(m.chipMaxScroll, label).toBeGreaterThan(0);
      expect(m.lastLineVisibleAfterScrollToEnd, label).toBe(true);

      // 选项区没被吃掉：至少露出一整行且可点
      expect(m.list!.clientHeight, label).toBeGreaterThanOrEqual(
        OPTION_MIN_HEIGHT,
      );
      expect(m.firstOptionVisibleRatio, label).toBeGreaterThan(0.95);
      // 题干与选项区不许重叠：题干的高度是「内容与上限取小」、不随所在的
      // header 行缩放，一旦那行被压缩，选项区会挪进题干的绘制区域里（实测
      // 900×520 重叠 56px，画面上是两行字与选项文字叠在一起）。
      expect(m.list!.top, label).toBeGreaterThanOrEqual(m.chip!.bottom);
    }
  });

  test("a tiny viewport degrades to body scrolling, never an overlapping or empty options area", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 400, height: 300 });
    const injector = await openDesktop(webviewPage);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "long-question-tiny",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions: longQuestions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    const m = await measure(webviewPage);
    // 不重叠：选项区仍在题干下方
    expect(m.list!.top).toBeGreaterThanOrEqual(m.chip!.bottom);
    // 选项区保底一行，且是真的可滚（不是零高度）
    expect(m.list!.clientHeight).toBeGreaterThanOrEqual(OPTION_MIN_HEIGHT);
    expect(m.list!.scrollHeight).toBeGreaterThan(m.list!.clientHeight);
    // 放不下的高度由弹窗主体承担
    expect(m.body!.scrollHeight).toBeGreaterThan(m.body!.clientHeight);
  });

  test("scrolling one area does not move the other", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 900, height: 520 });
    const injector = await openDesktop(webviewPage);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "long-question-2",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions: longQuestions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    // 滚题干 → 选项区滚动位置不动
    const afterChipScroll = await webviewPage.evaluate(() => {
      const chip = document.querySelector(
        ".question-header-chip",
      ) as HTMLElement;
      const list = document.querySelector(".options-list") as HTMLElement;
      list.scrollTop = 40;
      const before = list.scrollTop;
      chip.scrollTop = 60;
      chip.dispatchEvent(new Event("scroll"));
      return {
        chipScrollTop: chip.scrollTop,
        listScrollTop: list.scrollTop,
        listBefore: before,
      };
    });
    expect(afterChipScroll.chipScrollTop).toBeGreaterThan(0);
    expect(afterChipScroll.listBefore).toBeGreaterThan(0);
    expect(afterChipScroll.listScrollTop).toBe(afterChipScroll.listBefore);

    // 滚选项区 → 题干滚动位置不动
    const afterListScroll = await webviewPage.evaluate(() => {
      const chip = document.querySelector(
        ".question-header-chip",
      ) as HTMLElement;
      const list = document.querySelector(".options-list") as HTMLElement;
      chip.scrollTop = 60;
      const chipBefore = chip.scrollTop;
      list.scrollTop = 80;
      list.dispatchEvent(new Event("scroll"));
      return {
        chipScrollTop: chip.scrollTop,
        chipBefore,
        listScrollTop: list.scrollTop,
      };
    });
    expect(afterListScroll.listScrollTop).toBeGreaterThan(0);
    expect(afterListScroll.chipScrollTop).toBe(afterListScroll.chipBefore);
  });

  test("switching questions resets the chip scroll to the top", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 900, height: 520 });
    const injector = await openDesktop(webviewPage);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "long-question-3",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions: longQuestions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    const before = await webviewPage.evaluate(() => {
      const chip = document.querySelector(
        ".question-header-chip",
      ) as HTMLElement;
      chip.scrollTop = chip.scrollHeight;
      return { scrollTop: chip.scrollTop, text: chip.textContent ?? "" };
    });
    expect(before.scrollTop).toBeGreaterThan(0);

    await webviewPage.getByRole("button", { name: "下一个" }).click();

    const after = await webviewPage.evaluate(() => {
      const chip = document.querySelector(
        ".question-header-chip",
      ) as HTMLElement;
      return { scrollTop: chip.scrollTop, text: chip.textContent ?? "" };
    });
    expect(after.text).not.toBe(before.text);
    expect(after.text.startsWith("第二个问题")).toBe(true);
    expect(after.scrollTop).toBe(0);
  });

  test("a short question keeps the chip unscrolled", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize({ width: 900, height: 520 });
    const injector = await openDesktop(webviewPage);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "short-question-1",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: {
        questions: [
          {
            question: "这次的改动要不要一起带上文档？",
            options,
            multiSelect: false,
          },
        ],
      },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    const m = await measure(webviewPage);
    expect(m.chip!.clientHeight).toBeLessThan(CHIP_MAX_HEIGHT);
    // 内容没超出题干框 → 不出滚动条
    expect(m.chip!.scrollHeight).toBe(m.chip!.clientHeight);
  });
});
