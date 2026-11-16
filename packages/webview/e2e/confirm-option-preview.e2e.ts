import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "wave-agent-sdk";

const WORKDIR = "/Users/dev/projects/wave-agent";

/**
 * AskUserQuestion 选项预览的分栏几何（ask-user-tool.md「选项预览与备注」）。
 *
 * 形态按容器宽 480px 分两档（抄 CC 桌面端的 `@[30rem]` 断点）：「窄档上下堆叠 /
 * 宽档左右并排」「预览面板独立滚动、不裁掉选项行」这两条只能量出来：jsdom 不解析
 * 外部样式表，grid / fr / overflow 一律量不到。单元测试断的是类名、结构与回传
 * 契约，几何断言落在这里。
 *
 * 宽度取两档：桌面大窗口与窄窗口。窄档弹窗容器约 467px，落在 480px 断点以下 ⇒
 * 堆叠档，也是早前「第二个选项被裁掉 33px」那个回归的现场（那一版的错因是按比例
 * 切高度，不是堆叠本身，所以这一档同时守「堆叠 + 不裁行」）。再窄下去是桌面壳
 * 自身布局崩掉（侧栏固定 238px），量的就不是预览的分栏了。
 */
const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 760, height: 600 };

/** 堆叠 / 并排的断点：容器（.question-item）宽 480px = CC 的 30rem。 */
const BREAKPOINT = 480;

/** 选项区保底高度：桌面一个选项高（见 ConfirmationDialog.css 的 .options-list）。 */
const OPTION_MIN_HEIGHT = 40;

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 40 行长预览：超过任何一档视口能给的预览区高度，必定要内部滚动。 */
const LONG_PREVIEW = [
  "### 方案 A",
  "",
  ...Array.from({ length: 40 }, (_, i) => `- 第 ${i + 1} 行说明`),
].join("\n");

const SHORT_PREVIEW = [
  "### 方案 B",
  "",
  "```",
  "+--------+",
  "| 两栏 |",
  "+--------+",
  "```",
].join("\n");

const previewQuestions = [
  {
    question: "选哪个版式？",
    options: [
      { label: "方案 A", description: "纵向列表", preview: LONG_PREVIEW },
      { label: "方案 B", description: "两栏并排", preview: SHORT_PREVIEW },
    ],
    multiSelect: false,
  },
];

/**
 * 选项多到选项列自己滚的那一档（折叠用例专用）。
 * 堆叠档里选项列吃满整条卡片宽度，行矮、两行不再溢出 —— 但「折叠前后两栏的
 * 滚动位置都保持」这条还得有会滚的列表才验得出来，所以这里给足六行。
 */
const crowdedQuestions = [
  {
    question: "选哪个版式？",
    options: [
      { label: "方案 A", description: "纵向列表", preview: LONG_PREVIEW },
      { label: "方案 B", description: "两栏并排", preview: SHORT_PREVIEW },
      { label: "方案 C", description: "折叠卡片", preview: SHORT_PREVIEW },
      { label: "方案 D", description: "紧凑行距", preview: SHORT_PREVIEW },
      { label: "方案 E", description: "卡片横排", preview: SHORT_PREVIEW },
      { label: "方案 F", description: "侧边抽屉", preview: SHORT_PREVIEW },
    ],
    multiSelect: false,
  },
];

type Geom = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
} | null;

