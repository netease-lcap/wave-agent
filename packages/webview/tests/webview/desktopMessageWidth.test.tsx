/**
 * 桌面端消息行与输入卡的宽度关系（1124 走查后的规范）。
 *
 * 读这条测试前先读这段演化，否则会以为「列盒居中」是漏测：
 *   - 第 24 轮：对话列 `.messages-column` cap 800 居中、输入卡 `.input-wrapper`
 *     cap 768 居中（Figma「Form - 发送消息」768），两盒各自对称 → 断言是
 *     「列居中 + 列比输入卡宽 32」。
 *   - 2026-09-23：cap 从滚动容器 `.messages-container` 下移到内层 `.messages-column`，
 *     外层滚动容器铺满整个 pane（滚轮/触控板在 gutter 上也能滚）。
 *   - 1124（现在的口径）：「对话流的宽度和 AI 输入框保持一致，现在整体左侧超出了
 *     一些，右侧是正好的」。列盒**刻意不再左右对称**——右侧恒留一条 8px 滚动条轨道
 *     （`scrollbar-gutter: stable`），列上限改成 792 = 输入卡 768 + 左内衬 16 + 右内衬 8，
 *     16/8 的不对称正好抵掉轨道造成的 4px 偏左。
 *     所以「列盒居中」（恒差 8）与「列比输入卡宽 32」（实为 24）在新规范下**必然
 *     不成立**，那两条断言是口径作废、已删除，不是漏测。
 *     用户可见的对齐单位是消息行 `.virtual-row` 与输入卡 `.input-wrapper`，几何断言
 *     逐值比较这两者。
 *
 * 只能在这里测：jsdom 没有布局。宿主档由 `desktopHarness` 打开
 * （`data-host="desktop"` + host-desktop.css），viewport 用真机 e2e 的原尺寸。
 */

import { describe, it, expect, afterEach } from "vitest";
import { cdp, page } from "vitest/browser";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const WORKDIR = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 桌面端布局要等 `desktopWorkdirState` 才挂 ChatApp，初值按真机顺序推下去。 */
function boot() {
  renderDesktopApp();
  bootDesktop({ workdir: WORKDIR, extra: initialState });
}

