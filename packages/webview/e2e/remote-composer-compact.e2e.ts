import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { expectPermissionMenuAligned } from "./utils/permissionMenu.js";

/**
 * 远控页（第五种宿主、手机档）底栏「空间不足 → 图标档」
 * （spec ui/model-selection.md「底栏放不下时模型与权限收成图标档（桌面端 + 插件 +
 * 远控页）」场景 5/6，以及 spec remote/remote-mobile.md 场景 4 里权限档那一条）。
 *
 * 这一端和另两端共用同一套判据与收法（`MessageInput` 按实际内容量宽后给底栏行挂
 * `.is-compact`），差别只在图标尺寸的密度档：桌面 32×32、插件 22×22、**手机 40×40**
 * （与「+」「/」两个触摸档按钮同档）。触发条件是手机档把按钮放大到 40×40、正文抬到
 * 15px 之后，390px 宽的一行里两个文字档必然放不下 —— 权限按钮会被压得比自己的文案
 * 还窄，「修改前询问」折成两行冲出轨道（用户 2026-10-26 报的现象）。
 *
 * ⚠️ 手机档（`pointer: coarse` / `hover: none`）只在触控 context 里生效，所以这里用
 * 真实触控设备参数（与 remote-page-controls.e2e.ts 同一套）。加载的是 dist 产物，
 * 改过样式先跑 `pnpm -F wave-webview build`。
 */

const MODEL = "deepseek-flash";

test.use({
  // 远控页标记（window.waveRemotePage + data-remote-page）在应用启动前就位，
  // 与 remote/shim.js 在真实页面上做的一致 —— 见 harness 的同名选项。
  remotePage: true,
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

/** 底栏量宽：整行档位、各控件盒子、任意两项的重叠像素、权限文案是否折行。 */
async function rowGeometry(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector(".input-buttons-row") as HTMLElement;
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    };
    const kids = Array.from(row.children).map(box)!;
    const overlaps: string[] = [];
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = kids[i]!;
        const b = kids[j]!;
        if (!a.width || !b.width) continue;
        const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        if (ov > 0) overlaps.push(`#${i}×#${j}=${Math.round(ov)}`);
      }
    }
    const name = row.querySelector(".model-picker-name") as HTMLElement;
    const icon = row.querySelector(".model-picker-icon") as HTMLElement;
    const permLabel = row.querySelector(
      ".permission-mode-label",
    ) as HTMLElement;
    const permCaret = row.querySelector(
      ".permission-mode-caret",
    ) as HTMLElement;
    const readSurface = (el: Element | null) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, borderColor: cs.borderTopColor };
    };
    return {
      host: document.documentElement.dataset.host,
      remotePage: document.documentElement.getAttribute("data-remote-page"),
      compact: row.classList.contains("is-compact"),
      rowWidth: row.clientWidth,
      trigger: box(row.querySelector(".model-picker-trigger")),
      modelIcon: box(icon),
      permission: box(row.querySelector(".permission-mode-select")),
      permIcon: box(row.querySelector(".permission-mode-icon")),
      ring: box(row.querySelector(".compress-context-button")),
      nameHidden: name ? getComputedStyle(name).display === "none" : null,
      iconShown: icon ? getComputedStyle(icon).display !== "none" : null,
      // 图标档里这颗大脑与「+」「/」必须同色（spec 场景 7）：不显式给色时它靠
      // `currentColor` 继承模型按钮的**文字**色，比图标按钮暗一档。
      iconColor: icon ? getComputedStyle(icon).color : null,
      toolbarIconColor: (() => {
        const btn = row.querySelector(".toolbar-icon-button");
        return btn ? getComputedStyle(btn).color : null;
      })(),
      permLabelHidden: permLabel
        ? getComputedStyle(permLabel).display === "none"
        : null,
      permCaretHidden: permCaret
        ? getComputedStyle(permCaret).display === "none"
        : null,
      // 权限文案折行 ⇒ 按钮盒比它自己的行高还高（40px 轨道装不下）
      rowHeight: Math.round(row.getBoundingClientRect().height),
      rowScrollOverflow:
        row.scrollWidth > row.clientWidth
          ? row.scrollWidth - row.clientWidth
          : 0,
      // 交互面同档（spec 场景 8）：四个图标按钮的圆角一致，模型/权限不带 focusBorder 框。
      plusSurface: readSurface(row.querySelector(".toolbar-icon-button")),
      modelSurface: readSurface(row.querySelector(".model-picker-trigger")),
      permissionSurface: readSurface(
        row.querySelector(".permission-mode-select"),
      ),
      overlaps,
    };
  });
}

/** 手机档远控页 + 一个「已发过消息 + 有模型清单 + 有上下文用量 + 跳过权限确认」的会话。 */
async function mountRemoteChat(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  const injector = new MessageInjector(page);
  // 必须落一条活会话：远控页在「一条会话都没有」时会把输入区整体置灰
  // （spec remote/remote-web.md 场景 14），底栏那几个控件根本点不动。
  const session = {
    id: "session-1",
    sessionType: "main" as const,
    workdir: "/repo/app",
    createdAt: new Date("2026-10-14T08:00:00Z"),
    lastActiveAt: new Date("2026-10-14T09:00:00Z"),
    latestTotalTokens: 0,
  };
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [session],
    session,
    isAuthenticated: true,
    permissionMode: "bypassPermissions",
  });
  await injector.simulateExtensionMessage("configuredModels", {
    models: [{ name: MODEL, provider: "deepseek", model: MODEL }],
    currentModel: MODEL,
  });
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("做个原型", "msg-u1"),
    MockDataGenerator.createAssistantMessage("好的，已生成。", "msg-a1"),
  ]);
  await injector.simulateExtensionMessage("contextUsage", { percent: 71 });
  await page.getByTestId("message-input").waitFor();
}

