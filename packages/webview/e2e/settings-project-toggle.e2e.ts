import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

/**
 * Regression (VS Code 插件端「项目设置 → 内置插件」SDD 开关永久置灰):
 *
 * 设置页由独立 settings tab（settings-preview-entry，settings.js bundle）渲染。
 * 若入口不传 onLoadProjectSettings / 不监听 host 的 projectSettings 回包，
 * SettingsPage 的 projectSettings 恒为 undefined → 开关被
 * `disabled={pluginToggling || !projectSettings}` 禁用且永不加载。
 *
 * 本用例驱动真实 settings.js bundle：进入「项目设置」视图应发出 getProjectSettings；
 * host 回 projectSettings 后开关应可点，点击应发出 setBuiltinPluginEnabled(project)。
 * 修复前：不发 getProjectSettings、开关保持禁用、点击无消息 —— 三段断言全部失败。
 */

test.describe("设置页项目设置内置插件开关（settings tab）", () => {
  test("进入项目设置视图请求并回填 enabledPlugins，SDD 开关可切换", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    // 进入「项目设置」视图（工作区组第一个导航项）
    await webviewPage
      .locator(".settings-nav-item", { hasText: "项目设置" })
      .click();
    // 自定义开关：input 视觉隐藏（opacity/尺寸为 0），真实可点区域是外层 label
    // .settings-switch；状态断言直接打在 input 的 disabled/checked 属性上。
    const sddSwitch = webviewPage.locator(
      '.settings-switch input[aria-label="启用 SDD 插件"]',
    );
    await expect(sddSwitch).toHaveCount(1);

    // 开关未拿到项目设置前保持禁用
    await expect(sddSwitch).toBeDisabled();

    // 视图进入时应向 host 请求项目级 enabledPlugins（修复前永不发出）
    await expect
      .poll(async () => {
        const messages = await sentToHost<{ command?: string }>(webviewPage);
        return messages.some((m) => m.command === "getProjectSettings");
      })
      .toBe(true);

    // host 回发 projectSettings（.wave/settings.json 合并后，sdd@builtin 未启用）
    await simulateHostMessage(webviewPage, {
      command: "projectSettings",
      enabledPlugins: {},
    });
    await expect(sddSwitch).toBeEnabled();

    // 点击开关 → 发出 setBuiltinPluginEnabled（project scope）
    await webviewPage
      .locator('.settings-switch:has(input[aria-label="启用 SDD 插件"])')
      .click();
    await expect
      .poll(async () => {
        const messages = await sentToHost<{
          command?: string;
          pluginId?: string;
          enabled?: boolean;
          scope?: string;
        }>(webviewPage);
        return messages.find((m) => m.command === "setBuiltinPluginEnabled");
      })
      .toEqual({
        command: "setBuiltinPluginEnabled",
        pluginId: "sdd@builtin",
        enabled: true,
        scope: "project",
      });
  });
});
