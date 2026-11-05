import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * 助手消息底部复制按钮的几何与显隐（spec: ui/message-rendering-system.md
 * 「助手消息底部的复制按钮」场景 1/2/4/5/9）。
 *
 * 单测那侧只能验「复制什么」，显隐与「悬停不跳版」必须真 Chromium：动作行
 * **始终占位**、按钮默认 `opacity: 0` + `pointer-events: none`，最后一条常驻、
 * 历史消息悬停才显现。这三件事只要有一条写错，jsdom 都看不出来。
 */
test.describe("Assistant message copy action row", () => {
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

  const readButton = (
    webviewPage: import("@playwright/test").Page,
    id: string,
  ) =>
    webviewPage.evaluate((messageId) => {
      const message = document.querySelector<HTMLElement>(
        `.message[data-message-id="${messageId}"]`,
      )!;
      const row = message.querySelector<HTMLElement>(
        '[data-testid="assistant-message-actions"]',
      )!;
      const btn = row.querySelector<HTMLElement>(
        '[data-testid="assistant-copy"]',
      )!;
      const rowBox = row.getBoundingClientRect();
      return {
        alwaysVisible: row.getAttribute("data-always-visible"),
        opacity: getComputedStyle(btn).opacity,
        pointerEvents: getComputedStyle(btn).pointerEvents,
        rowTop: rowBox.top,
        rowHeight: rowBox.height,
        // 按钮相对**消息**的左偏移：动作行渲染在最后一个 `.timeline-row` 内部、
        // 继承那一行的内边距，所以量到的是「与正文同一左基线」（12px）。
        btnLeft:
          btn.getBoundingClientRect().left -
          message.getBoundingClientRect().left,
      };
    }, id);

  test("history is revealed on hover without shifting the layout; the last one stays visible", async ({
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
    await injector.updateMessages(messages);

    const historyMessage = webviewPage.locator(
      '.message[data-message-id="a1"]',
    );
    const lastMessage = webviewPage.locator('.message[data-message-id="a2"]');

    // 场景 2：最后一条常驻可见、历史消息默认隐藏但**占着位置**。
    await expect(
      lastMessage.locator('[data-testid="assistant-copy"]'),
    ).toHaveCSS("opacity", "1");
    const before = await readButton(webviewPage, "a1");
    expect(before.alwaysVisible).toBeNull();
    expect(before.opacity).toBe("0");
    // 看不见就不该能点到（触控设备上消息底边一按就复制了才是真问题）。
    expect(before.pointerEvents).toBe("none");
    expect(before.rowHeight).toBeGreaterThan(0);
    // 场景 1：底部动作行左对齐，与正文同一左基线（.timeline-row 的 12px）。
    expect(before.btnLeft).toBeCloseTo(12, 0);

    // 悬停历史消息：按钮显出来，而动作行（以及它后面的内容）位置一动不动。
    await historyMessage.hover();
    await expect(
      historyMessage.locator('[data-testid="assistant-copy"]'),
    ).toHaveCSS("opacity", "1");
    const after = await readButton(webviewPage, "a1");
    expect(after.pointerEvents).toBe("auto");
    expect(after.rowTop).toBeCloseTo(before.rowTop, 0);
    expect(after.rowHeight).toBeCloseTo(before.rowHeight, 0);
  });

  test("clicking copies the reply's markdown source and shows a check", async ({
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
    await injector.updateMessages(messages);

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

    const copy = webviewPage
      .locator('.message[data-message-id="a2"]')
      .getByTestId("assistant-copy");
    await copy.click();

    // 场景 4：文本块按空行拼接的原始 Markdown，工具/推理内容不在里面。
    const copied = await webviewPage.evaluate(
      () => (window as unknown as { __copied: string | null }).__copied,
    );
    expect(copied).toBe("第二轮回答。");

    // 场景 5：图标转对勾、可访问名换成「已复制」。
    await expect(copy).toHaveAttribute("aria-label", "已复制");
    await expect(copy).toHaveAttribute("data-copied", "true");
    await expect(copy.locator(".codicon")).toHaveClass(/codicon-check/);
  });

  test("keyboard focus reveals the button on a history message", async ({
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
    await injector.updateMessages(messages);

    // 场景 9：隐藏态不阻止聚焦，聚焦即显现（隐藏用的是 opacity + pointer-events，
    // 不是 display/visibility —— 那两种会让按钮彻底离开键盘路径）。
    const button = webviewPage.locator(
      '.message[data-message-id="a1"] [data-testid="assistant-copy"]',
    );
    await expect(button).toHaveCount(1);
    await button.focus();
    await expect(button).toHaveCSS("opacity", "1");
  });

  /**
   * 富文本那条路（场景 10）：真 Chromium 里 `ClipboardItem` 是原生实现，所以这里
   * 能验证「同一份内容同时交给两种 flavor」，而不是只在 jsdom 里验调用形状。
   * 桩只截 `navigator.clipboard.write`，不碰系统剪贴板。
   */
  test("writes the markdown source and its structure as two clipboard flavors", async ({
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
    await injector.updateMessages(messages);

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

    // 历史消息的按钮默认隐藏（`pointer-events: none`），先悬停把这一行显出来。
    const historyMessage = webviewPage.locator(
      '.message[data-message-id="a1"]',
    );
    await historyMessage.hover();
    await historyMessage.getByTestId("assistant-copy").click();

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
   * 时间戳（spec「助手消息底部的时间戳」）：与按钮同档显隐，落在 `<time datetime>`
   * 上，位置在行右端。
   */
  test("shows the message time on the right of the row, in step with the button", async ({
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
    await injector.updateMessages(messages);

    const lastTime = webviewPage.locator(
      '.message[data-message-id="a2"] [data-testid="assistant-message-actions"] time',
    );
    await expect(lastTime).toHaveCount(1);
    // 场景 1：最后一条常驻。
    await expect(lastTime).toHaveCSS("opacity", "1");
    // 场景 2/4：datetime 是原始时间戳，可见文本是本地化短格式。
    await expect(lastTime).toHaveAttribute(
      "datetime",
      "2025-07-09T10:30:03.000Z",
    );
    await expect(lastTime).toHaveText(
      /^(?:\d{4}年)?\d{1,2}月\d{1,2}日 \d{2}:\d{2}$/,
    );

    // 位置：复制按钮之后、贴行右端。
    const geometry = await webviewPage.evaluate(() => {
      const message = document.querySelector<HTMLElement>(
        '.message[data-message-id="a2"]',
      )!;
      const row = message.querySelector<HTMLElement>(
        '[data-testid="assistant-message-actions"]',
      )!;
      const btn = row.querySelector<HTMLElement>(
        '[data-testid="assistant-copy"]',
      )!;
      const time = row.querySelector<HTMLElement>("time")!;
      return {
        btnRight: btn.getBoundingClientRect().right,
        timeLeft: time.getBoundingClientRect().left,
        rowRight: row.getBoundingClientRect().right,
        timeRight: time.getBoundingClientRect().right,
      };
    });
    expect(geometry.timeLeft).toBeGreaterThan(geometry.btnRight);
    // 贴右端（留 ≤ 8px 的内边距余量）。
    expect(geometry.rowRight - geometry.timeRight).toBeLessThanOrEqual(8);

    // 场景 1：历史消息上时间与按钮一起隐藏，悬停一起出现。
    const historyTime = webviewPage.locator(
      '.message[data-message-id="a1"] [data-testid="assistant-message-actions"] time',
    );
    await expect(historyTime).toHaveCSS("opacity", "0");
    await webviewPage.locator('.message[data-message-id="a1"]').hover();
    await expect(historyTime).toHaveCSS("opacity", "1");
  });
});

/**
 * 触控档（手机 / 远控页）：没有悬停能力，`:hover` 由 tap 建立（粘滞 hover）。
 * 与右上角那组按钮同一时机——先点一下消息把按钮显出来，再点按钮才复制。
 * 这一档同时锁住「看不见就点不到」：默认 `pointer-events: none`，否则消息底边
 * 一按就复制了。
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

    // 历史消息上的那颗（最后一条的按钮本来就在正文之后常驻，见上一个用例）。
    const copy = webviewPage.locator(
      '.message[data-message-id="a1"] [data-testid="assistant-copy"]',
    );
    // 谁都没碰过：看不见也点不到。
    await expect(copy).toHaveCSS("opacity", "0");
    await expect(copy).toHaveCSS("pointer-events", "none");

    // tap 正文：`:hover` 由这次 tap 建立并粘住，按钮随之出现。
    await webviewPage.getByText("手机上的回答。").tap();
    await expect(copy).toHaveCSS("opacity", "1");

    await copy.tap();
    expect(
      await webviewPage.evaluate(
        () => (window as unknown as { __copied: string | null }).__copied,
      ),
    ).toBe("手机上的回答。");
  });
});
