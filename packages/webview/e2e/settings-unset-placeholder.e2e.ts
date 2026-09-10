import { test, expect } from "./utils/webviewTestHarness.js";
import type { Page } from "@playwright/test";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
  type SettingsSentMessage,
} from "./utils/settingsHarness.js";

/**
 * e2e（真浏览器 + 真 settings.js bundle）——设置页「未设置」占位语义与保存载荷
 * 的 diff 语义（spec core/agent-config.md「IDE 插件配置入口」场景 7–8、边界说明
 * 「省略键 = 不改该键」）：
 *
 * ① 文件里**没有**某个用户偏好键时，四个控件都必须用「未设置」表达系统默认，
 *    而不是显示一个编造出来的真实值（语言下拉显式项、两个数字输入留空 + 灰字
 *    占位符；自动记忆开关刻意不做占位态——真实默认就是「开」，三态开关更难用）；
 * ② 保存载荷**只含用户改过的字段**：一个字都没改 ⇒ 空载荷（不把未设置的键钉进
 *    settings.json，因此系统环境里的 WAVE_MAX_INPUT_TOKENS 不会被随手保存钉成
 *    200000）；只改语言 ⇒ 其余键不出现在报文里。
 *
 * 分层：宿主/CLI 侧「未提供的键保持文件中现值」由真 host 层
 * （packages/desktop/tests/integration/realHostCredentialWire.integration.test.ts）
 * 验证；本文件只锁 webview 这一跳（真 bundle、真 DOM、真 postMessage）。
 */

/** 基础设置区块的「保存」（全局设置视图内唯一的保存按钮）。 */
function globalSaveButton(webviewPage: Page) {
  return webviewPage.getByRole("button", { name: "保存", exact: true });
}

/** 最后一次发给 host 的 updateConfiguration 载荷。 */
async function lastSavePayload(
  webviewPage: Page,
): Promise<Record<string, unknown> | undefined> {
  const sent = await sentToHost<SettingsSentMessage>(webviewPage);
  const saves = sent.filter((m) => m.command === "updateConfiguration");
  return saves[saves.length - 1]?.configurationData as
    | Record<string, unknown>
    | undefined;
}

test.describe("设置页未设置态与保存载荷（文件里没有这些键）", () => {
  test("四个控件的未设置显示态：语言「未设置（默认：中文）」、两个数字输入留空 + 占位符、开关仍是「开」", async ({
    webviewPage,
  }) => {
    // 全新安装：settings.json 里既没有 language / contextLength，也没有自动记忆键。
    await openSettings(webviewPage, { configurationData: {} });

    const language = webviewPage.getByLabel("AI 回复语言");
    await expect(language).toHaveValue("");
    await expect(language.locator("option").first()).toHaveText(
      "未设置（默认：中文）",
    );

    const contextLength = webviewPage.getByLabel("上下文长度");
    await expect(contextLength).toHaveValue("");
    await expect(contextLength).toHaveAttribute(
      "placeholder",
      "跟随模型配置（默认 200K）",
    );

    await webviewPage.getByRole("button", { name: "个性化" }).click();
    // 布尔开关不做占位态：它的真实默认就是「开」。
    await expect(webviewPage.getByLabel("开启自动记忆")).toBeChecked();
    const frequency = webviewPage.getByLabel("触发记忆提取会话轮次");
    await expect(frequency).toHaveValue("");
    await expect(frequency).toHaveAttribute("placeholder", "默认 1 轮");
  });

  test("一个字都没改就保存 → 载荷为空（不把未设置的键写进文件）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });

    await globalSaveButton(webviewPage).click();

    // 空载荷 = 不改任何键（宿主/CLI 侧「未提供的键保持文件中现值」）。
    expect(await lastSavePayload(webviewPage)).toEqual({});
  });

  test("只改语言 → 载荷只有 language，其余键不出现", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });

    await webviewPage.getByLabel("AI 回复语言").selectOption("en-US");
    await globalSaveButton(webviewPage).click();

    expect(await lastSavePayload(webviewPage)).toEqual({ language: "en-US" });
  });

  test("只填上下文长度（语言保持未设置）→ 载荷只有 contextLength", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });

    await webviewPage.getByLabel("上下文长度").fill("128");
    await globalSaveButton(webviewPage).click();

    expect(await lastSavePayload(webviewPage)).toEqual({ contextLength: 128 });
  });

  test("文件已有值但没动过 → 载荷同样为空（无差异保存不写文件）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    await globalSaveButton(webviewPage).click();

    expect(await lastSavePayload(webviewPage)).toEqual({});
  });

  test("个性化：只拨开关 → 载荷只有 autoMemoryEnabled（轮次仍处未设置态不写）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });
    await webviewPage.getByRole("button", { name: "个性化" }).click();

    // 开关 input 是视觉隐藏的自绘 switch：点可视滑轨切换（与既有 e2e 一致）。
    await webviewPage
      .locator('.settings-switch:has(input[aria-label="开启自动记忆"])')
      .click();
    await webviewPage
      .getByRole("button", { name: "保存", exact: true })
      .click();

    expect(await lastSavePayload(webviewPage)).toEqual({
      autoMemoryEnabled: false,
    });
  });

  test("保存回包后展示值随文件刷新（写过值就不再显示未设置态）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });

    await webviewPage.getByLabel("AI 回复语言").selectOption("en-US");
    await globalSaveButton(webviewPage).click();
    // host 回发写入后的用户偏好（language 键现在存在了）。
    await simulateHostMessage(webviewPage, {
      command: "configurationResponse",
      configurationData: { language: "en-US" },
    });

    const language = webviewPage.getByLabel("AI 回复语言");
    await expect(language).toHaveValue("en-US");
    // 写过值后不再显示「未设置（默认：中文）」项 —— 不提供「恢复默认 / 清除」入口。
    await expect(
      language.locator("option", { hasText: "未设置（默认：中文）" }),
    ).toHaveCount(0);
  });
});
