/**
 * 桌面端消息列与输入卡的宽度关系（第 24 轮后以设计师 Figma 规范为准）。
 *
 * 迁移自 `e2e/desktop-message-width.e2e.ts`：
 *   - 对话列 `.messages-column` 保持既有 cap 800px 居中（设计师走查结论：虚拟列表
 *     行 inset 联动，列宽不单独改）；
 *   - 输入卡 `.input-wrapper` cap 768px 居中（Figma「Form - 发送消息」768 =
 *     Container 800 − pad 16×2，`host-desktop.css` 的 `[data-host=desktop]` 覆盖）；
 *   - 两列各自居中 → 水平中心对齐，对话列每侧比输入卡宽 16px。
 *
 * 2026-09-23 结构变更（滚动交互面扩展到整个面板）：cap 从滚动容器
 * `.messages-container` **下移**到内层包裹层 `.messages-column` —— 外层滚动容器铺满
 * 整个 pane（滚轮/触控板在 gutter 上也能滚），内层仍是 800px 居中。所以几何断言是
 * 「滚动容器宽 == pane 宽、内容列仍 800（桌面输入卡仍 768）、两列中心仍对齐」，外加
 * 「gutter 上的滚轮能滚动」。
 *
 * 两条都只能在这里测：jsdom 没有布局。宿主档由 `desktopHarness` 打开
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
  it("对话列与输入卡都限宽居中（输入卡 768 规范）", async () => {
    // 宽窗口，800px 的 cap 才能在两侧留下看得见的 gutter。
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
          "好的，我给对话列加了 max-width: 800px 和 margin: 0 auto，与 .input-wrapper 的约束方式一致。这样消息内容会居中显示在 800px 的列里，两侧留出与输入框对齐的留白，窗口越宽效果越明显。",
          "msg-a1",
        ),
      ],
    });

    await expect.poll(() => isVisible(".message.user")).toBe(true);
    await expect.poll(() => isVisible(".message.assistant")).toBe(true);

    // `.messages-column` 是 border-box：它的 10px 消息 padding 在 800px 列内
    // （content 780）。输入卡 768px cap 是 `[data-host=desktop]` 覆盖，welcome 态
    // 输入卡限宽同 768（host-desktop.css），两态一致。
    const geom = (() => {
      const r = (sel: string) => q(sel).getBoundingClientRect();
      const cs = (sel: string) => getComputedStyle(q(sel)).backgroundColor;
      const container = r(".messages-container");
      const col = r(".messages-column");
      const input = r(".input-wrapper");
      const main = r(".desktop-chat-main");
      const center = (b: DOMRect) => b.left + b.width / 2;
      return {
        // 滚动容器铺满整个 pane（滚轮/触控板的作用面 = 整个面板）
        containerSpansPane: Math.abs(container.width - main.width) < 1,
        // 限宽下移到内层包裹层：内容列仍是 800px 居中
        colCapped: col.width < main.width,
        colCentered:
          Math.abs(col.left - main.left - (main.right - col.right)) < 1,
        inputCapped: input.width < main.width,
        inputCentered:
          Math.abs(input.left - main.left - (main.right - input.right)) < 1,
        // 两列独立居中 → 中心对齐；对话列 800 比输入卡 768 每侧宽 16px
        // （800−768=32，±2 容差）。
        centersAlign: Math.abs(center(col) - center(input)) < 1,
        colWiderBy32: Math.abs(col.width - input.width - 32) < 2,
        // gutter（消息列外层透明包裹层透出的 chat-area 底色）必须与消息列表自己
        // 的底色一致，而不是宿主编辑器的 body 底色。
        gutterBg: cs(".chat-container"),
        containerBg: cs(".messages-container"),
        // 内层列自己不画底色 —— 必须透明，两边的 gutter 才连成一片。
        colBg: cs(".messages-column"),
      };
    })();
    expect(geom.containerSpansPane).toBeTruthy();
    expect(geom.colCapped).toBeTruthy();
    expect(geom.colCentered).toBeTruthy();
    expect(geom.inputCapped).toBeTruthy();
    expect(geom.inputCentered).toBeTruthy();
    expect(geom.centersAlign).toBeTruthy();
    expect(geom.colWiderBy32).toBeTruthy();
    expect(geom.gutterBg).toBe(geom.containerBg);
    expect(geom.colBg).toBe("rgba(0, 0, 0, 0)");
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