test.describe("remote page (touch): icon tier when the bottom row runs out of space", () => {
  test("a 390px phone collapses model and permission to 40×40 icons with no overlap", async ({
    webviewPage,
  }) => {
    await mountRemoteChat(webviewPage, 390);
    await webviewPage.waitForFunction(() => {
      const row = document.querySelector(".input-buttons-row");
      return !!row && row.className.includes("is-compact");
    });
    const geo = await rowGeometry(webviewPage);

    // 判据与另两端同源：宿主标识仍落在 plugin 档，只有 data-remote-page 把它送进手机档。
    expect(geo.host).toBe("editor");
    expect(geo.remotePage).toBe("1");

    expect(geo.compact).toBe(true);
    // 手机档的图标按钮 = 40×40（与「+」「/」同档），不是桌面的 32、也不是插件的 22。
    expect(geo.trigger!.width).toBe(40);
    expect(geo.trigger!.height).toBe(40);
    expect(geo.permission!.width).toBe(40);
    expect(geo.permission!.height).toBe(40);
    // 文字全藏、图标出现，且字形随按钮抬到 20px（触摸档）。
    expect(geo.nameHidden).toBe(true);
    expect(geo.iconShown).toBe(true);
    expect(geo.permLabelHidden).toBe(true);
    expect(geo.permCaretHidden).toBe(true);
    expect(geo.modelIcon!.width).toBe(20);
    expect(geo.permIcon!.width).toBe(20);
    // 收成图标后整行真的放得下：无重叠、无溢出，轨道高度也没被折行的文案顶高。
    expect(geo.overlaps).toEqual([]);
    expect(geo.rowScrollOverflow).toBe(0);
    expect(geo.rowHeight).toBe(48);
    // 大脑与左边的「+」「/」同色（两者都是图标控件）：差异只可能是「整行都是图标色」，
    // 不能是「模型那颗跟着模型按钮的文字色、比旁边暗一档」。
    expect(geo.iconColor).toBe(geo.toolbarIconColor);
    // 交互面同档：圆角一致、且不带文字档那圈 focusBorder 蓝框（触屏没有 hover，
    // 但按下/聚焦时同样会显形，所以默认态就该是透明的）。
    expect(geo.modelSurface!.radius).toBe(geo.plusSurface!.radius);
    expect(geo.permissionSurface!.radius).toBe(geo.plusSurface!.radius);
    expect(geo.modelSurface!.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(geo.permissionSurface!.borderColor).toBe("rgba(0, 0, 0, 0)");

    // 点击行为与文字档完全一致：仍是同一个向上展开的列表。
    await webviewPage.getByTestId("model-picker-trigger").click();
    await expect(webviewPage.getByTestId("model-picker-menu")).toBeVisible();
    await expect(webviewPage.getByTestId("model-picker-menu")).toContainText(
      MODEL,
    );
    // 打开后焦点按 roster 落到当前项，再按 Escape（Escape 的处理挂在菜单项上，
    // 不在触发按钮上 —— 不等焦点落位就按，按键会落到 body 上、菜单关不掉）。
    await expect(
      webviewPage
        .getByTestId("model-picker-menu")
        .locator(".model-picker-item")
        .first(),
    ).toBeFocused();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByTestId("model-picker-menu")).toHaveCount(0);

    // 权限档同样是同一个四档列表（触屏没有悬停，靠打开列表看到名称与勾选）。
    await webviewPage.locator(".permission-mode-select").click();
    await expect(webviewPage.locator(".permission-mode-menu")).toBeVisible();
    await expect(webviewPage.locator(".permission-mode-item")).toHaveCount(4);
    await expect(
      webviewPage.locator(".permission-mode-item.selected"),
    ).toContainText("跳过权限确认");
  });

  /**
   * 权限下拉菜单项：图标与文案同一水平线、中间留出间距（用户 2026-10-26 在手机上看到
   * 「图标跟文本没有水平对齐」）。手机档的字形抬到 20px、文案 14px，基线排法的偏差比
   * 插件端还大一档（实测图标圆心比文字中心高 5px、间距 0）。
   */
  test("the permission menu's icon and label sit on one line", async ({
    webviewPage,
  }) => {
    await mountRemoteChat(webviewPage, 390);
    await expectPermissionMenuAligned(webviewPage);
  });

  test("a wider phone/tablet brings the text tier back automatically", async ({
    webviewPage,
  }) => {
    await mountRemoteChat(webviewPage, 390);
    await webviewPage.waitForFunction(() => {
      const row = document.querySelector(".input-buttons-row");
      return !!row && row.className.includes("is-compact");
    });

    await webviewPage.setViewportSize({ width: 900, height: 844 });
    await webviewPage.waitForFunction(() => {
      const row = document.querySelector(".input-buttons-row");
      return !!row && !row.className.includes("is-compact");
    });
    const wide = await rowGeometry(webviewPage);
    expect(wide.nameHidden).toBe(false);
    expect(wide.iconShown).toBe(false);
    expect(wide.permLabelHidden).toBe(false);
    expect(wide.overlaps).toEqual([]);
    await expect(webviewPage.getByTestId("model-picker-trigger")).toContainText(
      MODEL,
    );
  });
});
