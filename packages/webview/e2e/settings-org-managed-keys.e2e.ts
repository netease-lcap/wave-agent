import { test, expect } from "./utils/webviewTestHarness.js";
import type { Page } from "@playwright/test";
import {
  openSettings,
  sentToHost,
  type SettingsSentMessage,
} from "./utils/settingsHarness.js";

/**
 * e2e（真浏览器 + 真 settings.js bundle + 真 CSS）——被更高层覆盖的用户偏好键
 * 必须**如实显示生效值**并置灰（spec core/agent-config.md「IDE 插件配置入口」场景 9、
 * 边界说明「用户偏好的层与来源」）：
 *
 * 用户级 `~/.wave/settings.json` 只是用户偏好的**落点**，企业下发的 Remote 组织
 * 配置（以及机器环境变量）可以盖过它。宿主回包除生效值外带 `preferenceSources`：
 * 来源为 `remote` 的键置灰 + 行内提示「由组织配置管理」（组织策略不可被本地覆盖），
 * `env` / `user` / `default` 的键照旧可编辑；老宿主缺该字段时全部可编辑。
 *
 * 分层：层序归因（哪个键来自哪一层）由 SDK `readUserPreferenceView` 单测与真 host
 * 层验证；本文件只锁 webview 这一跳的**渲染与可编辑性**（真 DOM、真 postMessage）。
 */

/** 取某行（设置页行容器）内的文案与控件。 */
function rowOf(webviewPage: Page, heading: string) {
  return webviewPage.locator(".settings-row", { hasText: heading });
}

test.describe("被组织配置覆盖的键：显示生效值 + 置灰 + 「由组织配置管理」", () => {
  test("language / contextLength 来自 Remote：显示生效值、控件禁用、行内提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      configurationData: {
        language: "en-US",
        contextLength: 256,
        preferenceSources: { language: "remote", contextLength: "remote" },
      },
    });

    const language = webviewPage.getByLabel("AI 回复语言");
    await expect(language).toHaveValue("en-US");
    await expect(language).toBeDisabled();
    await expect(rowOf(webviewPage, "AI 回复语言")).toContainText(
      "由组织配置管理",
    );

    const contextLength = webviewPage.getByLabel("上下文长度");
    await expect(contextLength).toHaveValue("256");
    await expect(contextLength).toBeDisabled();
    await expect(rowOf(webviewPage, "上下文长度")).toContainText(
      "由组织配置管理",
    );
  });

  test("自动记忆开关/轮次来自 Remote：同样置灰 + 提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      configurationData: {
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
        preferenceSources: {
          autoMemoryEnabled: "remote",
          autoMemoryFrequency: "remote",
        },
      },
    });
    await webviewPage.getByRole("button", { name: "个性化" }).click();

    const enabled = webviewPage.getByLabel("开启自动记忆");
    await expect(enabled).not.toBeChecked();
    await expect(enabled).toBeDisabled();

    const frequency = webviewPage.getByLabel("触发记忆提取会话轮次");
    await expect(frequency).toHaveValue("7");
    await expect(frequency).toBeDisabled();

    await expect(rowOf(webviewPage, "开启自动记忆")).toContainText(
      "由组织配置管理",
    );
    await expect(rowOf(webviewPage, "触发记忆提取会话轮次")).toContainText(
      "由组织配置管理",
    );
  });

  test("来源为 env / user 的键不置灰：显示生效值但仍可编辑、无提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      configurationData: {
        language: "en-US",
        contextLength: 256,
        preferenceSources: { language: "env", contextLength: "user" },
      },
    });

    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("en-US");
    await expect(webviewPage.getByLabel("AI 回复语言")).toBeEnabled();
    await expect(webviewPage.getByLabel("上下文长度")).toBeEnabled();
    await expect(webviewPage.getByText("由组织配置管理")).toHaveCount(0);
  });

  test("老宿主回包缺 preferenceSources：全部可编辑（向后兼容）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      configurationData: { language: "en-US", contextLength: 256 },
    });

    await expect(webviewPage.getByLabel("AI 回复语言")).toBeEnabled();
    await expect(webviewPage.getByLabel("上下文长度")).toBeEnabled();
    await expect(webviewPage.getByText("由组织配置管理")).toHaveCount(0);
  });

  test("被覆盖的键改不动 → 保存载荷里不出现它", async ({ webviewPage }) => {
    await openSettings(webviewPage, {
      configurationData: {
        language: "en-US",
        contextLength: 256,
        preferenceSources: { language: "remote" },
      },
    });

    // 置灰的 language 收不到用户操作；只改上下文长度。
    await webviewPage.getByLabel("上下文长度").fill("128");
    await webviewPage
      .getByRole("button", { name: "保存", exact: true })
      .click();

    const sent = await sentToHost<SettingsSentMessage>(webviewPage);
    const saves = sent.filter((m) => m.command === "updateConfiguration");
    expect(saves[saves.length - 1]?.configurationData).toEqual({
      contextLength: 128,
    });
  });
});
