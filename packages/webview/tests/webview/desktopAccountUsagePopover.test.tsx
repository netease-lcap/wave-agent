/**
 * 桌面端账户卡片用量浮层的真浏览器几何。
 *
 * 迁移自 `e2e/desktop-account-usage-popover.e2e.ts`。三件实际看得见的事：
 * 浮层停在个人信息行**上方 4px**（`POPOVER_GAP`，设计师 1109 评论「弹窗再上移
 * 大概 4px」）、宽度与右缘跟卡片对齐，以及窗口缩放时它会自己重测、不与卡片分家。
 *
 * 坐标是打开那一刻算出的 `fixed` 快照，卡片又贴在侧栏底部、随窗口高度上下移动 ——
 * 少了那次重测，浮层就停在原处飘着。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

/** 两个维度都有内容（页签会渲染），且本周触顶 ⇒ 预警点挂着。 */
const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: {
    mode: "api",
    reason: "week",
    plan: {
      monthUsed: 600,
      monthLimit: 1000,
      weekUsed: 500,
      weekLimit: 500,
      expireDate: "2027-03-01",
    },
  },
  apiQuota: { limit: 10000, used: 1153.14 },
};

type Box = { x: number; y: number; width: number; height: number };
type Geometry = { card: Box; row: Box; pop: Box };

/** 浮层底边停在个人信息行顶上方 4px。 */
const POPOVER_GAP = 4;

const boxOf = (selector: string): Box | null => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};

/** 账户卡片 / 个人信息行 / 用量浮层三块布局盒；缺一块时返回 null（供轮询）。 */
function measure(): Geometry | null {
  const card = boxOf('[data-testid="account-card"]');
  const row = boxOf(".account-card-main");
  const pop = boxOf('[data-testid="account-usage-popover"]');
  if (!card || !row || !pop) return null;
  return { card, row, pop };
}

/** 浮层底边与个人信息行顶之间的实际缝宽。 */
function gapToRow({ row, pop }: Geometry): number {
  return row.y - (pop.y + pop.height);
}

function expectHuggingCard(geometry: Geometry) {
  const { card, pop } = geometry;
  expect(Math.abs(gapToRow(geometry) - POPOVER_GAP)).toBeLessThan(1.5);
  expect(Math.abs(pop.width - card.width)).toBeLessThan(1.5);
  expect(Math.abs(pop.x + pop.width - (card.x + card.width))).toBeLessThan(1.5);
}

/** 当前状态下量到的三块盒子；还没渲染全就抛（`expect.poll` 会重试）。 */
function measured(): Geometry {
  const geometry = measure();
  if (!geometry) throw new Error("用量浮层的布局盒量不到");
  return geometry;
}

/** 启动桌面端、推账户快照、点开用量浮层。 */
async function openPopover() {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopAccountInfo", accountInfo);
  await expect
    .poll(() => isVisible('[data-testid="account-usage-btn"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("account-usage-btn"));
  await expect
    .poll(() => isVisible('[data-testid="account-usage-popover"]'))
    .toBe(true);
  return result;
}

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop account usage popover geometry", () => {
  it("hugs the personal-info row and follows a window resize", async () => {
    await page.viewport(960, 640);
    await openPopover();
    expectHuggingCard(measured());

    const before = measured();
    // 窗口变矮 ⇒ 卡片贴底部、个人信息行上移。浮层坐标是打开那一刻的快照，
    // 不跟随 resize 就会停在原处、与卡片分家。
    await page.viewport(960, 520);
    await expect
      .poll(() => {
        const geometry = measure();
        return geometry
          ? Math.abs(gapToRow(geometry) - POPOVER_GAP)
          : Number.POSITIVE_INFINITY;
      })
      .toBeLessThan(1.5);

    const after = measured();
    expectHuggingCard(after);
    expect(after.row.y).toBeLessThan(before.row.y - 40);
    expect(after.pop.y).toBeLessThan(before.pop.y - 40);
  });

  it("stays inside the viewport when the window is very short", async () => {
    // 窗口矮到个人信息行顶上没有多少空间：可用高度按「行顶到视口顶」实算，
    // 浮层宁可只剩一条（内部滚动）也不越过视口顶部。留最小高度兜底的话浮层会
    // 顶出去一截 —— 那截用户连滚都滚不到。
    await page.viewport(960, 140);
    await openPopover();
    const { row, pop } = measured();
    expect(pop.y).toBeGreaterThanOrEqual(0);
    expect(pop.y + pop.height).toBeLessThanOrEqual(row.y + 1.5);
  });
});
