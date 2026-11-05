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
