import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

/**
 * Regression（设置页写盘反馈，2026-09-09 拍板「走宿主全局 toast」+ 2026-11-04
 * 拍板「用户偏好即时提交、无保存按钮」）：
 *
 * 设置页此前自己渲染页面内提示（`.settings-save-message` 内联灰字，全局设置 /
 * 个性化 / AGENTS.md 三处）。拍板后改为：写盘结果的用户可见反馈由宿主（桌面
 * showToast / VSCE showInformationMessage / JB IdeService.showInfo）给出，webview
 * 只负责 ①发出正确的写盘消息 ②（仅 AGENTS.md 整文件写入）维护「保存中」禁用态并
 * 在 host 回包后复位，**不再渲染任何页面内提示**。本文件驱动真实 settings.js
 * bundle 覆盖这两件事，同时补 AGENTS.md「键入 → 保存」的请求载荷（G8）。
 *
 * 断言口径：
 * - 载荷 = 发给 host 的 `updateConfiguration`（每个控件一条，只含该键）/
 *   `setAgentsContent` 消息内容；
 * - 无页面内提示 = 旧类名 `.settings-save-message` 不存在；
 * - 复位 = 回 `configurationError` 后界面回滚到上一次生效值、`agentsContentSaved`
 *   后文本区与保存按钮重新可用（偏好键没有「保存中」态：写盘是乐观显示）。
 */

/** 保存区块（按小标题定位，避免同一视图内多个 `.settings-actions` 撞车）。 */
function saveSection(webviewPage: Page, heading: string): Locator {
  return webviewPage
    .locator(".settings-section")
    .filter({ has: webviewPage.getByRole("heading", { name: heading }) });
}

/** 该区块内不得出现自建提示（旧实现的内联灰字 + 追加在动作行里的文案）。 */
async function expectNoInlineSaveHint(section: Locator, actionText: string) {
  await expect(section.locator(".settings-save-message")).toHaveCount(0);
  // 旧实现把提示文字追加在保存按钮所在的动作行内：无提示时该行只有按钮文本
  await expect(section.locator(".settings-actions")).toHaveText(actionText);
}

