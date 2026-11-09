import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const DIR = "/Users/dev/projects/wave-agent";

/**
 * 会话内查找浮层的**盒模型**（spec ui/transcript-find.md 场景 1：浮层贴在内容区
 * 右上角、不挤压消息列表）。
 *
 * 浮层住处是一个 `height: 0` 的 sticky 槽位（零占位），浮层本体是它的 flex
 * 子项——交叉轴上只要退回默认的 `stretch`，本体就被压成 0 高、只剩 padding 与
 * 描边，输入框和按钮从胶囊上下沿溢出来（2026-11-09 设计师反馈的那一版）。
 * jsdom 没有布局，这条只能在真引擎里量。
 */

const seedConversation = async (injector: MessageInjector) => {
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
  });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR,
    recentWorkdirs: [DIR],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await injector.updateMessages([
    {
      id: "m1",
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: "连接池老是耗尽，帮我看看" }],
    },
    {
      id: "m2",
      role: "assistant",
      timestamp: "2026-01-01T00:00:01.000Z",
      blocks: [
        {
          type: "text",
          content: "检查发现连接池耗尽，另有一处连接池上限设得太小。",
        },
      ],
    },
  ] as unknown as Parameters<typeof injector.updateMessages>[0]);
  await injector.endStreaming();
};

test.describe("Transcript find bar box", () => {
  test("浮层本体包住输入框与按钮，槽位仍然零占位", async ({
    webviewPage: page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 780 });
    const injector = new MessageInjector(page);
    await seedConversation(injector);

    await page.keyboard.press("Control+f");
    await page.getByTestId("transcript-find-input").fill("连接池");
    await expect(page.getByTestId("transcript-find-count")).toHaveText("1/3");

    const geo = await page.evaluate(() => {
      const rect = (selector: string) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, height: box.height };
      };
      return {
        slot: rect(".transcript-find-slot"),
        bar: rect(".transcript-find"),
        input: rect(".transcript-find-input"),
        close: rect('[data-testid="transcript-find-close"]'),
      };
    });

    expect(geo.slot?.height).toBe(0);
    // 胶囊把两个最高的子项（输入框 24px、按钮 22px）完整包住。
    for (const child of [geo.input, geo.close]) {
      expect(child).not.toBeNull();
      expect(geo.bar!.top).toBeLessThanOrEqual(child!.top);
      expect(geo.bar!.bottom).toBeGreaterThanOrEqual(child!.bottom);
    }
    expect(geo.bar!.height).toBeGreaterThan(geo.input!.height);
  });
});
