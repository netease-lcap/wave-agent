import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { BASH_TOOL_NAME, Message } from "wave-agent-sdk";

/**
 * 助手消息右上角的复制按钮（spec: ui/message-rendering-system.md「助手消息的复制
 * 按钮」场景 1/2/4/5/9）。
 *
 * 它是右上角那组动作按钮的一员：与「回滚 / 转后台」共用同一个 `.message-actions`
 * 容器、同一套形状（`message-action-btn`）、同一个显隐时机（悬停消息才出现，触控
 * 档由 tap 建立粘滞悬停）。这些判据全是布局与 `:hover`，jsdom 一律验不了——单测
 * 那侧只看「复制什么」。
 */
test.describe("Assistant message copy action", () => {
  const messages: Message[] = [
    {
      id: "u1",
      role: "user",
      timestamp: "2025-07-09T10:30:00.000Z",
      blocks: [{ type: "text", content: "第一轮问题。" }],
    },
    {
      id: "a1",
      role: "assistant",
      timestamp: "2025-07-09T10:30:01.000Z",
      blocks: [
        { type: "text", content: "## 第一轮回答\n\n改 `app.ts` 就行。" },
        { type: "text", content: "- 第一条\n- 第二条" },
      ],
    },
    {
      id: "u2",
      role: "user",
      timestamp: "2025-07-09T10:30:02.000Z",
      blocks: [{ type: "text", content: "第二轮问题。" }],
    },
    {
      id: "a2",
      role: "assistant",
      timestamp: "2025-07-09T10:30:03.000Z",
      blocks: [{ type: "text", content: "第二轮回答。" }],
    },
  ];

  const seed = async (
    webviewPage: import("@playwright/test").Page,
    isStreaming = false,
  ) => {
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages(messages);
    return injector;
  };

  test("joins the top-right action group and only shows on hover", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);

    const historyMessage = webviewPage.locator(
      '.message[data-message-id="a1"]',
    );
    const lastMessage = webviewPage.locator('.message[data-message-id="a2"]');
    const historyCopy = historyMessage.getByTestId("assistant-copy");
    const lastCopy = lastMessage.getByTestId("assistant-copy");

    // 场景 2：历史消息的按钮与最后一条一样，都默认藏起来——不常驻。
    await expect(historyCopy).toBeHidden();
    await expect(lastCopy).toBeHidden();

    // 悬停消息：整组动作按钮出现（与回滚 / 转后台同一条规则）。
    await historyMessage.hover();
    await expect(historyCopy).toBeVisible();

    // 场景 1：位置在消息右上角，与另一颗动作按钮同一档（`right: 8px`、助手消息
    // 从盒顶往下 8px 落在首行文字那一带，见 e2e/message-action-geometry.e2e.ts）。
    const geometry = await webviewPage.evaluate(() => {
      const message = document.querySelector<HTMLElement>(
        '.message[data-message-id="a1"]',
      )!;
      const button = message.querySelector<HTMLElement>(
        '[data-testid="assistant-copy"]',
      )!;
      const m = message.getBoundingClientRect();
      const b = button.getBoundingClientRect();
      return {
        fromRight: m.right - b.right,
        fromTop: b.top - m.top,
        group: button.closest(".message-actions") !== null,
      };
    });
    expect(geometry.group).toBe(true);
    expect(geometry.fromRight).toBeCloseTo(8, 0);
    expect(geometry.fromTop).toBeCloseTo(8, 0);

    // 场景 9：形状与另一颗动作按钮完全一致（同一个组件产出的类名）。
    await expect(historyCopy).toHaveClass(/message-action-btn/);

    // 移开鼠标又藏回去。
    await webviewPage.mouse.move(2, 2);
    await expect(historyCopy).toBeHidden();
  });

  test("clicking copies the reply's markdown source and shows a check", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);

    // 真实 Chromium 里不碰系统剪贴板：装一个记录用的桩，读回被复制的原文。
    await webviewPage.evaluate(() => {
      (window as unknown as { __copied: string | null }).__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __copied: string | null }).__copied = text;
          },
        },
        configurable: true,
      });
    });

    const message = webviewPage.locator('.message[data-message-id="a1"]');
    await message.hover();
    const copy = message.getByTestId("assistant-copy");
    await copy.click();

    // 场景 4：文本块按空行拼接的原始 Markdown，工具/推理内容不在里面。
    const copied = await webviewPage.evaluate(
      () => (window as unknown as { __copied: string | null }).__copied,
    );
    expect(copied).toBe(
      "## 第一轮回答\n\n改 `app.ts` 就行。\n\n- 第一条\n- 第二条",
    );

    // 场景 5：图标转对勾、可访问名换成「已复制」。
    await expect(copy).toHaveAttribute("aria-label", "已复制");
    await expect(copy.locator(".codicon")).toHaveClass(/codicon-check/);
  });

  test("writes the markdown source and its structure as two clipboard flavors", async ({
    webviewPage,
  }) => {
    await seed(webviewPage);

    /**
     * 富文本那条路（场景 10）：真 Chromium 里 `ClipboardItem` 是原生实现，所以这里
     * 能验证「同一份内容同时交给两种 flavor」，而不是只在 jsdom 里验调用形状。
     * 桩只截 `navigator.clipboard.write`，不碰系统剪贴板。
     */
    await webviewPage.evaluate(() => {
      const win = window as unknown as {
        __flavors: Record<string, string> | null;
        ClipboardItem?: unknown;
      };
      win.__flavors = null;
      // `page.setContent` 的 about:blank 不是安全上下文，原生 `ClipboardItem` 在那里
      // 不存在；这里补一个最小的等价物，验证的是「两种 flavor 都被交出去」这件事。
      win.ClipboardItem = class {
        constructor(private items: Record<string, Blob>) {}
        get types() {
          return Object.keys(this.items);
        }
        getType(type: string) {
          return Promise.resolve(this.items[type]);
        }
      };
      Object.defineProperty(navigator, "clipboard", {
        value: {
          write: async (
            items: { types: string[]; getType: (t: string) => Promise<Blob> }[],
          ) => {
            const record: Record<string, string> = {};
            for (const type of items[0].types) {
              record[type] = await (await items[0].getType(type)).text();
            }
            win.__flavors = record;
          },
          writeText: async () => {
            throw new Error("plain-text path should not be used");
          },
        },
        configurable: true,
      });
    });

    const message = webviewPage.locator('.message[data-message-id="a1"]');
    await message.hover();
    await message.getByTestId("assistant-copy").click();

    // `write` 是异步的，点击返回时那份记录还没落地 —— 等它写进来再读。
    const flavors = await webviewPage
      .waitForFunction(
        () =>
          (window as unknown as { __flavors: Record<string, string> | null })
            .__flavors,
      )
      .then((handle) => handle.jsonValue());
    // text/plain 仍是逐字节的 Markdown 源码（场景 4）。
    expect(flavors?.["text/plain"]).toBe(
      "## 第一轮回答\n\n改 `app.ts` 就行。\n\n- 第一条\n- 第二条",
    );
    // text/html 是同一份内容的结构化渲染，且不带我们的样式类。
    const html = flavors?.["text/html"] ?? "";
    expect(html).toContain("<h2");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>第一条</li>");
    expect(html).not.toMatch(/class=/);
  });

  /**
   * 场景 3 的第二层判据：这一轮还在跑（正文已落定、工具仍在执行）时不给复制
   * 入口，回合结束才给。判据是本轮运行态，不是工具块的 `stage`——所以这里让
   * 工具块**永远**停在 `running`，只在 `endStreaming` 之后期望按钮出现。
   */
  test("stays hidden while the turn is still running, and appears once it ends", async ({
    webviewPage,
  }) => {
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
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "改一下配置。" }],
      },
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [
          { type: "text", content: "我先看一眼配置。", stage: "end" },
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "running",
            parameters: JSON.stringify({ command: "cat config.json" }),
          },
        ],
      },
    ]);

    await expect(webviewPage.getByText("我先看一眼配置。")).toBeVisible();
    // 正文已经落定，但这一轮没结束：不给复制入口。
    await expect(
      webviewPage.locator('[data-testid="assistant-copy"]'),
    ).toHaveCount(0);

    // 回合结束：工具块仍是 `running`（中断 / 后台化留下的那种），入口照常给。
    await injector.simulateExtensionMessage("endStreaming", {});
    await expect(
      webviewPage.locator('[data-testid="assistant-copy"]'),
    ).toHaveCount(1);
  });
});

