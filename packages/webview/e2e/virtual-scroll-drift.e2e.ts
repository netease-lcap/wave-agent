import { CDPSession, Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * 上滑翻页时「内容相对手指的位移」（spec `ui/message-rendering-system.md` 验收
 * 场景 4/5）。
 *
 * 判据：**用户滚动之外的位移**。手指让列表滚 S，内容就该整体下移 S；多出来的那
 * 一截就是账本修正（行第一次被量到、估算被实测替换）漏到屏幕上的位移——也就是
 * 用户说的「滑着滑着定位突然变了」。
 *
 * 补偿是我们自己写 scrollTop 做的，所以「用户滚了多少」= `ΔscrollTop` 减去
 * **我们自己写的量**。两种写法给的项目结论完全相反，实测对照（同一场景、手机档）：
 *
 * | 写法 | 有补偿 | 关掉补偿 |
 * | --- | --- | --- |
 * | `Δrect.top + ΔscrollTop`（旧） | 71px | 71px |
 * | `Δrect.top + 用户滚动`（本文件） | **0px** | 71px／次，17 次共 1207px |
 *
 * 旧式子恒等于「这行的内容偏移变了多少」，把补偿整笔抵消掉，对「看不看得见」是
 * 瞎的。同一组实测还证明：`overflow-anchor: auto` 在绝对定位的行模型里一笔都不补
 * （开关它、且关掉我们的补偿，数字与关掉锚定完全一致），所以浏览器滚动锚定不是
 * 这里的备选方案。
 */
const PARAGRAPH =
  "这里是一段用于撑高行高的中文正文，长度接近真实回答里的一段话，它会在手机列宽下折成好几行，而估算器并不知道列宽是多少。";
const CODE = Array.from(
  { length: 12 },
  (_, n) => `const value_${n} = compute(${n});`,
).join("\n");
/** 单帧允许的位移：估算误差被补偿吃掉之后剩下的那一截，肉眼不可见。 */
const MAX_VISIBLE_JUMP_PX = 8;

function buildMessages(count: number, prefix = "m"): Message[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${i}`,
    role: "assistant",
    timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
    blocks: [
      { type: "reasoning", content: "先看看这个文件。" },
      {
        type: "text",
        content: Array.from({ length: 6 }, () => PARAGRAPH).join("\n\n"),
      },
      {
        type: "tool",
        stage: "end",
        name: "Read",
        parameters: JSON.stringify({ file_path: "/tmp/a.ts" }),
        shortResult: "30 lines",
        success: true,
      },
      { type: "text", content: `回答 ${i}：\n\n\`\`\`ts\n${CODE}\n\`\`\`` },
    ],
  })) as unknown as Message[];
}

declare global {
  interface Window {
    __jumpEvents?: number[];
    /** 逐次位移的明细（`startProbe` 维护）。 */
    __jumpDetail?: {
      jump: number;
      dTop: number;
      dScroll: number;
      dWrite: number;
      transform: string;
    }[];
    /** 我们自己写进 scrollTop 的净量（`installScrollRecorder` 维护）。 */
    __writeSum?: number;
    /** 手势窗口内的观测值（`installGestureProbe` 维护）。 */
    __gesture?: {
      downWrite: number | null;
      maxTransform: number;
    };
  }
}

/** 手机档：视口 390×844 + 触控模拟（`@media (pointer: coarse)` 才会命中 15px 字号）。 */
async function emulatePhone(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  return cdp;
}

/**
 * 记下内核自己写 scrollTop 的净量。必须按原样转发：`scrollTo(options, undefined)`
 * 会被当成 `(x, y)` 重载调到 `scrollTo(0, 0)`，把容器打到顶部（实测踩到过）。
 */
async function installScrollRecorder(page: Page) {
  await page.evaluate(() => {
    const container = document.getElementById("messagesContainer")!;
    window.__writeSum = 0;
    const real = container.scrollTo.bind(container);
    container.scrollTo = function (
      this: HTMLDivElement,
      arg: ScrollToOptions | number,
      y?: number,
    ) {
      const before = container.scrollTop;
      if (typeof arg === "number") real(arg, y as number);
      else real(arg);
      window.__writeSum =
        (window.__writeSum ?? 0) + (container.scrollTop - before);
    } as typeof container.scrollTo;
  });
}

