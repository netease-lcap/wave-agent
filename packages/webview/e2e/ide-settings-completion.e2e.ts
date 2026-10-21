import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
  waitForSentCommand,
} from "./utils/settingsHarness.js";

/**
 * e2e（真浏览器 + 真 settings.js bundle）— 设置页「基础设置」的代码补全两行。
 *
 * 出处：spec ui/code-completion.md 故事 4（为补全单独配置模型）场景 2–4 与故事 5
 * （补全开关）场景 1；落点口径见同文件边界情况「模型配置真源在 CLI 侧」。
 *
 * 防的三类静默失效（单测各自只覆盖一段，真 bundle 覆盖整条链路）：
 * ① 候选清单到不了设置页：设置页在独立 settings tab（settings-preview-entry）里
 *    渲染，聊天 webview 的 `configuredModels` 回包不属于它 —— 入口必须自己发
 *    `getConfiguredModels` 并监听回包，否则下拉永远只有「未设置」一项；
 * ② 开关/下拉的值没进保存载荷：两键与语言同一次 `updateConfiguration`（省略键 =
 *    不改该键），漏传则「保存成功」但下一轮补全行为不变；
 * ③ 失效模型名被静默换掉：当前值不在候选里时必须原样保留 + 行内提示。
 */

const READY_CONFIGURATION = {
  language: "zh-CN",
  completionModel: "removed-model",
  completionEnabled: true,
};

/** 设置页里 label 关联的控件（IDE 宿主是原生 select/input，可直接按 aria-label 取）。 */
const completionSelect = (page: Parameters<typeof openSettings>[0]) =>
  page.locator('select[aria-label="补全模型"]');
const completionSwitch = (page: Parameters<typeof openSettings>[0]) =>
  page.locator('input[aria-label="代码补全"]');

test.describe("设置页「代码补全 / 补全模型」（真 settings bundle）", () => {
  test("进入全局设置拉候选并回填：失效值原样保留 + 行内提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: READY_CONFIGURATION });

    // ① 设置页自己向宿主请求候选清单（入口不接的话下拉永远没有候选项）
    await waitForSentCommand(webviewPage, "getConfiguredModels");

    // host 回包（与对话模型同源的模型集合；不含已失效的 removed-model）
    await simulateHostMessage(webviewPage, {
      command: "configuredModels",
      models: [
        { name: "qwen2.5-coder", supportsVision: false },
        { name: "gemini-3-flash", supportsVision: true },
      ],
    });

    // ② 失效值必须原样显示（不得静默回落到第一项），并给出可读提示
    await expect(completionSelect(webviewPage)).toHaveValue("removed-model");
    await expect(
      webviewPage.getByTestId("completion-model-stale-hint"),
    ).toBeVisible();

    // 候选里其余模型可选
    const options = await completionSelect(webviewPage).locator("option").all();
    expect(
      await Promise.all(options.map((o) => o.getAttribute("value"))),
    ).toEqual(["removed-model", "qwen2.5-coder", "gemini-3-flash"]);
  });

  test("改模型 + 关开关 → 一次 updateConfiguration 带两个顶层键", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: READY_CONFIGURATION });
    await waitForSentCommand(webviewPage, "getConfiguredModels");
    await simulateHostMessage(webviewPage, {
      command: "configuredModels",
      models: [
        { name: "qwen2.5-coder", supportsVision: false },
        { name: "gemini-3-flash", supportsVision: true },
      ],
    });

    await completionSelect(webviewPage).selectOption("qwen2.5-coder");
    // 自定义开关：input 视觉隐藏（尺寸为 0），真实可点区域是外层 label
    // .settings-switch（与设置页其余开关同一形态，见 settings-project-toggle e2e）。
    await webviewPage
      .locator('.settings-switch:has(input[aria-label="代码补全"])')
      .click();
    await webviewPage.getByRole("button", { name: "保存" }).click();

    await expect
      .poll(async () => {
        const messages = await sentToHost<{
          command?: string;
          configurationData?: Record<string, unknown>;
        }>(webviewPage);
        return messages.find((m) => m.command === "updateConfiguration")
          ?.configurationData;
      })
      .toEqual({
        // 与语言/上下文长度同一个载荷（diff 语义：只有真改动过的键出现）
        completionModel: "qwen2.5-coder",
        completionEnabled: false,
      });
  });

  test("未设置态：下拉首项为「未设置（跟随快速模型）」、开关默认开、不关不动时保存不写键", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, { configurationData: {} });

    const select = completionSelect(webviewPage);
    await expect(select).toHaveValue("");
    await expect(select.locator("option").first()).toHaveText(
      "未设置（跟随快速模型）",
    );
    await expect(completionSwitch(webviewPage)).toBeChecked();

    await webviewPage.getByRole("button", { name: "保存" }).click();

    await expect
      .poll(async () => {
        const messages = await sentToHost<{ command?: string }>(webviewPage);
        return messages.some((m) => m.command === "updateConfiguration");
      })
      .toBe(true);
    const save = (
      await sentToHost<{
        command?: string;
        configurationData?: Record<string, unknown>;
      }>(webviewPage)
    ).find((m) => m.command === "updateConfiguration");
    // 「省略键 = 不改该键」：未设置态 + 开关没被拨动 → 空载荷（不把默认「开」钉进文件）
    expect(save?.configurationData).toEqual({});
  });
});