/**
 * 触控档（手机 / 远控页）：没有悬停能力，`:hover` 由 tap 建立（粘滞 hover）。
 * 与右上角那组按钮同一时机——先点一下消息把按钮显出来，再点按钮才复制。这一档
 * 顺带锁住「没显出来就点不到」：整组是 `display: none`，隐藏时连命中区都没有，
 * 消息上随手一按不会误触复制。
 */
test.describe("Assistant copy button on a touch device", () => {
  test.use({
    remotePage: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("appears after tapping the message, then one tap copies", async ({
    webviewPage,
  }) => {
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
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [{ type: "text", content: "手机上的回答。" }],
      },
      {
        id: "a2",
        role: "assistant",
        timestamp: "2025-07-09T10:30:02.000Z",
        blocks: [{ type: "text", content: "后面还有一条。" }],
      },
    ]);
    await webviewPage.evaluate(() => {
      (window as unknown as { __copied: string | null }).__copied = null;
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text: string) => {
            (window as unknown as { __copied: string | null }).__copied = text;
          },
        },
        configurable: true,
      });
    });

    // 历史消息上的那颗（最后一条同样是悬停 / tap 才显现）。
    const copy = webviewPage.locator(
      '.message[data-message-id="a1"] [data-testid="assistant-copy"]',
    );
    // 谁都没碰过：不可见也就点不到。
    await expect(copy).toBeHidden();

    // tap 正文：`:hover` 由这次 tap 建立并粘住，按钮随之出现。
    await webviewPage.getByText("手机上的回答。").tap();
    await expect(copy).toBeVisible();

    // 再点按钮才复制（一次 tap 不会既显按钮又触发复制）。
    await copy.tap();
    expect(
      await webviewPage.evaluate(
        () => (window as unknown as { __copied: string | null }).__copied,
      ),
    ).toBe("手机上的回答。");
  });
});