/** 选项列 / 预览面板的几何快照（全部 getBoundingClientRect + 实量滚动量）。 */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const geom = (sel: string): Geom => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
        width: r.width,
        height: r.height,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
      };
    };

    const list = geom(".options-list");
    const preview = geom("[data-testid='option-preview']");
    const firstOption = geom(".option-item");
    const previewEl = document.querySelector(
      "[data-testid='option-preview']",
    ) as HTMLElement | null;
    const listEl = document.querySelector(".options-list") as HTMLElement;
    const listBox = listEl.getBoundingClientRect();
    // 每个选项行是否**完整**落在列表盒内（早前堆叠档下第二个选项被裁掉半行，
    // 几何上就是 row.bottom 越过 list.bottom 33px）。容差给 1px：选项行高与
    // 容器高度都是分数，最近一像素的取整不算裁切（这一档没有滚动条）。
    const optionsFullyVisible = [
      ...document.querySelectorAll(".option-item"),
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom <= listBox.bottom + 1 && r.top >= listBox.top - 1;
    });

    // 预览能不能滚到末尾：滚到底后看 scrollTop 是否真的前进了。
    let reachBottom = false;
    if (previewEl) {
      previewEl.scrollTop = previewEl.scrollHeight;
      reachBottom =
        previewEl.scrollTop + previewEl.clientHeight >=
        previewEl.scrollHeight - 1;
      previewEl.scrollTop = 0;
    }

    return {
      list,
      preview,
      firstOption,
      optionsFullyVisible,
      // 断点量的容器：.question-item（= 卡片内宽，CSS 里 container-type 挂它）
      container: geom(".question-item"),
      card: geom(".confirmation-dialog-inner"),
      notes: geom(".option-notes"),
      reachBottom,
      previewText: previewEl?.textContent ?? "",
      notesVisible: !!document.querySelector(".option-notes"),
      otherVisible: !!document.querySelector(".other-option"),
    };
  });
}

/**
 * 只量卡片高度。折叠/展开那一路要用它而不是上面的 measure()：
 * measure() 为了验「预览能不能滚到底」会把预览面板滚到底再归零，
 * 拿它量高度会顺手抹掉折叠前后要对比的滚动位置。
 */
async function cardHeight(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (
        document.querySelector(".confirmation-dialog-inner") as HTMLElement
      ).getBoundingClientRect().height,
  );
}

async function openPreviewQuestion(
  page: import("@playwright/test").Page,
  confirmationId: string,
  questions: typeof previewQuestions = previewQuestions,
) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();
  await injector.updateMessages([
    MockDataGenerator.createUserMessage(
      "这两个版式你更想要哪个？",
      "msg-pv-u1",
    ),
    MockDataGenerator.createAssistantMessage(
      "我把两种版式都画出来了，你对着看。",
      "msg-pv-a1",
    ),
  ]);
  await expect(page.locator(".message.assistant")).toBeVisible();

  await injector.simulateExtensionMessage("showConfirmation", {
    confirmationId,
    toolName: ASK_USER_QUESTION_TOOL_NAME,
    confirmationType: "需要确认",
    toolInput: { questions },
  });
  await page.waitForSelector(".confirmation-dialog");
  return injector;
}