async function startProbe(page: Page) {
  await page.evaluate(() => {
    const container = document.getElementById("messagesContainer")!;
    const events: number[] = [];
    const detail: NonNullable<Window["__jumpDetail"]> = [];
    window.__jumpEvents = events;
    window.__jumpDetail = detail;
    const transformNow = () =>
      container.querySelector<HTMLElement>(".virtual-canvas")?.style
        .transform ?? "";
    let prev:
      | { key: string; top: number; scrollTop: number; writeSum: number }
      | undefined;
    const tick = () => {
      // 跟踪「视口顶那一行」：用户看到的就是它。
      const row = Array.from(
        container.querySelectorAll<HTMLElement>(".virtual-row"),
      ).find((el) => el.getBoundingClientRect().bottom > 1);
      const key = row?.dataset.measuredMessageId;
      if (row && key) {
        const top = row.getBoundingClientRect().top;
        const scrollTop = container.scrollTop;
        const writeSum = window.__writeSum ?? 0;
        if (prev && prev.key === key) {
          const userScroll =
            scrollTop - prev.scrollTop - (writeSum - prev.writeSum);
          const jump = top - prev.top + userScroll;
          if (Math.abs(jump) > 1) {
            events.push(Math.round(jump));
            detail.push({
              jump: Math.round(jump),
              dTop: Math.round(top - prev.top),
              dScroll: Math.round(scrollTop - prev.scrollTop),
              dWrite: Math.round(writeSum - prev.writeSum),
              transform: transformNow(),
            });
          }
        }
        prev = { key, top, scrollTop, writeSum };
      } else {
        prev = undefined;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 手势窗口观测：手指按下那一刻的写量、抬起那一刻的写量，以及画布 `translateY`
 * 的峰值。前者用来证明「手势期一次 scrollTop 都没写」，后者证明补偿确实落在了
 * 视觉偏移上（而不是被丢掉）。
 */
async function installGestureProbe(page: Page) {
  await page.evaluate(() => {
    const container = document.getElementById("messagesContainer")!;
    const state = { downWrite: null, maxTransform: 0 } as NonNullable<
      Window["__gesture"]
    >;
    window.__gesture = state;
    const offset = () => {
      const canvas = container.querySelector<HTMLElement>(".virtual-canvas");
      const match = /translateY\((-?[\d.]+)px\)/.exec(
        canvas?.style.transform ?? "",
      );
      return match ? Math.abs(parseFloat(match[1])) : 0;
    };
    container.addEventListener("touchstart", () => {
      if (state.downWrite === null) state.downWrite = window.__writeSum ?? 0;
    });
    const tick = () => {
      state.maxTransform = Math.max(state.maxTransform, offset());
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** 真的触控事件（`Input.synthesizeScrollGesture` 的 touch 源在无头 Chromium 里不生效）。 */
async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  x: number,
  y: number,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y }],
  });
}

test.describe("virtual list scroll drift", () => {
  test.use({ remotePage: true });
  test("上滑穿过未量过的行时，内容不相对手指跳", async ({ webviewPage }) => {
    test.setTimeout(180000);
    await emulatePhone(webviewPage);
    await webviewPage.waitForTimeout(200);

    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages(buildMessages(24));
    await injector.endStreaming();
    await webviewPage.waitForTimeout(1200);

    await installScrollRecorder(webviewPage);
    // 离开底部：钉底状态下账本变化走「跟随到底」，是另一条路径。滚动事件里
    // scrollTop 变小就会解除钉底。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollTop - 600;
    });
    await webviewPage.waitForTimeout(500);
    await startProbe(webviewPage);

    // 一屏一屏往上翻：每一页都会挂载一批从没量过的行。
    for (let step = 0; step < 40; step++) {
      const atTop = await webviewPage.evaluate(() => {
        const c = document.getElementById("messagesContainer") as HTMLElement;
        c.scrollTop = Math.max(0, c.scrollTop - 600);
        return c.scrollTop <= 0;
      });
      await webviewPage.waitForTimeout(100);
      if (atTop) break;
    }
    await webviewPage.waitForTimeout(300);

    const events = await webviewPage.evaluate(() => window.__jumpEvents ?? []);
    const worst = events
      .slice()
      .sort((a, b) => Math.abs(b) - Math.abs(a))
      .slice(0, 5);
    console.log(
      `[drift] n=${events.length} max=${worst[0] ?? 0} worst=${JSON.stringify(worst)}`,
    );
    // 行的实测高度与估算对不上时，内核必须在同一帧把 scrollTop 补回去；补漏了
    // 就是用户看到的那一跳（实测漏掉的版本每次 71px）。
    expect(Math.abs(worst[0] ?? 0)).toBeLessThanOrEqual(MAX_VISIBLE_JUMP_PX);
  });

  test("手指按着屏幕时账本修正不写 scrollTop，只抬画布的视觉偏移", async ({
    webviewPage,
  }) => {
    test.setTimeout(180000);
    const cdp = await emulatePhone(webviewPage);
    await webviewPage.waitForTimeout(200);

    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    const firstPage = buildMessages(24);
    await injector.updateMessages(firstPage);
    await injector.endStreaming();
    await webviewPage.waitForTimeout(1200);

    await installScrollRecorder(webviewPage);
    // 离开底部：钉底那一路走「跟随到底」，是另一条路径。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollTop - 600;
    });
    await webviewPage.waitForTimeout(500);
    await startProbe(webviewPage);
    await installGestureProbe(webviewPage);

    // 手指按下去往右下滑（= 翻更早的内容），中途「更早一页」到了——远端页上翻
    // 加载历史就是这条路径，账本会在手势进行中被改。
    const x = 195;
    await touch(cdp, "touchStart", x, 300);
    for (let i = 1; i <= 4; i++) {
      await touch(cdp, "touchMove", x, 300 + i * 20);
      await webviewPage.waitForTimeout(16);
    }
    await injector.updateMessages([...buildMessages(6, "e"), ...firstPage]);
    for (let i = 5; i <= 10; i++) {
      await webviewPage.waitForTimeout(16);
      await touch(cdp, "touchMove", x, 300 + i * 20);
    }
    await webviewPage.waitForTimeout(60);
    // 手指还按着时的快照：整个手势期（含中途到货的更早一页）一次 scrollTop 都没写。
    const holding = await webviewPage.evaluate(() => ({
      writeSum: window.__writeSum ?? 0,
      transform:
        document.querySelector<HTMLElement>(".virtual-canvas")?.style
          .transform ?? "",
      downWrite: window.__gesture?.downWrite ?? null,
      maxTransform: window.__gesture?.maxTransform ?? 0,
    }));
    await touch(cdp, "touchEnd", x, 500);
    // `touchend` 不一定到得了：touch 事件派给按下那一刻的目标，行在滚动中被回收后
    // 目标已不在文档里，事件不冒泡到容器。内核靠「touch 静默 400ms」兜底折算。
    await webviewPage.waitForTimeout(1500);
    const settled = await webviewPage.evaluate(
      () =>
        document.querySelector<HTMLElement>(".virtual-canvas")?.style
          .transform ?? "",
    );
    const writeAfter = await webviewPage.evaluate(() => window.__writeSum ?? 0);
    const events = await webviewPage.evaluate(() => window.__jumpEvents ?? []);
    const detail = await webviewPage.evaluate(() => window.__jumpDetail ?? []);
    const worst = events
      .slice()
      .sort((a, b) => Math.abs(b) - Math.abs(a))
      .slice(0, 5);
    console.log(
      `[gesture] down=${holding.downWrite} holding=${holding.writeSum} ` +
        `transform="${holding.transform}" max=${holding.maxTransform} ` +
        `folded=${Math.round(writeAfter - holding.writeSum)} settled="${settled}" ` +
        `drift n=${events.length} max=${worst[0] ?? 0}`,
    );
    if (detail.length > 0) {
      console.log(`[gesture-detail] ${JSON.stringify(detail.slice(0, 8))}`);
    }

    // 手指按着期间一次 scrollTop 都没写——写它就会打断惯性、读回陈旧值，那就是
    // 真机上「滑着滑着定位突变」的成因。
    expect(holding.downWrite).not.toBeNull();
    expect(holding.writeSum).toBe(holding.downWrite);
    // 补偿落在画布的视觉偏移上（否则「没写 scrollTop」是空话：那叫漏补偿）。
    expect(holding.transform).toMatch(/^translateY\(-\d+(\.\d+)?px\)$/);
    expect(holding.maxTransform).toBeGreaterThan(100);
    // 停稳后折算：偏移清空，欠的那一截原样进 scrollTop。
    expect(settled).toBe("");
    expect(
      Math.abs(writeAfter - holding.writeSum - holding.maxTransform),
    ).toBeLessThanOrEqual(MAX_VISIBLE_JUMP_PX);
    // 折算前后都没有把位移漏到屏幕上。
    expect(Math.abs(worst[0] ?? 0)).toBeLessThanOrEqual(MAX_VISIBLE_JUMP_PX);
  });

  test("上翻攒下偏移再掉头甩到底：逼近底部的路上也不许露白", async ({
    webviewPage,
  }) => {
    test.setTimeout(180000);
    const cdp = await emulatePhone(webviewPage);
    await webviewPage.waitForTimeout(200);

    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    const firstPage = buildMessages(40);
    await injector.updateMessages(firstPage);
    await injector.endStreaming();
    await webviewPage.waitForTimeout(1500);

    const measure = () =>
      webviewPage.evaluate(() => {
        const c = document.getElementById("messagesContainer")!;
        const rows = document.querySelectorAll<HTMLElement>(".virtual-row");
        const last = rows[rows.length - 1];
        return {
          gap: last
            ? Math.round(
                c.getBoundingClientRect().bottom -
                  last.getBoundingClientRect().bottom,
              )
            : null,
        };
      });

    // 基准：首屏钉在底部，此刻的间距就是「贴着真底」的样子（列的内边距）。
    const baseline = (await measure()).gap ?? 0;

    // 只往上退一屏多一点：真机那条轨迹里「偏移」和「离底距离」是同一量级（705px
    // vs 368px），空白才露得出来。退太远的话这一甩根本够不到底部，偏移全程兑不现。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollTop - 300;
    });
    await webviewPage.waitForTimeout(500);

    // 阶段一：手指往下拖 = 翻更早的内容（scrollTop 变小）。中途更早一页到货，
    // 补偿挂成画布偏移——真机上「上翻读到更早」这一步。
    let y = 300;
    await touch(cdp, "touchStart", 195, y);
    for (let i = 0; i < 6; i++) {
      y += 25;
      await touch(cdp, "touchMove", 195, y);
      await webviewPage.waitForTimeout(16);
    }
    // 只补一条更早的消息（≈800px）：量级对齐真机，偏移才可能大过「离底距离」。
    await injector.updateMessages([...buildMessages(1, "e"), ...firstPage]);
    await webviewPage.waitForTimeout(80);
    const midOffset = await webviewPage.evaluate(() => {
      const match = /translateY\((-?[\d.]+)px\)/.exec(
        document.querySelector<HTMLElement>(".virtual-canvas")?.style
          .transform ?? "",
      );
      return match ? Math.abs(parseFloat(match[1])) : 0;
    });

    // 阶段二：掉头往上甩 = 一路冲向底部，带出真惯性。偏移没在换方向时折算的话，
    // 「偏移 − 离底距离」会随着逼近底部越来越大，屏幕上就是一片越来越大的空白。
    await webviewPage.evaluate(() => {
      (window as unknown as { __blankSamples: unknown[] }).__blankSamples = [];
      const samples = (
        window as unknown as {
          __blankSamples: {
            t: number;
            gap: number;
            offset: number;
            toBottom: number;
          }[];
        }
      ).__blankSamples;
      const container = document.getElementById("messagesContainer")!;
      const t0 = performance.now();
      const tick = () => {
        const rows = document.querySelectorAll<HTMLElement>(".virtual-row");
        const last = rows[rows.length - 1];
        const match = /translateY\((-?[\d.]+)px\)/.exec(
          document.querySelector<HTMLElement>(".virtual-canvas")?.style
            .transform ?? "",
        );
        samples.push({
          t: Math.round(performance.now() - t0),
          gap: last
            ? Math.round(
                container.getBoundingClientRect().bottom -
                  last.getBoundingClientRect().bottom,
              )
            : 0,
          offset: match ? Math.abs(parseFloat(match[1])) : 0,
          toBottom: Math.round(
            container.scrollHeight -
              container.clientHeight -
              container.scrollTop,
          ),
        });
        if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    for (let i = 0; i < 16; i++) {
      y -= 45;
      await touch(cdp, "touchMove", 195, y);
      await webviewPage.waitForTimeout(8);
    }
    await touch(cdp, "touchEnd", 195, y);
    await webviewPage.waitForTimeout(3200);

    const samples = await webviewPage.evaluate(
      () =>
        (
          window as unknown as {
            __blankSamples: {
              t: number;
              gap: number;
              offset: number;
              toBottom: number;
            }[];
          }
        ).__blankSamples,
    );
    // 允许的间距 = 贴底基线 + 单帧可见位移；超过就是真的一片空白。
    const limit = baseline + 60;
    const blank = samples.filter((s) => s.gap > limit);
    const worst = samples.reduce(
      (worst, s) => (s.gap > (worst?.gap ?? -Infinity) ? s : worst),
      undefined as (typeof samples)[number] | undefined,
    );
    const peakOffset = samples.reduce((max, s) => Math.max(max, s.offset), 0);
    const nearest = samples.reduce((min, s) => Math.min(min, s.toBottom), 1e9);
    console.log(
      `[reverse] baseline=${baseline} frames=${samples.length} ` +
        `midOffset=${midOffset} peakOffset=${peakOffset} nearest=${nearest} ` +
        `blank=${blank.length} ` +
        `worst=${JSON.stringify(worst)}`,
    );
    if (blank.length > 0) {
      console.log(`[reverse-detail] ${JSON.stringify(blank.slice(0, 6))}`);
    }
    expect(blank.length).toBe(0);
  });

  test("往上翻过再甩到底部：折算撞底不留空白", async ({ webviewPage }) => {
    test.setTimeout(180000);
    const cdp = await emulatePhone(webviewPage);
    await webviewPage.waitForTimeout(200);

    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    const firstPage = buildMessages(24);
    await injector.updateMessages(firstPage);
    await injector.endStreaming();
    await webviewPage.waitForTimeout(1200);

    const measure = () =>
      webviewPage.evaluate(() => {
        const c = document.getElementById("messagesContainer")!;
        const rows = document.querySelectorAll<HTMLElement>(".virtual-row");
        const last = rows[rows.length - 1];
        return {
          transform:
            document.querySelector<HTMLElement>(".virtual-canvas")?.style
              .transform ?? "",
          // 最后一行底边到容器底边：贴着真底时只该剩列的内边距。
          gap: last
            ? Math.round(
                c.getBoundingClientRect().bottom -
                  last.getBoundingClientRect().bottom,
              )
            : null,
        };
      });

    // 基准：首屏本来就钉在底部，此刻的间距就是「贴着真底」应有的样子。
    const baseline = await measure();

    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollTop - 600;
    });
    await webviewPage.waitForTimeout(500);

    const x = 195;
    await touch(cdp, "touchStart", x, 300);
    for (let i = 1; i <= 4; i++) {
      await touch(cdp, "touchMove", x, 300 + i * 20);
      await webviewPage.waitForTimeout(16);
    }
    // 手指还按着时更早一页到货：账本变了，补偿挂成画布的视觉偏移。
    await injector.updateMessages([...buildMessages(6, "e"), ...firstPage]);
    await webviewPage.waitForTimeout(80);

    // 继续往下甩到底（手指还没抬）。画布带着偏移 ⇒ 内容整体被顶开，底部多出
    // 与偏移等高的空白；内核必须在这一刻就折算（这一截在边界上兑现不了，直接
    // 丢掉），否则空白一直挂到惯性停。
    await webviewPage.evaluate(() => {
      const c = document.getElementById("messagesContainer")!;
      c.scrollTop = c.scrollHeight;
    });
    await webviewPage.waitForTimeout(80);

    // 到界那一刻就该折算：不等手指抬起、也不等惯性停。这里抓的是手指还按着时的
    // 状态——真机上「底部空白等一秒自己消除」就是这个窗口太长。
    const atEdge = await measure();
    await touch(cdp, "touchEnd", x, 500);
    await webviewPage.waitForTimeout(1500);
    const settled = await measure();
    console.log(
      `[bottom] baseline gap=${baseline.gap} | atEdge transform="${atEdge.transform}" ` +
        `gap=${atEdge.gap} → settled transform="${settled.transform}" gap=${settled.gap}`,
    );

    // 一到底偏移就丢掉（撞底兑现不了的那一截），画布当场归零，底部不留空白。
    expect(atEdge.transform).toBe("");
    expect(atEdge.gap).not.toBeNull();
    expect(atEdge.gap as number).toBeLessThanOrEqual(
      (baseline.gap as number) + MAX_VISIBLE_JUMP_PX,
    );
    // 抬手指、惯性走完之后仍是这样。
    expect(settled.transform).toBe("");
    expect(settled.gap).not.toBeNull();
    expect(settled.gap as number).toBeLessThanOrEqual(
      (baseline.gap as number) + MAX_VISIBLE_JUMP_PX,
    );
  });
});
