import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { ASK_USER_QUESTION_TOOL_NAME, BASH_TOOL_NAME } from "wave-agent-sdk";

const WORKDIR = "/Users/dev/projects/wave-agent";

/**
 * AskUserQuestion 选项区折叠（ask-user-tool.md「提问弹窗选项区可折叠」）。
 *
 * 折叠的视觉结果只能在真实浏览器里量：选项区被 display:none 收掉之后，
 * 弹窗整体变矮、被它挤住的消息列表拿回高度。jsdom 不解析外部样式表，
 * 单元测试只能断状态类/aria/DOM 归属与 Tab 序列，几何断言落在这里。
 *
 * 视口取「笔记本小屏」形态：高度 520px 时 min(70vh, 560px) 的 cap 恰好
 * 是绑定的那一侧（70vh = 364px < 560px），也就是用户报的「确认弹窗几乎
 * 占满屏幕、消息列表看不见」的真实场景。
 */
const SHORT_VIEWPORT = { width: 900, height: 520 };

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

// 够多的问题与选项，保证展开态被 cap 顶住（否则折叠的收益不可见）。
const questions = [
  {
    question: "这次的改动要不要一起带上文档？",
    options: [
      { label: "带上", description: "同步更新 docs/ 下的说明" },
      { label: "只带规格", description: "只改 docs/specs/" },
      { label: "先不带", description: "后续单独提一个 PR" },
      { label: "回头再说", description: "先记进任务列表" },
    ],
    multiSelect: false,
  },
  {
    question: "哪些包需要跑一次完整测试？",
    options: [
      { label: "agent-sdk", description: "内核，改动面最大" },
      { label: "webview", description: "UI 与 e2e" },
      { label: "code", description: "CLI 交互层" },
      { label: "全部都跑", description: "最慢但最稳" },
      { label: "只跑改动面", description: "按需挑包" },
    ],
    multiSelect: false,
  },
  {
    question: "发布通道选哪个？",
    options: [
      { label: "stable", description: "正式通道" },
      { label: "beta", description: "先发 beta 验证" },
      { label: "两个都发", description: "同一批产物重跑上传" },
      { label: "暂不发布", description: "等门禁补丁合并" },
      { label: "只发测试环境", description: "线上零变更" },
    ],
    multiSelect: false,
  },
];

interface Geom {
  dialog: number;
  dialogInner: number;
  messages: number;
  optionsVisible: boolean;
  chipText: string;
  chipVisible: boolean;
  progressVisible: boolean;
  navVisible: boolean;
}

/** 弹窗与消息列表的几何快照（全部用 getBoundingClientRect 实量）。 */
async function measure(page: import("@playwright/test").Page): Promise<Geom> {
  return page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return { h: 0, visible: false };
      const r = el.getBoundingClientRect();
      return {
        h: r.height,
        // 折叠用 display:none 收掉，offsetParent 为 null；非 0 高且可见才算「在屏上」。
        visible: el.offsetParent !== null && r.height > 0 && r.width > 0,
      };
    };
    const dialog = rect(".confirmation-dialog");
    const dialogInner = rect(".confirmation-dialog-inner");
    const messages = rect(".messages-container");
    const options = rect(".options-list");
    const chip = document.querySelector(".question-header-chip") as HTMLElement;
    const chipRect = chip?.getBoundingClientRect();
    return {
      dialog: dialog.h,
      dialogInner: dialogInner.h,
      messages: messages.h,
      optionsVisible: options.visible,
      chipText: chip?.textContent?.trim() ?? "",
      chipVisible: !!chipRect && chipRect.height > 0,
      progressVisible: rect('[data-testid="question-progress-bar"]').visible,
      navVisible: rect(".question-navigation").visible,
    };
  });
}

async function openDesktopWithMessages(page: import("@playwright/test").Page) {
  const injector = new MessageInjector(page);
  await page.setViewportSize(SHORT_VIEWPORT);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();

  await injector.updateMessages([
    MockDataGenerator.createUserMessage(
      "这一轮先确认几件事再动手。",
      "msg-collapse-u1",
    ),
    MockDataGenerator.createAssistantMessage(
      "好的，我准备了几个问题需要你确认。".repeat(6),
      "msg-collapse-a1",
    ),
  ]);
  await expect(page.locator(".message.assistant")).toBeVisible();
  return injector;
}

