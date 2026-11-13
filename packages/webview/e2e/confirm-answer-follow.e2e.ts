import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Page } from "@playwright/test";
import { ASK_USER_QUESTION_TOOL_NAME, BASH_TOOL_NAME } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";

/**
 * 在确认弹窗里作答即恢复钉底跟随（spec ui/message-rendering-system.md 场景 6）。
 *
 * 只有真实浏览器能测：弹窗是内联在输入区位置的（不是覆盖层），它一出现就把消息
 * 列表挤矮，提交作答时弹窗摘掉、列表又把高度拿回来——滚动落点必须按「换高之后」
 * 的量算，否则会短掉弹窗那一截。jsdom 没有布局，单测把容器高度钉死了，量不到这
 * 一段（`tests/webview/autoScrollFollow.test.tsx` 只覆盖判据本身）。
 */

const WORKDIR = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

const QUESTIONS = [
  {
    question: "这次改动要不要一起带上文档？",
    options: [{ label: "带上" }, { label: "先不带" }],
    multiSelect: false,
  },
];

function buildHistory(count: number): Message[] {
  const msgs: Message[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString();
    msgs.push({
      id: `h-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      timestamp,
      blocks: [
        {
          type: "text",
          content: `第 ${i} 条：${"一段把列表撑到必须滚动的历史正文。".repeat(6)}`,
        },
      ],
    });
  }
  return msgs;
}

/** 视口底到内容底的真实距离，以及「回到最新」入口此刻的显隐。 */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const c = document.getElementById("messagesContainer") as HTMLElement;
    const jump = document.querySelector(
      '[data-testid="jump-to-bottom-layer"]',
    ) as HTMLElement | null;
    return {
      gap: Math.round(c.scrollHeight - c.scrollTop - c.clientHeight),
      clientHeight: c.clientHeight,
      hasDialog: !!document.querySelector(".confirmation-dialog"),
      jumpVisible: jump?.dataset.visible === "true",
    };
  });

const waitForBottom = (page: Page) =>
  page.waitForFunction(
    () => {
      const c = document.getElementById("messagesContainer") as HTMLElement;
      return c.scrollHeight - c.scrollTop - c.clientHeight <= 2;
    },
    undefined,
    { timeout: 3000 },
  );

async function setup(page: Page) {
  const injector = new MessageInjector(page);
  await page.setViewportSize({ width: 900, height: 900 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();
  await injector.updateMessages(buildHistory(60));
  await waitForBottom(page);
  return injector;
}

/** 用真实滚轮上滚离开底部，返回上滚后的几何快照。 */
async function wheelUpAwayFromBottom(page: Page) {
  const box = await page.locator("#messagesContainer").boundingBox();
  if (!box) throw new Error("no messages container box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(200);
  const parked = await geometry(page);
  expect(parked.gap).toBeGreaterThan(200);
  expect(parked.jumpVisible).toBe(true);
  return parked;
}

test.describe("answering a confirmation dialog re-arms bottom follow", () => {
  test("AskUserQuestion submit: viewport returns to the real bottom and keeps following", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "auq-follow-1",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: { questions: QUESTIONS },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");
    const parked = await wheelUpAwayFromBottom(webviewPage);

    await webviewPage.locator('[data-option-index="0"]').first().click();
    await webviewPage.getByRole("button", { name: /提交回答/ }).click();

    // 弹窗摘掉、输入区回来，列表拿回高度之后必须落在真实底部。
    await waitForBottom(webviewPage);
    const landed = await geometry(webviewPage);
    expect(landed.hasDialog).toBe(false);
    expect(landed.clientHeight).toBeGreaterThan(parked.clientHeight);
    expect(landed.jumpVisible).toBe(false);

    // 而且真的重新钉上了：这一轮后续的内容继续把视口带到底部。
    const next = buildHistory(60);
    next.push({
      id: "reply-1",
      role: "assistant",
      timestamp: new Date().toISOString(),
      blocks: [{ type: "text", content: "收到，我继续。" }],
    } as Message);
    await injector.updateMessages(next);
    await waitForBottom(webviewPage);
  });

  test("permission dialog rejected: viewport returns to the real bottom", async ({
    webviewPage,
  }) => {
    const injector = await setup(webviewPage);

    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "bash-follow-1",
      toolName: BASH_TOOL_NAME,
      confirmationType: "Bash 命令执行确认",
      toolInput: { command: "npm run dev" },
    });
    await webviewPage.waitForSelector(".confirmation-dialog");
    await wheelUpAwayFromBottom(webviewPage);

    await webviewPage.locator(".confirmation-close-btn").click();

    await waitForBottom(webviewPage);
    const landed = await geometry(webviewPage);
    expect(landed.hasDialog).toBe(false);
    expect(landed.jumpVisible).toBe(false);
  });
});
