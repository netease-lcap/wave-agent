import { expect, test } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 流式中收起折叠卡，上方内容不许跳。
 *
 * 复现的是「点卡的卡头收起时整屏上下抖一下」：收起让卡头那一行的
 * `padding-bottom` 从 0 变成轮末留白（29），如果这块留白混在行的实测高度里，
 * 账本要等 ResizeObserver 下一帧才追上 —— 中间那一帧 spacer 比真实内容少 29px，
 * 浏览器把 `scrollTop` 夹到这个偏小的 max 上并画出去，下一帧钉底再拉回来。
 * 逐帧采样能抓到「行整体位移 29 再回位」，因此断言是：任何相邻两帧之间，
 * 视口内每一行的位移都不超过 1px，且 `scrollTop` 不回退。
 */

const PARA =
  "这里是一段用于撑高行高的中文正文，长度接近真实回答里的一段话，它会在手机列宽下折成好几行，而估算器并不知道列宽是多少。";

function buildTurns(turns: number): Message[] {
  const out: Message[] = [];
  let n = 0;
  const ts = () => new Date(Date.UTC(2026, 0, 1) + n++ * 60000).toISOString();
  for (let t = 0; t < turns; t++) {
    out.push({
      id: "u" + t,
      role: "user",
      timestamp: ts(),
      blocks: [
        { type: "text", content: "第 " + t + " 个问题：帮我看下这个文件" },
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

/** 正在生成的那一轮：第 i 步追加一条活动，模拟流式增长。 */
function streamingTail(step: number): Message[] {
  const out: Message[] = [];
  for (let i = 0; i < step; i++) {
    out.push({
      id: "s" + i,
      role: "assistant",
      timestamp: new Date(Date.UTC(2026, 1, 1) + i * 1000).toISOString(),
      blocks: [
        {
          type: "text",
          content: Array.from({ length: 2 }, () => PARA).join("\n\n"),
        },
        {
          type: "tool",
          stage: "end",
          name: "Read",
          parameters: JSON.stringify({ file_path: "/tmp/b" + i + ".ts" }),
          shortResult: "30 lines",
          success: true,
        },
      ],
    } as unknown as Message);
  }
  return out;
}

type Frame = {
  t: number;
  st: number;
  sh: number;
  rows: Record<string, number>;
};

test.describe("折叠卡收起不抖动", () => {
  test.use({
    remotePage: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });

  test("流式中点最后一张卡的卡头收起，上方内容不跳", async ({
    webviewPage,
  }) => {
    test.setTimeout(180000);
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    const history = buildTurns(30);
    await injector.updateMessages(history);
    await injector.endStreaming();
    await webviewPage.waitForTimeout(2000);
    await webviewPage.getByTestId("more-btn").click();
    await webviewPage.waitForTimeout(150);
    await webviewPage.getByTestId("more-menu-focus-view-on").click();
    await webviewPage.waitForTimeout(1200);

    // 开始流式：从这一刻起列表一直钉底，收起走的是「钉底 → scrollToEnd」那条路。
    await injector.startStreaming();
    let stop = false;
    const pump = (async () => {
      for (let step = 1; step <= 40 && !stop; step++) {
        await injector.updateMessages([...history, ...streamingTail(step)]);
        await webviewPage.waitForTimeout(120);
      }
    })();
    await webviewPage.waitForTimeout(900);

    // 上方内容远超一屏。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer");
      if (c) c.scrollTop = c.scrollTop - 400;
    });
    await webviewPage.waitForTimeout(500);

    // 最后一张卡（正在生成的那一轮）：先滚进视口中间，再用**真实触控 tap**。
    // `element.click()` 不走触摸事件分支，抓不到手机上走的那条路。
    const lastCardKey = () =>
      webviewPage.evaluate(() => {
        const heads = Array.from(
          document.querySelectorAll('[data-testid="focus-fold-head"]'),
        ) as HTMLElement[];
        const target = heads[heads.length - 1];
        if (!target) return null;
        const c = document.getElementById("messagesContainer")!;
        const r = target.getBoundingClientRect();
        if (r.top < 120 || r.bottom > 640) c.scrollTop += r.top - 360;
        return (
          target
            .closest("[data-virtual-key]")
            ?.getAttribute("data-virtual-key") ?? null
        );
      });
    const tapPoint = (key: string) =>
      webviewPage.evaluate((k) => {
        const el = document.querySelector(
          '[data-virtual-key="' + k + '"] [data-testid="focus-fold-head"]',
        ) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.left + r.width / 2),
          y: Math.round(r.top + r.height / 2),
        };
      }, key);

    const card = await lastCardKey();
    expect(card).not.toBeNull();
    await webviewPage.waitForTimeout(400);

    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      const w = window as unknown as { __frames: Frame[] };
      w.__frames = [];
      const t0 = performance.now();
      const tick = () => {
        const rows: Record<string, number> = {};
        for (const r of Array.from(c.querySelectorAll("[data-virtual-key]"))) {
          const rect = r.getBoundingClientRect();
          if (rect.bottom <= 0 || rect.top >= c.clientHeight) continue;
          rows[r.getAttribute("data-virtual-key")!] = Math.round(rect.top);
        }
        w.__frames.push({
          t: Math.round(performance.now() - t0),
          st: Math.round(c.scrollTop),
          sh: Math.round(c.scrollHeight),
          rows,
        });
        if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await webviewPage.waitForTimeout(120);

    // 展开
    const tap1 = await tapPoint(card!);
    expect(tap1).not.toBeNull();
    await webviewPage.touchscreen.tap(tap1!.x, tap1!.y);
    await webviewPage.waitForTimeout(900);
    await expect(
      webviewPage.locator(
        '[data-testid="focus-fold-head"][aria-expanded="true"]',
      ),
    ).toHaveCount(1);

    // 收起 —— 这一下以前会整屏下移 29px 再回位
    const tap2 = await tapPoint(card!);
    expect(tap2).not.toBeNull();
    await webviewPage.touchscreen.tap(tap2!.x, tap2!.y);
    await webviewPage.waitForTimeout(1300);
    stop = true;
    await pump;

    const frames = await webviewPage.evaluate(
      () => (window as unknown as { __frames: Frame[] }).__frames,
    );
    expect(frames.length).toBeGreaterThan(20);

    const jumps: string[] = [];
    let worst = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1];
      const b = frames[i];
      if (b.st < a.st - 1) {
        jumps.push("t=" + b.t + " scrollTop 回退 " + a.st + "→" + b.st);
      }
      for (const k of Object.keys(b.rows)) {
        if (!(k in a.rows)) continue;
        const d = b.rows[k] - a.rows[k];
        if (Math.abs(d) <= 1) continue;
        worst = Math.max(worst, Math.abs(d));
        jumps.push("t=" + b.t + " " + k + " " + a.rows[k] + "→" + b.rows[k]);
      }
    }
    expect({ worst, jumps: jumps.slice(0, 8) }).toEqual({
      worst: 0,
      jumps: [],
    });
  });
});