test.describe("AskUserQuestion options collapse", () => {
  test("folding the options shrinks the dialog and grows the message list", async ({
    webviewPage,
  }) => {
    const injector = await openDesktopWithMessages(webviewPage);

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "collapse-auq-1",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    const expanded = await measure(webviewPage);
    const cap = Math.min(SHORT_VIEWPORT.height * 0.7, 560);
    // 前提：展开态被 cap 顶住 —— 否则这不是用户报的那个场景，折叠也没什么可省的。
    expect(expanded.dialogInner).toBeGreaterThan(cap - 8);
    expect(expanded.optionsVisible).toBe(true);
    expect(expanded.messages).toBeGreaterThan(0);

    // 关闭键的设计师对齐口径（host-desktop.css「关闭按钮对齐」top 22 / right 16）
    // 现在落在按钮组上：关闭键是组内最后一项，右缘 = 组右缘，折叠键只在它左侧
    // 多占 24px，关闭键自身的位置一格不动。
    const header = await webviewPage.evaluate(() => {
      const card = document
        .querySelector(".confirmation-dialog-inner")!
        .getBoundingClientRect();
      const group = document
        .querySelector(".confirmation-header-actions")!
        .getBoundingClientRect();
      const close = document
        .querySelector(".confirmation-close-btn")!
        .getBoundingClientRect();
      return {
        top: group.top - card.top,
        right: card.right - group.right,
        closeRight: group.right - close.right,
        closeSize: [close.width, close.height],
      };
    });
    // top/right 相对卡片 padding box（卡外还有 1px 描边），量到 22+1 / 16+1。
    // 容差 1.5：若 desktop 覆盖失效退回 base 的 8/12，偏移会掉到 9/13，照样红。
    expect(Math.abs(header.top - 23)).toBeLessThan(1.5);
    expect(Math.abs(header.right - 17)).toBeLessThan(1.5);
    expect(Math.abs(header.closeRight)).toBeLessThan(1);
    expect(header.closeSize).toEqual([20, 20]);

    // 收起前先给选项列表一个真实滚动位置（jsdom 侧只能存值，这里是真的滚）。
    await webviewPage.evaluate(() => {
      const list = document.querySelector(".options-list") as HTMLElement;
      list.scrollTop = 60;
    });

    await webviewPage.getByTestId("confirmation-collapse-toggle").click();
    // 折叠是同步的（React 状态 + CSS），但高度收缩带 8px transition 之外的
    // 布局稳定期，等一帧再量。
    await webviewPage.waitForFunction(
      () =>
        (document.querySelector(".options-list") as HTMLElement | null)
          ?.offsetParent === null,
    );
    const collapsed = await measure(webviewPage);

    // 选项区真的被收掉。
    expect(collapsed.optionsVisible).toBe(false);
    // 题面上下文与底部作答按钮留在原位 —— 折叠收起的是「交互区」，不是上下文。
    expect(collapsed.chipText).toBe(questions[0].question);
    expect(collapsed.chipVisible).toBe(true);
    expect(collapsed.progressVisible).toBe(true);
    expect(collapsed.navVisible).toBe(true);

    // 弹窗变矮、消息列表拿回高度，两边大致等量（消息列与确认区是同一列的
    // flex 兄弟，确认区缩多少消息列就长多少）。
    const shrunk = expanded.dialogInner - collapsed.dialogInner;
    const regained = collapsed.messages - expanded.messages;
    expect(shrunk).toBeGreaterThan(80);
    expect(Math.abs(regained - shrunk)).toBeLessThan(12);

    // 展开回去：几何还原，选项区回来了，滚动位置也回来了。
    await webviewPage.getByTestId("confirmation-collapse-toggle").click();
    await webviewPage.waitForFunction(
      () =>
        (document.querySelector(".options-list") as HTMLElement | null)
          ?.offsetParent !== null,
    );
    const reopened = await measure(webviewPage);
    expect(reopened.optionsVisible).toBe(true);
    expect(reopened.dialogInner).toBeGreaterThan(cap - 8);
    expect(Math.abs(reopened.messages - expanded.messages)).toBeLessThan(2);
    expect(
      await webviewPage.evaluate(
        () =>
          (document.querySelector(".options-list") as HTMLElement).scrollTop,
      ),
    ).toBe(60);
  });

  test("answer draft (selection, Other text, current question) survives a fold", async ({
    webviewPage,
  }) => {
    const injector = await openDesktopWithMessages(webviewPage);

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "collapse-auq-2",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    // 第 3 题的「其他」写上草稿。
    await webviewPage.getByLabel("定位到第 3 题").click();
    await webviewPage
      .locator('.option-item[data-option-index="other"]')
      .click();
    const otherInput = webviewPage.locator(".other-text-input");
    await otherInput.fill("先发 beta，stable 等下周");
    // 切回第 1 题选一项，再回到第 3 题（草稿跟着题目一起被折叠）。
    await webviewPage.getByLabel("定位到第 1 题").click();
    await webviewPage.locator(".option-item").first().click();
    await webviewPage.getByLabel("定位到第 3 题").click();

    await webviewPage.getByTestId("confirmation-collapse-toggle").click();
    await webviewPage.waitForFunction(
      () =>
        (document.querySelector(".options-list") as HTMLElement | null)
          ?.offsetParent === null,
    );
    await webviewPage.getByTestId("confirmation-collapse-toggle").click();
    await webviewPage.waitForFunction(
      () =>
        (document.querySelector(".options-list") as HTMLElement | null)
          ?.offsetParent !== null,
    );

    // 当前题号还在第 3 题，「其他」草稿还在，第 1 题的选中也还在。
    await expect(webviewPage.locator(".question-header-chip")).toHaveText(
      questions[2].question,
    );
    await expect(otherInput).toHaveValue("先发 beta，stable 等下周");
    await webviewPage.getByLabel("定位到第 1 题").click();
    await expect(webviewPage.locator(".option-item").first()).toHaveClass(
      /selected/,
    );
  });

  test("non-AskUserQuestion confirmations have no collapse toggle", async ({
    webviewPage,
  }) => {
    const injector = await openDesktopWithMessages(webviewPage);

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "collapse-bash-1",
      confirmationType: "命令执行待确认",
      toolName: BASH_TOOL_NAME,
      toolInput: { command: "pnpm test", description: "运行测试" },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    // 折叠只挂在 AskUserQuestion 上：Bash/diff 这类弹窗收起来就是把批准依据
    // 藏掉（盲批），语义上不该有；关闭键照旧。
    await expect(
      webviewPage.getByTestId("confirmation-collapse-toggle"),
    ).toHaveCount(0);
    await expect(webviewPage.locator(".confirmation-close-btn")).toBeVisible();
    await expect(webviewPage.locator(".confirmation-dialog")).not.toHaveClass(
      /is-options-collapsed/,
    );
  });
});
