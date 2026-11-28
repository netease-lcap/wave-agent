import { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * 收起内容时视口不得被推到别处（spec ui/focus-view.md 场景 1）。
 *
 * 内容一变矮，浏览器会把 `scrollTop` 夹到新的 max 上；锚点补偿的 `delta` 却是按
 * **变矮之前**的位置算的。落位若以夹取后的 `container.scrollTop` 当基准，同一段
 * 位移就被扣两遍：实测开启聚焦视图那一下 `st` 从 16681 被夹到 7927、`delta`
 * -8898，写进 -971 → 夹到 0，整段对话跳回开头。
 *
 * 判据用离底距离：在底部附近（已离底 400px、未钉底）收起，落位仍该在底部附近。
 */
const PARA =
  "这里是一段用于撑高行高的中文正文，长度接近真实回答里的一段话，它会在手机列宽下折成好几行，而估算器并不知道列宽是多少。";

const TURN_COUNT = 30;

function buildMessages(): Message[] {
  const out: Message[] = [];
  let n = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1) + n++ * 60000).toISOString();
  for (let t = 0; t < TURN_COUNT; t++) {
    out.push({
      id: "u" + t,
      role: "user",
      timestamp: ts(),
      blocks: [
        {
          type: "text",
          content: "第 " + t + " 个问题：帮我看下这个文件，顺便解释一下原因",
        },
      ],
    } as unknown as Message);
    out.push({
      id: "a" + t + "-1",
      role: "assistant",
      timestamp: ts(),
      blocks: [
        { type: "reasoning", content: "先看看这个文件。" },
        {
          type: "text",
          content: Array.from({ length: 3 }, () => PARA).join("\n\n"),
        },
        {
          type: "tool",
          stage: "end",
          name: "Read",
          parameters: JSON.stringify({ file_path: "/tmp/a.ts" }),
          shortResult: "30 lines",
          success: true,
        },
      ],
    } as unknown as Message);
    out.push({
      id: "a" + t + "-2",
      role: "assistant",
      timestamp: ts(),
      blocks: [
        {
          type: "text",
          content:
            "回答 " +
            t +
            "：\n\n" +
            Array.from({ length: 2 }, () => PARA).join("\n\n"),
        },
      ],
    } as unknown as Message);
  }
  return out;
}

/** 离底距离（px）：越大说明视口越靠上。 */
async function fromBottom(page: Page) {
  return page.evaluate(() => {
    const c = document.getElementById("messagesContainer")!;
    return Math.round(c.scrollHeight - c.clientHeight - c.scrollTop);
  });
}

test.describe("收起时的锚点补偿", () => {
  test.use({
    remotePage: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("开启聚焦视图后视口仍在底部附近", async ({ webviewPage }) => {
    test.setTimeout(180000);
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages(buildMessages());
    await injector.endStreaming();
    await webviewPage.waitForTimeout(2500);

    // 从底部往上离底 400px：仍在一屏之内，但已经不钉底。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollTop - 400;
    });
    await webviewPage.waitForTimeout(900);
    expect(await fromBottom(webviewPage)).toBeGreaterThan(300);

    // 开启聚焦视图 = 每一轮收成一行卡头，内容瞬间变矮上万像素。
    await webviewPage.getByTestId("more-btn").click();
    await webviewPage.waitForTimeout(200);
    await webviewPage.getByTestId("more-menu-focus-view-on").click();
    await webviewPage.waitForTimeout(1500);

    expect(
      await webviewPage.locator('[data-testid="focus-fold"]').count(),
    ).toBeGreaterThan(0);
    // 有 bug 时这里是几千像素（视口被推到对话开头）。
    expect(await fromBottom(webviewPage)).toBeLessThan(250);
  });
});
