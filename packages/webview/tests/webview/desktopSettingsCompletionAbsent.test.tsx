/**
 * 桌面端「全局设置」里**不该**出现补全两行。
 *
 * 迁移自 `e2e/desktop-settings-completion-absent.e2e.ts`。出处：spec
 * ui/code-completion.md 边界情况「补全设置行的宿主范围」与 desktop-settings.md
 * 场景 3（补全模型 / 补全开关不在本端展示）。
 *
 * 设置页是四端**共用**实现，因此门禁一旦漏掉桌面端，用户会在一个没有代码编辑器、
 * 永远不会触发补全的应用里看到一个补全开关 ——「承诺一个不会发生的功能」。门禁按
 * **宿主能力位**（`window.waveHostType === "desktop"`，真机由 index.tsx 注入）判定，
 * 不是「settings.json 里有没有这个键」：所以这里即使让宿主回包带着
 * `completionModel` / `completionEnabled`，这两行也必须整体缺席。
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

const WORKDIR = "/Users/dev/projects/wave-agent";

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: null,
  apiQuota: null,
};

/** 元素「可见」（对齐 Playwright 的 `toBeVisible`）。 */
const visibleBox = (el: Element | null): boolean => {
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
};

/** 屏上某个标题真的显示出来了（对齐 `getByRole("heading").toBeVisible()`）。 */
const visibleHeading = (name: string) =>
  screen.queryAllByRole("heading", { name }).some((el) => visibleBox(el));

/** 屏上标题的数量（对齐 `getByRole("heading").toHaveCount(0)`）。 */
const headingCount = (name: string) =>
  screen.queryAllByRole("heading", { name }).length;

/** 侧栏账户卡「更多」→「设置」→「全局设置」。 */
async function openGlobalSettings() {
  await expect
    .poll(() => isVisible('[data-testid="account-card-hotzone"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("account-card-hotzone"));
  await expect.poll(() => isVisible('[data-testid="more-menu"]')).toBe(true);
  await userEvent.click(screen.getByTestId("more-menu-settings"));
  await expect.poll(() => isVisible(".settings-page")).toBe(true);
  const navItem = Array.from(
    document.querySelectorAll<HTMLElement>(".settings-nav-item"),
  ).find((el) => (el.textContent ?? "").includes("全局设置"));
  expect(navItem).toBeTruthy();
  await userEvent.click(navItem!);
  await expect.poll(() => visibleHeading("AI 回复语言")).toBe(true);
}

describe("桌面端设置页不含补全两行（宿主能力门禁）", () => {
  it("「全局设置」渲染语言与桌面端设置区块，但不渲染代码补全/补全模型", async () => {
    await page.viewport(1280, 800);
    // 真机由 `src/index.tsx` 按注入的 `window.waveHostType` 打这个能力位；单元
    // 测试不走那个入口，所以在这里补上（与 `macTitlebar.test.tsx` 同一手法）。
    window.waveHostType = "desktop";

    const configurationData = {
      language: "zh-CN",
      // 即使宿主回包里带着这两个键（settings.json 里手改过），桌面端也不该把它们
      // 渲染成可编辑控件——门禁是宿主能力位，不是「文件里有没有这个键」。
      completionModel: "qwen2.5-coder",
      completionEnabled: false,
    };
    renderDesktopApp();
    bootDesktop({
      workdir: WORKDIR,
      extra: { configurationData, workdir: WORKDIR },
    });
    sendCommand("desktopAccountInfo", accountInfo);
    await openGlobalSettings();

    sendCommand("configurationResponse", { configurationData });

    // 同卡片其它行照常渲染：门禁只摘这两行，不是整卡消失
    await expect.poll(() => visibleHeading("AI 回复语言")).toBe(true);
    await expect.poll(() => visibleHeading("上下文长度")).toBe(true);
    // 桌面端独有的本地偏好区块（主题/Beta）与补全无关，必须还在
    await expect.poll(() => visibleHeading("主题")).toBe(true);

    expect(headingCount("代码补全")).toBe(0);
    expect(headingCount("补全模型")).toBe(0);
    expect(
      document.querySelectorAll('input[aria-label="代码补全"]').length,
    ).toBe(0);
    expect(
      document.querySelectorAll('select[aria-label="补全模型"]').length,
    ).toBe(0);
  });
});

afterEach(() => {
  resetHostTier();
  resetPanelState();
  delete window.waveHostType;
});