test.describe("设置页写盘反馈（settings tab）", () => {
  test("全局设置：改语言/上下文各自即时发一条只含该键的 updateConfiguration，无页面内提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    // 没有「保存」按钮（2026-11-04 拍板，spec agent-config「设置页控件的保存时机」）
    await expect(
      webviewPage.getByRole("button", { name: "保存", exact: true }),
    ).toHaveCount(0);

    await webviewPage.getByLabel("AI 回复语言").selectOption("en-US");
    await expect
      .poll(async () => {
        const sent = await sentToHost<{
          command?: string;
          configurationData?: Record<string, unknown>;
        }>(webviewPage);
        return sent
          .filter((m) => m.command === "updateConfiguration")
          .map((m) => m.configurationData);
      })
      .toEqual([{ language: "en-US" }]);

    // 数字输入：打字途中不写盘，失焦才写
    const contextLength = webviewPage.getByLabel("上下文长度");
    await contextLength.fill("300");
    await contextLength.blur();
    await expect
      .poll(async () => {
        const sent = await sentToHost<{
          command?: string;
          configurationData?: Record<string, unknown>;
        }>(webviewPage);
        return sent
          .filter((m) => m.command === "updateConfiguration")
          .map((m) => m.configurationData);
      })
      .toEqual([{ language: "en-US" }, { contextLength: 300 }]);

    // 页面内无自建提示（反馈由宿主全局 toast 承担）
    await expect(
      saveSection(webviewPage, "基础设置").locator(".settings-save-message"),
    ).toHaveCount(0);
    await expect(webviewPage.getByText(/保存成功/)).toHaveCount(0);
  });

  test("个性化：自动记忆开关拨动即写、轮次失焦写；失败回执后回滚、无页面内错误文案", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();

    const toggle = webviewPage.getByLabel("开启自动记忆");
    await expect(toggle).toBeChecked();
    // 开关 input 是视觉隐藏（opacity: 0）的自绘 switch：点可视滑轨（label 内）切换
    await saveSection(webviewPage, "自动记忆规则")
      .locator(".settings-switch-slider")
      .click();
    await expect(toggle).not.toBeChecked();

    const frequency = webviewPage.getByLabel("触发记忆提取会话轮次");
    await frequency.fill("5");
    await frequency.blur();

    const sent = await sentToHost<{
      command?: string;
      configurationData?: Record<string, unknown>;
    }>(webviewPage);
    // 关闭态（false）必须真的随报文下发——#2115「关了还在记忆」的回归点；
    // 每个控件只管自己那一键（diff 语义：未改的键不出现）。
    expect(
      sent
        .filter((m) => m.command === "updateConfiguration")
        .map((m) => m.configurationData),
    ).toEqual([{ autoMemoryEnabled: false }, { autoMemoryFrequency: 5 }]);

    await expect(
      saveSection(webviewPage, "自动记忆规则").locator(
        ".settings-save-message",
      ),
    ).toHaveCount(0);

    // 失败回执（configurationError）：界面回滚到上一次生效值（宿主不回
    // configurationResponse 就表示没写进文件），且不出现任何页面内错误文案。
    await simulateHostMessage(webviewPage, {
      command: "configurationError",
      error: "Failed to save configuration: boom",
    });
    await expect(toggle).toBeChecked();
    await expect(webviewPage.getByText(/保存失败|保存出错/)).toHaveCount(0);
  });

  test("AGENTS.md：键入用户级内容后保存，发出 setAgentsContent（scope user）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "user",
      content: "# 旧规则",
    });

    const textarea = webviewPage.getByLabel("用户级 AGENTS.md 内容");
    await expect(textarea).toHaveValue("# 旧规则");
    await textarea.fill("# 新规则\n- 测试覆盖");

    const saveButton = webviewPage.getByRole("button", {
      name: "保存用户级配置",
    });
    await saveButton.click();

    // 保存中：文本区与按钮一并禁用（host 回包前不可再编辑）
    await expect(textarea).toBeDisabled();
    await expect(saveButton).toBeDisabled();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      workdir?: string;
    }>(webviewPage);
    const request = saved.find((m) => m.command === "setAgentsContent");
    expect(request).toMatchObject({
      scope: "user",
      content: "# 新规则\n- 测试覆盖",
      workdir: undefined,
    });

    await expectNoInlineSaveHint(
      saveSection(webviewPage, "AGENTS.md"),
      "保存用户级配置",
    );

    // agentsContentSaved 复位：文本区与按钮重新可用
    await simulateHostMessage(webviewPage, {
      command: "agentsContentSaved",
      scope: "user",
      ok: true,
    });
    await expect(textarea).toBeEnabled();
    await expect(saveButton).toBeEnabled();
  });

  test("AGENTS.md：项目级保存带当前 workdir（归属键）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent" },
    });
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# 项目规则",
    });

    // 先等 host 内容落地（回填 effect 会覆盖草稿），再键入
    const textarea = webviewPage.getByLabel("项目级 AGENTS.md 内容");
    await expect(textarea).toHaveValue("# 项目规则");
    await textarea.fill("# 项目规则 v2");
    await webviewPage.getByRole("button", { name: "保存项目级配置" }).click();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      workdir?: string;
    }>(webviewPage);

    // 读取请求与写入请求都要带归属键：workdir 决定读写哪个项目的 AGENTS.md，
    // 漏传就会被 host 兜底到 effectiveWorkdir（#2152/#2155 的错项目根因）。
    expect(
      saved.find(
        (m) => m.command === "getAgentsContent" && m.scope === "project",
      ),
    ).toMatchObject({ scope: "project", workdir: "/work/wave-agent" });

    const request = saved.find((m) => m.command === "setAgentsContent");
    expect(request).toMatchObject({
      scope: "project",
      content: "# 项目规则 v2",
      workdir: "/work/wave-agent",
    });
  });
});
