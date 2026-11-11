import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message } from "wave-agent-sdk";

/**
 * Bash 工具块默认收起（spec: ui/message-rendering-system.md「Bash 工具块默认
 * 收起」）。单测（tests/webview/bashToolCollapse.test.tsx）已经钉住了 DOM 契约与
 * 键盘激活；这里补的是**真 Chromium 的几何事实**，单测的 jsdom 风格断言看不出来的
 * 那部分：
 * - 收起行确实只有一行高（命令与输出不参与排版）；
 * - 展开后行真的长高了，虚拟列表的行账本跟着用**真实高度**（后面那些行的 `top`
 *   随之下移），展开时这一行自己的位置不动（阅读位置不跳）；
 * - 真键盘 Enter / Space 触发（原生 button 的激活行为，不是合成事件）。
 *
 * ⚠️ 加载的是 dist 产物：`pnpm -F wave-webview build` 之后再跑。
 */

const OUTPUT = [
  " RUN  v3.6.0 /home/u/proj",
  " ✓ PaymentService.test.ts (8 tests)",
  " ✓ eventBus.test.ts (5 tests)",
  " Test Files  2 passed (2)",
  "      Tests  13 passed (13)",
].join("\n");

function bashMessage(): Message {
  return {
    id: "a_bash_collapse",
    role: "assistant",
    timestamp: "2025-07-09T10:30:00.000Z",
    blocks: [
      { type: "text", content: "跑一下测试。" },
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        parameters: JSON.stringify({
          command: "pnpm test",
          description: "运行测试套件",
        }),
        compactParams: "运行测试套件",
        stage: "end",
        success: true,
        result: OUTPUT,
      },
    ],
  } as unknown as Message;
}

async function seed(page: import("@playwright/test").Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages([bashMessage()]);
  await page.waitForSelector(".bash-tool-header");
}

test("已结束的块收起成一行：正文不参与排版", async ({ webviewPage }) => {
  await seed(webviewPage);

  const row = webviewPage.locator(".bash-tool-header");
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(row).toContainText("Bash");
  await expect(row).toContainText("运行测试套件");

  // 正文节点根本不存在（不是 display:none）
  await expect(webviewPage.locator(".bash-command")).toHaveCount(0);
  await expect(webviewPage.locator(".bash-command-output")).toHaveCount(0);

  // 一行高：`.tool-block` 的固定行高（13px 字 + 18px 行框）
  const box = await row.boundingBox();
  expect(box?.height).toBeLessThan(24);
});

test("点开才排版输出：行变高、后续行的账本跟着真实高度走", async ({
  webviewPage,
}) => {
  await seed(webviewPage);

  const row = webviewPage.locator(".bash-tool-header");
  const virtualRow = webviewPage.locator(
    '[data-measured-message-id="a_bash_collapse"]',
  );
  // 后面那条消息（用来观察行账本是否重算）
  const injector = new MessageInjector(webviewPage);
  await injector.updateMessages([
    bashMessage(),
    {
      id: "u_after_bash",
      role: "user",
      timestamp: "2025-07-09T10:30:05.000Z",
      blocks: [{ type: "text", content: "收到，继续。" }],
    } as unknown as Message,
  ]);

  const before = await virtualRow.boundingBox();
  const afterRowTop = await webviewPage
    .locator('[data-measured-message-id="u_after_bash"]')
    .evaluate((el) => parseFloat((el as HTMLElement).style.top));
  expect(before).not.toBeNull();

  await row.click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const output = webviewPage.locator(".bash-command-output");
  await expect(output).toBeVisible();
  await expect(output).toHaveText(OUTPUT);

  const after = await virtualRow.boundingBox();
  // 真的长高了（输出参与排版）
  expect(after!.height).toBeGreaterThan(before!.height + 40);
  // 这一行自己的位置没动（阅读位置不跳）
  expect(Math.abs(after!.y - before!.y)).toBeLessThanOrEqual(1);
  // 后面那一行被推下去了 = 行账本用的是展开后的真实高度
  const newAfterTop = await webviewPage
    .locator('[data-measured-message-id="u_after_bash"]')
    .evaluate((el) => parseFloat((el as HTMLElement).style.top));
  expect(newAfterTop - afterRowTop).toBeCloseTo(
    after!.height - before!.height,
    0,
  );

  // 再点收起：回到一行高
  await row.click();
  await expect(output).toHaveCount(0);
  const collapsed = await virtualRow.boundingBox();
  expect(collapsed!.height).toBeLessThan(before!.height + 1);
});

test("真键盘：聚焦折叠行后 Enter 展开、Space 收起", async ({ webviewPage }) => {
  await seed(webviewPage);

  const row = webviewPage.locator(".bash-tool-header");
  await row.focus();
  await expect(row).toBeFocused();

  await webviewPage.keyboard.press("Enter");
  await expect(webviewPage.locator(".bash-command-output")).toBeVisible();
  await expect(row).toHaveAttribute("aria-expanded", "true");

  await webviewPage.keyboard.press(" ");
  await expect(webviewPage.locator(".bash-command-output")).toHaveCount(0);
  await expect(row).toHaveAttribute("aria-expanded", "false");
});

test("`!` bash 模式（用户消息）常显、没有折叠入口", async ({ webviewPage }) => {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages([
    {
      id: "u_bang",
      role: "user",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          parameters: "kubectl get pods -n payment",
          stage: "end",
          success: true,
          result: "NAME  READY  STATUS\npayment-service-7f4d  1/1  Running",
        },
      ],
    } as unknown as Message,
  ]);

  await expect(webviewPage.locator(".bash-command-output")).toBeVisible();
  await expect(webviewPage.locator(".bash-tool-header")).toHaveCount(0);
});

test("运行中的块不收起", async ({ webviewPage }) => {
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: true,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages([
    {
      id: "a_bash_running",
      role: "assistant",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [
        {
          type: "tool",
          name: BASH_TOOL_NAME,
          parameters: JSON.stringify({ command: "pnpm dev" }),
          compactParams: "pnpm dev",
          stage: "running",
          result: "VITE v6.0.0  ready in 320 ms",
        },
      ],
    } as unknown as Message,
  ]);

  await expect(webviewPage.locator(".bash-command-output")).toBeVisible();
  await expect(webviewPage.locator(".bash-tool-header")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
});
