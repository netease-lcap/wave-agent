import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { ASK_USER_QUESTION_TOOL_NAME, BASH_TOOL_NAME } from "wave-agent-sdk";

const WORKDIR = "/Users/dev/projects/wave-agent";

/**
 * 提问卡片高度跟内容（ask-user-tool.md「提问卡片高度跟内容、不再固定封顶」）。
 *
 * 卡片此前固定 `max-height: min(70vh, 560px)`：选项一多，可见高度就停在 560px，
 * 其余选项要卡内滚动才看得到；CC 桌面端的提问卡是 `max-height: none`。放开之后
 * 超面板高度不再靠「卡内滚动」兜底，而是「卡片收缩 + 弹窗主体内部滚」——后者是
 * .input-area-container--confirm 那条 flex 收缩链，只能在真实浏览器里量（jsdom 不
 * 解析外部样式表，高度/溢出一律量不到）。
 */
const TALL = { width: 1400, height: 900 };
const SHORT = { width: 900, height: 520 };

/** 旧封顶：改前卡片高度上限（70vh 与 560 取小）。 */
const OLD_CAP = 560;

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 8 个选项：内容高度超过 560（桌面一个选项约 54px），旧封顶会在这道题上生效。 */
const manyQuestions = [
  {
    question: "这一轮先做哪几件事？",
    options: Array.from({ length: 8 }, (_, i) => ({
      label: `候选项 ${i + 1}`,
      description: `第 ${i + 1} 件事的说明`,
    })),
    multiSelect: true,
  },
];

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: r.top,
        bottom: r.bottom,
        height: r.height,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
        visible: el.offsetParent !== null && r.height > 0,
      };
    };
    const list = document.querySelector(".options-list") as HTMLElement;
    const listBox = list.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      card: box(".confirmation-dialog-inner"),
      body: box(".confirmation-body"),
      list: box(".options-list"),
      nav: box(".question-navigation"),
      // 每个选项行是否完整落在列表盒内（半行裁切就是 row.bottom 越过 list.bottom）
      optionsFullyVisible: [...document.querySelectorAll(".option-item")].map(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.bottom <= listBox.bottom + 1 && r.top >= listBox.top - 1;
        },
      ),
    };
  });
}

async function openQuestion(
  page: import("@playwright/test").Page,
  viewport: { width: number; height: number },
  confirmationId: string,
) {
  await page.setViewportSize(viewport);
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("这一轮先确认几件事。", "msg-ch-u1"),
    MockDataGenerator.createAssistantMessage(
      "好的，我把候选项列出来。",
      "msg-ch-a1",
    ),
  ]);
  await expect(page.locator(".message.assistant")).toBeVisible();
  await injector.simulateExtensionMessage("showConfirmation", {
    confirmationId,
    toolName: ASK_USER_QUESTION_TOOL_NAME,
    confirmationType: "需要确认",
    toolInput: { questions: manyQuestions },
  });
  await page.waitForSelector(".confirmation-dialog");
  // 卡片高度跟内容走，等布局稳定再量。
  await page.waitForTimeout(150);
  return injector;
}

test.describe("AskUserQuestion card height", () => {
  test("grows past the old 560px cap and shows every option at once", async ({
    webviewPage,
  }) => {
    await openQuestion(webviewPage, TALL, "card-height-tall");

    const m = await measure(webviewPage);
    expect(m.card).not.toBeNull();
    // 封顶真的没了：内容需要的高度超过旧上限，卡片就长到超过它。
    expect(m.card!.height).toBeGreaterThan(OLD_CAP + 40);
    // 卡片里没有第二个滚动框（内容全部铺开），卡片本身也不溢出。
    expect(m.card!.scrollHeight).toBeLessThanOrEqual(m.card!.clientHeight + 1);
    expect(m.list!.scrollHeight).toBeLessThanOrEqual(m.list!.clientHeight + 1);
    // 8 个选项 +「其他」一次全见，一个都没被裁。
    expect(m.optionsFullyVisible).toHaveLength(9);
    expect(m.optionsFullyVisible.every(Boolean)).toBe(true);
  });

  test("shrinks to the pane and scrolls its body when the pane is short", async ({
    webviewPage,
  }) => {
    await openQuestion(webviewPage, SHORT, "card-height-short");

    const m = await measure(webviewPage);
    // 卡片收在面板内（不顶出视口），高度由可用高度而不是内容决定。
    expect(m.card!.bottom).toBeLessThanOrEqual(m.viewportHeight + 1);
    expect(m.card!.height).toBeLessThan(OLD_CAP);
    // 底部按钮栏与卡头都还在屏上可点。
    expect(m.nav!.visible).toBe(true);
    expect(m.nav!.bottom).toBeLessThanOrEqual(m.card!.bottom + 1);
    // 主体内部滚：选项区这一支是滚动容器（题干 / 进度条 / 按钮栏都不动），
    // 滚到底能看到最后一个选项。
    expect(m.list!.scrollHeight).toBeGreaterThan(m.list!.clientHeight);
    const lastVisible = await webviewPage.evaluate(() => {
      const list = document.querySelector(".options-list") as HTMLElement;
      list.scrollTop = list.scrollHeight;
      const items = document.querySelectorAll(".option-item");
      const last = items[items.length - 1].getBoundingClientRect();
      const listBox = list.getBoundingClientRect();
      return last.bottom <= listBox.bottom + 1 && last.top >= listBox.top - 1;
    });
    expect(lastVisible).toBe(true);
  });

  test("non-question confirmations keep the generic cap", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(TALL);
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await expect(webviewPage.getByTestId("desktop-workdir")).toBeVisible();
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "card-height-bash",
      confirmationType: "命令执行待确认",
      toolName: BASH_TOOL_NAME,
      toolInput: {
        command: "pnpm -F wave-agent-sdk test -- --run",
        description: "运行 SDK 测试",
      },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");

    const card = await webviewPage.evaluate(() => {
      const el = document.querySelector(
        ".confirmation-dialog-inner",
      ) as HTMLElement;
      return {
        height: el.getBoundingClientRect().height,
        isAskUser: el.classList.contains("is-ask-user"),
        maxHeight: getComputedStyle(el).maxHeight,
      };
    });
    // 其余确认类型仍是通用卡：没有问句卡那个「不限高」标记，封顶留在身上
    //（900px 高的视口里 min(70vh, 560px) 解出来就是 560px）。
    expect(card.isAskUser).toBe(false);
    expect(card.maxHeight).toBe("560px");
    expect(card.height).toBeLessThan(OLD_CAP + 1);
  });
});