const q = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no element for ${selector}`);
  return node;
};

/** 视口坐标下的外框（`getBoundingClientRect`，与 Playwright 的 `boundingBox()` 同系）。 */
const box = (selector: string) => q(selector).getBoundingClientRect();

/** 亚像素级容差：居中可能落在半个像素上。 */
const TOLERANCE = 1;

/**
 * 桌面端 `::-webkit-scrollbar { width: 8px }`（host-desktop.css）—— 列宽那套
 * 16 / 8 / 792 的数字就是按这一条轨道推出来的，两者是同一个等式，所以这里把它钉住。
 */
const SCROLLBAR_TRACK = 8;

/**
 * 本次改动的全部意义：消息行与输入卡的**左右沿逐值相等**。四条边相等 ⇒ 中心也
 * 相等，但中心单独留一条，失败时才分得清是「整体偏移」还是「宽度差一截」。
 */
function expectEdgesAlign(state: string) {
  const row = box(".virtual-row");
  const input = box(".input-wrapper");
  const center = (b: DOMRect) => b.left + b.width / 2;
  expect(
    Math.abs(row.left - input.left),
    `${state}：行左沿 ${row.left} vs 输入卡左沿 ${input.left}`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(row.right - input.right),
    `${state}：行右沿 ${row.right} vs 输入卡右沿 ${input.right}`,
  ).toBeLessThanOrEqual(TOLERANCE);
  expect(
    Math.abs(center(row) - center(input)),
    `${state}：行中心 ${center(row)} vs 输入卡中心 ${center(input)}`,
  ).toBeLessThanOrEqual(TOLERANCE);
}

/**
 * 在视口坐标上派发一次**真滚轮**。`userEvent.wheel` 会先把指针挪到目标元素中心
 * （这里正好要看的是 gutter —— 元素中心不在 gutter 上），所以直接走 provider 的
 * CDP：`Input.dispatchMouseEvent` 的 `mouseWheel` 是 Playwright `mouse.wheel` 用的
 * 同一层，落点由坐标命中测试决定。
 */
async function wheelAt(x: number, y: number, deltaY: number): Promise<void> {
  const session = cdp() as unknown as {
    send: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  };
  await session.send("Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x,
    y,
    deltaX: 0,
    deltaY,
    button: "none",
  });
}

describe("Desktop message column width", () => {
  it("消息行与输入卡左右沿逐值相等（输入卡 768 规范）", async () => {
    // 宽窗口，限宽才量得出来（两侧都留下看得见的 gutter）。
    await page.viewport(1280, 800);
    boot();

    // 布局挂上监听器之后再推消息（否则 updateMessages 落进 workdirState 触发挂载
    // 之前的空档里被丢掉）。
    await expect
      .poll(() => isVisible('[data-testid="desktop-workdir"]'))
      .toBe(true);

    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createUserMessage(
          "帮我把消息列表加一个最大宽度并居中，跟输入框保持一致，否则消息太宽不好看。",
          "msg-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "好的，对话流与输入卡现在左右沿逐值对齐：列上限 792，左内衬 16、右内衬 8，右边那 8px 让给恒预留的滚动条轨道。",
          "msg-a1",
        ),
      ],
    });

    await expect.poll(() => isVisible(".message.user")).toBe(true);
    await expect.poll(() => isVisible(".message.assistant")).toBe(true);

    const container = box(".messages-container");
    const main = box(".desktop-chat-main");
    const row = box(".virtual-row");
    const input = box(".input-wrapper");

    // 滚动容器铺满整个 pane（滚轮/触控板的作用面 = 整个面板；gutter 上的滚轮由
    // 下面那个用例专门守）。
    expect(
      Math.abs(container.width - main.width),
      `滚动容器 ${container.width} vs pane ${main.width}`,
    ).toBeLessThanOrEqual(TOLERANCE);

    // 两处都限宽（1280 的 pane 比 792 / 768 宽，所以两侧都有 gutter）。
    expect(row.width, `行宽 ${row.width}`).toBeLessThan(main.width);
    expect(input.width, `输入卡宽 ${input.width}`).toBeLessThan(main.width);

    // 输入卡仍是 Figma 的 768 档 —— 行对齐的就是它，这条是整套几何的基准；
    // 输入卡自身也仍在 pane 内居中（列的内衬不对称是围着它设计的）。
    expect(
      Math.abs(input.width - 768),
      `输入卡宽 ${input.width} vs 规范 768`,
    ).toBeLessThanOrEqual(TOLERANCE);
    expect(
      Math.abs(input.left - main.left - (main.right - input.right)),
      `输入卡左距 ${input.left - main.left} vs 右距 ${main.right - input.right}`,
    ).toBeLessThanOrEqual(TOLERANCE);

    expectEdgesAlign("1280 视口");

    // gutter（消息列外层透明包裹层透出的 chat-area 底色）必须与消息列表自己
    // 的底色一致，而不是宿主编辑器的 body 底色。
    const bg = (selector: string) =>
      getComputedStyle(q(selector)).backgroundColor;
    expect(bg(".chat-container")).toBe(bg(".messages-container"));
    // 内层列自己不画底色 —— 必须透明，两边的 gutter 才连成一片。
    expect(bg(".messages-column")).toBe("rgba(0, 0, 0, 0)");
  });

  // `scrollbar-gutter: stable` 的作用面：没有滚动条时也留着那条轨道。去掉它，
  // 「消息不满一屏」态的内容盒会宽回一整条轨道，列跟着右移半条（4px），一行行
  // 往右错开、长到出现滚动条又跳回来 —— 两态各量一次才守得住。
  it("有滚动条与无滚动条两态下，行与输入卡都对齐且轨道恒预留", async () => {
    await page.viewport(1280, 800);
    boot();
    await expect
      .poll(() => isVisible('[data-testid="desktop-workdir"]'))
      .toBe(true);

    const scroller = () => q(".messages-container");
    const track = () => scroller().offsetWidth - scroller().clientWidth;
    const scrollable = () => scroller().scrollHeight > scroller().clientHeight;

    // 态一：两条短消息，不满一屏（没有滚动条）。
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createUserMessage("短问题一问。", "msg-s1"),
        MockDataGenerator.createAssistantMessage("短回答一句。", "msg-s2"),
      ],
    });
    await expect.poll(() => isVisible(".virtual-row")).toBe(true);
    expect(scrollable(), "态一应当不满一屏").toBe(false);
    expectEdgesAlign("无滚动条");
    const idleClientWidth = scroller().clientWidth;
    expect(track(), "无滚动条时轨道也要预留").toBe(SCROLLBAR_TRACK);

    // 态二：内容撑满（真机那份注释写的是 614px 高的可视区）。
    const messages = [];
    for (let i = 0; i < 8; i++) {
      messages.push(
        MockDataGenerator.createUserMessage(`第 ${i} 轮问题`, `msg-u${i}`),
        MockDataGenerator.createAssistantMessage(
          `第 ${i} 轮回答：` + "内容".repeat(200),
          `msg-a${i}`,
        ),
      );
    }
    sendCommand("updateMessages", { messages });
    await expect.poll(scrollable).toBe(true);
    expectEdgesAlign("有滚动条");
    expect(track(), "有滚动条时轨道宽度不变").toBe(SCROLLBAR_TRACK);

    // 两态内容盒一样宽 —— 就是 `stable` 那一行在保证的事。
    expect(scroller().clientWidth, "有/无滚动条两态的内容盒必须同宽").toBe(
      idleClientWidth,
    );
  });

  // 回归守卫：滚轮/触控板的作用面覆盖整个面板。改动前滚动容器就是那条被限宽居中
  // 的 800px 列，两侧 gutter 上没有滚动容器，`elementFromPoint` 命中
  // .desktop-chat-main、滚轮不改变 scrollTop（用户报「鼠标只能在粉色区域操作」）。
  it("侧边 gutter 上的滚轮能滚动消息列表", async () => {
    await page.viewport(1280, 800);
    boot();
    await expect
      .poll(() => isVisible('[data-testid="desktop-workdir"]'))
      .toBe(true);

    // 内容足够撑满（真机那份注释写的是 614px 高的可视区）。
    const messages = [];
    for (let i = 0; i < 8; i++) {
      messages.push(
        MockDataGenerator.createUserMessage(`第 ${i} 轮问题`, `msg-u${i}`),
        MockDataGenerator.createAssistantMessage(
          `第 ${i} 轮回答：`.repeat(1) + "内容".repeat(200),
          `msg-a${i}`,
        ),
      );
    }
    sendCommand("updateMessages", { messages });
    await expect.poll(() => isVisible(".message.assistant")).toBe(true);

    const probe = (() => {
      const container = q(".messages-container");
      const main = q(".desktop-chat-main").getBoundingClientRect();
      container.scrollTop = container.scrollHeight / 2;
      const y = Math.round(container.getBoundingClientRect().top + 200);
      const points = {
        right: { x: Math.round(main.right - 20), y },
        left: { x: Math.round(main.left + 20), y },
      };
      const hitIsScrollSurface = (p: { x: number; y: number }) => {
        const el = document.elementFromPoint(p.x, p.y);
        return !!el?.closest(".messages-container");
      };
      const col = q(".messages-column").getBoundingClientRect();
      return {
        points,
        hitRight: hitIsScrollSurface(points.right),
        hitLeft: hitIsScrollSurface(points.left),
        // 两个探针点都必须落在对话列**之外**，也就是 gutter 上 —— 这正是本用例
        // 的全部意义。
        rightInGutter: points.right.x > col.right,
        leftInGutter: points.left.x < col.left,
        scrollTop: container.scrollTop,
      };
    })();
    expect(probe.rightInGutter).toBeTruthy();
    expect(probe.leftInGutter).toBeTruthy();
    expect(probe.hitRight).toBeTruthy();
    expect(probe.hitLeft).toBeTruthy();
    expect(probe.scrollTop).toBeGreaterThan(0);

    const scrollFrom = async (p: { x: number; y: number }, dy: number) => {
      const container = q(".messages-container");
      const before = container.scrollTop;
      await wheelAt(p.x, p.y, dy);
      return { before, container };
    };

    const right = await scrollFrom(probe.points.right, -200);
    await expect
      .poll(() => right.container.scrollTop)
      .toBeLessThan(right.before);
    const left = await scrollFrom(probe.points.left, 200);
    await expect
      .poll(() => left.container.scrollTop)
      .toBeGreaterThan(left.before);
  });
});