test.describe("AskUserQuestion option preview", () => {
  test("sits beside the options when wide and stacks under them when narrow, without clipping an option", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(WIDE);
    await openPreviewQuestion(webviewPage, "preview-layout");

    const wide = await measure(webviewPage);
    expect(wide.list).not.toBeNull();
    expect(wide.preview).not.toBeNull();
    // 宽档（容器 ≥480px）：并排 —— 选项列整体在预览面板左侧，两栏都真的占面积
    expect(wide.container!.width).toBeGreaterThanOrEqual(BREAKPOINT);
    expect(wide.list!.right).toBeLessThanOrEqual(wide.preview!.left + 1);
    expect(wide.preview!.width).toBeGreaterThan(0);
    expect(wide.list!.clientHeight).toBeGreaterThanOrEqual(OPTION_MIN_HEIGHT);
    // 预览态下没有「其他」，备注常驻
    expect(wide.otherVisible).toBe(false);
    expect(wide.notesVisible).toBe(true);
    // 预览自己滚（面板高度被容器夹住），不许溢出盖到备注行上、也不许把弹窗
    // 撑破 —— 长预览按内容高度长出去时，正是这两条先坏。
    expect(wide.preview!.bottom).toBeLessThanOrEqual(wide.notes!.top);
    expect(wide.card!.scrollHeight).toBe(wide.card!.clientHeight);

    await webviewPage.setViewportSize(NARROW);
    // 改窗口尺寸会重排，等布局稳定再量
    await webviewPage.waitForTimeout(150);

    const narrow = await measure(webviewPage);
    expect(narrow.preview).not.toBeNull();
    // 窄档（容器 <480px）：上下堆叠，选项在上、预览在下（CC 桌面端同断点）
    expect(narrow.container!.width).toBeLessThan(BREAKPOINT);
    expect(narrow.preview!.top).toBeGreaterThanOrEqual(narrow.list!.bottom - 1);
    expect(narrow.preview!.width).toBeGreaterThan(0);
    expect(narrow.list!.clientHeight).toBeGreaterThanOrEqual(OPTION_MIN_HEIGHT);
    expect(narrow.preview!.bottom).toBeLessThanOrEqual(narrow.notes!.top);
    expect(narrow.card!.scrollHeight).toBe(narrow.card!.clientHeight);
    // 半行裁切是「按比例切高度」的产物（早前窄档选项区固定拿 45%，第二个选项的
    // 底部越过列表盒 33px，看着像被预览面板盖住）。堆叠档让选项列表走自然高度，
    // 两行选项都要完整可见、列表自己一格都不滚（1px 的分数取整同上）。
    expect(narrow.optionsFullyVisible).toEqual([true, true]);
    expect(narrow.list!.scrollHeight).toBeLessThanOrEqual(
      narrow.list!.clientHeight + 1,
    );
  });

  test("scrolls the long preview on its own and keeps a whole option visible", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(WIDE);
    await openPreviewQuestion(webviewPage, "preview-scroll");

    const m = await measure(webviewPage);
    // 预览内容超出面板高度 → 真的可滚，且能滚到末尾
    expect(m.preview!.scrollHeight).toBeGreaterThan(m.preview!.clientHeight);
    expect(m.reachBottom).toBe(true);
    // 选项列没被长预览挤掉：仍有完整一行可点
    expect(m.list!.clientHeight).toBeGreaterThanOrEqual(OPTION_MIN_HEIGHT);
    expect(m.firstOption!.height).toBeGreaterThan(0);

    // 滚预览不该带动选项列（两个容器各滚各的）
    const independent = await webviewPage.evaluate(() => {
      const list = document.querySelector(".options-list") as HTMLElement;
      const preview = document.querySelector(
        "[data-testid='option-preview']",
      ) as HTMLElement;
      list.scrollTop = 0;
      preview.scrollTop = 40;
      preview.dispatchEvent(new Event("scroll"));
      return {
        listScrollTop: list.scrollTop,
        previewScrollTop: preview.scrollTop,
      };
    });
    expect(independent.previewScrollTop).toBeGreaterThan(0);
    expect(independent.listScrollTop).toBe(0);
  });

  test("switches the preview on focus or hover, before anything is selected", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(WIDE);
    await openPreviewQuestion(webviewPage, "preview-focus");

    const before = await measure(webviewPage);
    expect(before.previewText).toContain("方案 A");

    await webviewPage.locator('.option-item[data-option-index="1"]').focus();

    await expect
      .poll(async () => (await measure(webviewPage)).previewText)
      .toContain("方案 B");

    // 悬停同样切换（对齐 CC 桌面端：onFocus 与 onMouseEnter 同一个处理函数）
    await webviewPage.locator('.option-item[data-option-index="0"]').hover();
    await expect
      .poll(async () => (await measure(webviewPage)).previewText)
      .toContain("方案 A");

    // 只是焦点/悬停过去，选中状态没变（答案仍是空）
    const checked = await webviewPage.evaluate(
      () =>
        (
          document.querySelector(
            '.option-item[data-option-index="1"] input[type="radio"]',
          ) as HTMLInputElement
        ).checked,
    );
    expect(checked).toBe(false);
  });

  test("keeps the card height when the preview length changes, in both layouts", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(WIDE);
    await openPreviewQuestion(webviewPage, "preview-height");

    const cap = Math.min(WIDE.height * 0.7, 560);
    // 40 行长预览在焦点上：卡片被 dock 上限顶住。
    const longFocus = await measure(webviewPage);
    expect(longFocus.previewText).toContain("方案 A");
    expect(longFocus.card!.height).toBeCloseTo(cap, 0);

    // 焦点切到只有几行的短预览：卡片高度与备注行位置都不许动
    // —（预览态改前这里跟着内容走，长 → 短会从 560 掉到 444，
    //    把按钮栏和下方消息区一起带着抖）。
    await webviewPage.locator('.option-item[data-option-index="1"]').focus();
    await expect
      .poll(async () => (await measure(webviewPage)).previewText)
      .toContain("方案 B");
    const shortFocus = await measure(webviewPage);

    expect(shortFocus.card!.height).toBeCloseTo(longFocus.card!.height, 0);
    expect(shortFocus.notes!.top).toBeCloseTo(longFocus.notes!.top, 0);
    expect(shortFocus.preview!.bottom).toBeLessThanOrEqual(
      shortFocus.notes!.top,
    );

    // 堆叠档同样钉住：窄窗口里长 → 短预览来回切也不许改卡片高度
    //（堆叠档给选项列表自然高度、预览只领剩余额度，高度差全落在预览面板里）。
    await webviewPage.setViewportSize(NARROW);
    await webviewPage.waitForTimeout(150);
    await webviewPage.locator('.option-item[data-option-index="0"]').focus();
    await expect
      .poll(async () => (await measure(webviewPage)).previewText)
      .toContain("方案 A");
    const stackedLong = await measure(webviewPage);
    expect(stackedLong.card!.height).toBeCloseTo(
      Math.min(NARROW.height * 0.7, 560),
      0,
    );

    await webviewPage.locator('.option-item[data-option-index="1"]').focus();
    await expect
      .poll(async () => (await measure(webviewPage)).previewText)
      .toContain("方案 B");
    const stackedShort = await measure(webviewPage);
    expect(stackedShort.card!.height).toBeCloseTo(stackedLong.card!.height, 0);
    expect(stackedShort.notes!.top).toBeCloseTo(stackedLong.notes!.top, 0);
  });

  test("collapsing hides the preview panel together with the option list", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(NARROW);
    await openPreviewQuestion(
      webviewPage,
      "preview-collapse",
      crowdedQuestions,
    );

    await expect(
      webviewPage.locator("[data-testid='option-preview']"),
    ).toBeVisible();

    // display:none 会丢掉滚动位置：折叠前把两栏都滚走，展开后要回到原处。
    const scrolled = await webviewPage.evaluate(() => {
      const list = document.querySelector(".options-list") as HTMLElement;
      const preview = document.querySelector(
        "[data-testid='option-preview']",
      ) as HTMLElement;
      list.scrollTop = 40;
      preview.scrollTop = 120;
      return { list: list.scrollTop, preview: preview.scrollTop };
    });
    expect(scrolled.list).toBeGreaterThan(0);
    expect(scrolled.preview).toBeGreaterThan(0);

    const expandedCard = await cardHeight(webviewPage);
    await webviewPage.getByRole("button", { name: "折叠选项" }).click();
    await expect(
      webviewPage.locator("[data-testid='option-preview']"),
    ).toBeHidden();

    // 折叠是「把空间还回去」：预览态钉住的 dock 高度要跟着松开
    //（否则收起选项后卡片还是满高，消息区拿不回高度）。
    const collapsedCard = await cardHeight(webviewPage);
    expect(collapsedCard).toBeLessThan(expandedCard - 80);

    await webviewPage.getByRole("button", { name: "展开选项" }).click();
    await expect(
      webviewPage.locator("[data-testid='option-preview']"),
    ).toBeVisible();

    // 展开后高度回到 dock 上限（与折叠前那一次相同）。
    expect(await cardHeight(webviewPage)).toBeCloseTo(expandedCard, 0);

    const restored = await webviewPage.evaluate(() => ({
      list: (document.querySelector(".options-list") as HTMLElement).scrollTop,
      preview: (
        document.querySelector("[data-testid='option-preview']") as HTMLElement
      ).scrollTop,
    }));
    expect(restored.list).toBe(scrolled.list);
    expect(restored.preview).toBe(scrolled.preview);
  });
});
