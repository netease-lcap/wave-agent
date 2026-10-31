import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { expectPermissionMenuAligned } from "./utils/permissionMenu.js";

/**
 * 插件端（VS Code / JetBrains，`[data-host="editor"]` 那一档）底栏「空间不足 → 图标档」
 * （spec ui/model-selection.md「底栏放不下时模型与权限收成图标档（桌面端 + 插件）」）。
 *
 * 真 Chromium：这些断言全是布局量出来的（档位、控件盒子、重叠像素），jsdom 跑不出来。
 * 桌面端同款机制见 desktop-preview-floating-dialog.e2e.ts（尺寸是另一档：32×32）。
 *
 * 触发场景（PM 3503127847500032「预览全屏时模型和上下文重叠了」）：VS Code 侧边栏默认
 * 350–400px，模型按钮是底栏里唯一可收缩的一档 —— 收不下去就溢出到上下文用量指示器上，
 * 再窄连「跳过权限确认」都折行冲出底栏。图标档把它们一并收成与 + / / 同档的 22×22。
 */

const MODEL = "deepseek-flash";

/** 底栏量宽：整行档位、各控件盒子、任意两项的重叠像素。 */
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
    const trigger = row.querySelector(".model-picker-trigger");
    const ring = row.querySelector(".compress-context-button");
    const name = row.querySelector(".model-picker-name") as HTMLElement;
    const icon = row.querySelector(".model-picker-icon") as HTMLElement;
    const permLabel = row.querySelector(
      ".permission-mode-label",
    ) as HTMLElement;
    const permCaret = row.querySelector(
      ".permission-mode-caret",
    ) as HTMLElement;
    return {
      compact: row.classList.contains("is-compact"),
      rowWidth: row.clientWidth,
      trigger: box(trigger),
      ring: box(ring),
      permission: box(row.querySelector(".permission-mode-select")),
      // 模型按钮的右缘越过上下文用量指示器左缘的像素数（>0 = 文字压在 71% 上）
      modelOnRing:
        trigger && ring
          ? Math.round(
              Math.max(
                0,
                trigger.getBoundingClientRect().right -
                  ring.getBoundingClientRect().left,
              ),
            )
          : null,
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
      rowScrollOverflow:
        row.scrollWidth > row.clientWidth
          ? row.scrollWidth - row.clientWidth
          : 0,
      overlaps,
    };
  });
}

/** 装一个「已发过消息 + 有模型清单 + 有上下文用量 + 跳过权限确认」的会话。 */
async function mountChat(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
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
  // 量宽在 rAF 里做，等档位落到 DOM 上再量。
  await page.waitForFunction(() => {
    const row = document.querySelector(".input-buttons-row");
    return !!row && row.className.includes("is-compact");
  });
}

