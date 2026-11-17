import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "wave-agent-sdk";

/**
 * 提问卡在插件端（VS Code / JetBrains 共用 ChatApp）也走同一条收缩链
 * （ask-user-tool.md「提问卡片高度跟内容、不再固定封顶」场景 2 / 4）。
 *
 * 桌面端早就有「输入区可缩 → 卡片可缩 → 主体内部滚」那条链，插件端没有：
 * `.input-area-container` 是 `min-height: auto`、不可收缩，卡片封顶一放开就会
 * 顶出面板、底部按钮栏够不着。这条链只能在真实浏览器里量（jsdom 不解析外部
 * 样式表），所以断言落在这里。
 */
const VIEWPORT = { width: 400, height: 600 };

const questions = [
  {
    question: "这一轮先做哪几件事？",
    options: Array.from({ length: 8 }, (_, i) => ({
      label: `候选项 ${i + 1}`,
      description: `第 ${i + 1} 件事的说明，够长能让选项行折行`,
    })),
    multiSelect: true,
  },
];

test("an over-long question card stays inside the pane and keeps the action bar reachable", async ({
  webviewPage,
}) => {
  await webviewPage.setViewportSize(VIEWPORT);
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  // 会话里得有内容：欢迎页那一档 `.ide-chat-main` 是 `flex: none; height: auto`
  //（品牌标与输入卡整组居中），不在这条收缩链的语义里；真实场景里提问卡是在
  // 一轮对话中弹出来的，走的是下面的常规布局。
  await injector.updateMessages([
    {
      id: "msg-ide-h-u1",
      role: "user",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [{ type: "text", content: "这一轮先确认几件事。" }],
    },
  ]);
  await injector.simulateExtensionMessage("showConfirmation", {
    confirmationId: "ide-card-height",
    toolName: ASK_USER_QUESTION_TOOL_NAME,
    confirmationType: "需要确认",
    toolInput: { questions },
  });
  await webviewPage.waitForSelector(".confirmation-dialog");
  await webviewPage.waitForTimeout(150);

  const m = await webviewPage.evaluate(() => {
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
    return {
      viewportHeight: window.innerHeight,
      card: box(".confirmation-dialog-inner"),
      list: box(".options-list"),
      nav: box(".question-navigation"),
      // 卡片本身不许溢出：容器 overflow:hidden 夹住它，卡内再滚。
      cardOverflows: (() => {
        const el = document.querySelector(
          ".confirmation-dialog-inner",
        ) as HTMLElement;
        return el.scrollHeight > el.clientHeight + 1;
      })(),
    };
  });

  expect(m.card).not.toBeNull();
  // 卡片收在视口里（放开封顶前它会把面板顶出去，按钮栏跟着跑出屏外）。
  expect(m.card!.top).toBeGreaterThanOrEqual(0);
  expect(m.card!.bottom).toBeLessThanOrEqual(m.viewportHeight + 1);
  // 底部三按钮仍在屏上可点。
  expect(m.nav!.visible).toBe(true);
  expect(m.nav!.bottom).toBeLessThanOrEqual(m.viewportHeight + 1);
  // 选项区自己滚：滚到底能看到最后一个选项。
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