test.describe("plugin composer: icon tier when the bottom row runs out of space", () => {
  test("a narrow sidebar collapses model and permission to icons with no overlap", async ({
    webviewPage,
  }) => {
    await mountChat(webviewPage, 380);
    const geo = await rowGeometry(webviewPage);

    // 宿主标识这一档叫 "editor"（VS Code / JetBrains 共用）；叫 "ide" 会和产品名
    // CodeWave IDE 混，叫 "plugin" 会和插件市场的插件混，22×22 那组尺寸就挂在
    // [data-host="editor"] 上。
    expect(
      await webviewPage.evaluate(() => document.documentElement.dataset.host),
    ).toBe("editor");

    expect(geo.compact).toBe(true);
    // 与 + / / 同档：22×22，不是桌面的 32×32。
    expect(geo.trigger!.width).toBe(22);
    expect(geo.trigger!.height).toBe(22);
    expect(geo.permission!.width).toBe(22);
    // 文字全部藏起、大脑图标出现。
    expect(geo.nameHidden).toBe(true);
    expect(geo.iconShown).toBe(true);
    expect(geo.permLabelHidden).toBe(true);
    // 插件端权限按钮自带的下拉箭头也要收掉：22px 里塞不下图标 + 箭头。
    expect(geo.permCaretHidden).toBe(true);
    // 与「+」「/」同色（图标控件同一档亮度）：插件端模型按钮是文字控件、给的是
    // 次级文字色，图标档下这颗大脑不能跟着它走。
    expect(geo.iconColor).toBe(geo.toolbarIconColor);
    // 图标档必须让整行真的放得下：无重叠、无溢出。
    expect(geo.modelOnRing).toBe(0);
    expect(geo.overlaps).toEqual([]);
    expect(geo.rowScrollOverflow).toBe(0);

    // 点击行为与文字档一致：仍是同一个向上展开的菜单。
    await webviewPage.getByTestId("model-picker-trigger").click();
    await expect(webviewPage.getByTestId("model-picker-menu")).toBeVisible();
    await expect(webviewPage.getByTestId("model-picker-menu")).toContainText(
      MODEL,
    );
    // 打开后焦点按 roster 落到当前项（Escape 的处理挂在菜单项上，不在触发按钮上）。
    await expect(
      webviewPage
        .getByTestId("model-picker-menu")
        .locator(".model-picker-item")
        .first(),
    ).toBeFocused();
    await webviewPage.keyboard.press("Escape");
    await expect(webviewPage.getByTestId("model-picker-menu")).toHaveCount(0);
    // 图标档含义不直观 → 悬停出气泡（icon-only 的可读名要求）。
    await webviewPage.getByTestId("model-picker-trigger").hover();
    await expect(
      webviewPage
        .locator(".tooltip-box.visible")
        .filter({ hasText: `切换模型 · ${MODEL}` }),
    ).toBeVisible();
    await webviewPage.locator(".permission-mode-select").hover();
    await expect(
      webviewPage
        .locator(".tooltip-box.visible")
        .filter({ hasText: "权限：跳过权限确认" }),
    ).toBeVisible();
  });

  test("the four icon buttons share one interaction surface", async ({
    webviewPage,
  }) => {
    await mountChat(webviewPage, 380);

    // 圆角与框：图标档里模型/权限必须跟「+」「/」同档圆角，且不再出现文字档那圈
    // focusBorder 蓝框（spec 场景 8）。
    const surfaces = await webviewPage.evaluate(() => {
      const row = document.querySelector(".input-buttons-row") as HTMLElement;
      const read = (el: Element | null) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          radius: cs.borderTopLeftRadius,
          borderColor: cs.borderTopColor,
        };
      };
      return {
        plus: read(row.querySelector(".toolbar-icon-button")),
        model: read(row.querySelector(".model-picker-trigger")),
        permission: read(row.querySelector(".permission-mode-select")),
      };
    });
    expect(surfaces.model!.radius).toBe(surfaces.plus!.radius);
    expect(surfaces.permission!.radius).toBe(surfaces.plus!.radius);
    expect(surfaces.model!.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(surfaces.permission!.borderColor).toBe("rgba(0, 0, 0, 0)");

    // hover 面：四个都只变底色，颜色值一致（文字档那套「底色 + 蓝框」在图标档里不再生效）。
    // 「+」「/」按控制层的图标槽做「28 槽 + 22 视觉」，底色画在 ::before 上；模型与权限
    // 是 22 的实体盒子，底色画在自己身上。比的是同一块视觉面，所以各读各自真正上色的
    // 那一层 —— 不是把断言放宽成「差不多」。
    const hoverStyle = async (
      selector: string,
      paintedOn: "self" | "before" = "self",
    ) => {
      const loc = webviewPage.locator(selector).first();
      await loc.hover();
      await webviewPage.waitForTimeout(250);
      return loc.evaluate((el, where) => {
        const own = getComputedStyle(el);
        const paint =
          where === "before" ? getComputedStyle(el, "::before") : own;
        return {
          bg: paint.backgroundColor,
          ownBg: own.backgroundColor,
          border: own.borderTopColor,
        };
      }, paintedOn);
    };
    const plus = await hoverStyle(".toolbar-icon-button", "before");
    const model = await hoverStyle(".model-picker-trigger");
    const permission = await hoverStyle(".permission-mode-select");
    expect(model.bg).toBe(plus.bg);
    expect(permission.bg).toBe(plus.bg);
    // 「+」的实体盒子自己不上色：整个 hover 面只有一层，不会叠成两块。
    expect(plus.ownBg).toBe("rgba(0, 0, 0, 0)");
    expect(model.border).toBe("rgba(0, 0, 0, 0)");
    expect(permission.border).toBe("rgba(0, 0, 0, 0)");
  });

  /**
   * 权限下拉菜单项：图标与文案必须落在同一条水平线上、中间留出间距。
   * 菜单项写成普通 `<li>`（不声明 display）时两者按基线排 —— 图标底边压在文字基线
   * 上、字形盒紧贴文字，插件端实测图标圆心比文字中心高 4px、间距 0（远控页 −5px）。
   * 桌面端早就在 host-desktop.css 里声明了 flex/居中/8px，所以这条只有插件端与远控页
   * 会破相；三端共用同一个断言（见 utils/permissionMenu.ts）。
   */
  test("the permission menu's icon and label sit on one line", async ({
    webviewPage,
  }) => {
    await mountChat(webviewPage, 380);
    await expectPermissionMenuAligned(webviewPage);
  });

  test("widening the sidebar brings the model name back automatically", async ({
    webviewPage,
  }) => {
    await mountChat(webviewPage, 380);
    expect((await rowGeometry(webviewPage)).compact).toBe(true);

    await webviewPage.setViewportSize({ width: 760, height: 800 });
    await webviewPage.waitForFunction(() => {
      const row = document.querySelector(".input-buttons-row");
      return !!row && !row.className.includes("is-compact");
    });
    const wide = await rowGeometry(webviewPage);
    expect(wide.nameHidden).toBe(false);
    expect(wide.iconShown).toBe(false);
    expect(wide.permLabelHidden).toBe(false);
    expect(wide.modelOnRing).toBe(0);
    await expect(webviewPage.getByTestId("model-picker-trigger")).toContainText(
      MODEL,
    );
  });
});
