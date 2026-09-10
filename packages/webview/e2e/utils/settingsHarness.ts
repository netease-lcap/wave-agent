/**
 * 设置页 e2e 公共 harness（IDE settings tab 场景）。
 *
 * 设置页由独立 bundle `settings.js`（src/settings-preview-entry.tsx）渲染，与聊天
 * bundle 不同：宿主是 IDE 编辑器区的 WebviewPanel，页面需要自己带
 * `<script src="vscode-webview://mock-extension-id/settings.js">` 与
 * `window.acquireVsCodeApi`。此前 settings-edit-openfile / settings-project-toggle
 * 两个 e2e 与 agents-dialog / settings-manage 两个 demo 各自抄了一份同样的
 * settings.html 样板（theme 注入 + mockVscodeApi + openSettings + 消息收发），
 * 本文件把它收拢为唯一来源，新用例一律复用，不要再抄第 N 份。
 *
 * `webviewPage` fixture（webviewTestHarness）会先把 chat.html 塞进页面，调用
 * `openSettings` 时用 setContent 整体替换为 settings.html —— setContent 会重置
 * 文档与全局对象，因此 `window.testMessages` 从空开始。
 */
import type { Page } from "@playwright/test";
import { expect } from "./webviewTestHarness.js";
import fs from "node:fs";
import path from "node:path";

// SettingsPage 的颜色全部走 --vscode-* 变量，独立 settings.html 没有宿主注入，
// 必须手动带上深色主题变量集，否则页面为白底浅色（实测 2026-08-29）。
const themeStyles = fs.readFileSync(
  path.join(process.cwd(), "theme", "theme-base-dark.css"),
  "utf8",
);

const mockVscodeApiJs = `
    window.process = { env: { NODE_ENV: 'production' } };
    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
        },
        setState: () => {},
        getState: () => ({})
    });
    window.simulateExtensionMessage = (message) => {
        window.dispatchEvent(new MessageEvent('message', { data: message }));
    };
`;

/** 独立 settings.html（settings.js bundle 的最小宿主页面）。 */
export const settingsHtml = `
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave Settings</title>
    <style>${themeStyles}</style>
    <link rel="stylesheet" href="vscode-webview://mock-extension-id/settings.css">
</head>
<body>
    <div id="root"></div>
    <script>${mockVscodeApiJs}</script>
    <script src="vscode-webview://mock-extension-id/settings.js"></script>
</body>
</html>`;

/** webview → host 的消息（`command` 之外字段按用例自定）。 */
export interface SettingsSentMessage {
  command?: string;
  [key: string]: unknown;
}

export interface OpenSettingsOptions {
  width?: number;
  height?: number;
  /**
   * 挂载后回 `configurationResponse`（默认 true）。settings entry 挂载时会发
   * `getConfiguration`，不回包表单一直停在未加载态（保存按钮禁用）。
   */
  configuration?: boolean;
  /** 模拟 host 下发 `settingsState`（直选某视图 / 设定 workdir）。 */
  settingsState?: { workdir?: string; nav?: string };
}

/**
 * 打开设置页并等到 `.settings-page` 渲染完成。
 * 需要直达某个视图（/agents、/skills 场景）时传 `settingsState`。
 */
export async function openSettings(
  page: Page,
  options: OpenSettingsOptions = {},
): Promise<void> {
  const {
    width = 1000,
    height = 760,
    configuration = true,
    settingsState,
  } = options;
  await page.setViewportSize({ width, height });
  await page.setContent(settingsHtml);
  await expect(page.locator(".settings-page")).toBeVisible();
  if (settingsState) {
    await simulateHostMessage(page, {
      command: "settingsState",
      ...settingsState,
    });
  }
  if (configuration) {
    await simulateHostMessage(page, {
      command: "configurationResponse",
      configurationData: { language: "zh-CN", contextLength: 200 },
    });
  }
}

/** 模拟 host → webview 消息（等价于 IDE 侧 postMessage 到 webview）。 */
export function simulateHostMessage(
  page: Page,
  message: Record<string, unknown>,
): Promise<void> {
  return page.evaluate((msg) => {
    window.simulateExtensionMessage(msg);
  }, message);
}

/** 设置页到目前为止发给 host 的全部消息。 */
export function sentToHost<T = SettingsSentMessage>(page: Page): Promise<T[]> {
  return page.evaluate(
    () => (window.testMessages ?? []) as unknown[],
  ) as Promise<T[]>;
}

/** 等到 host 收到指定 command 的消息，返回第一条。 */
export async function waitForSentCommand<T = SettingsSentMessage>(
  page: Page,
  command: string,
): Promise<T> {
  await expect
    .poll(async () => {
      const messages = await sentToHost<SettingsSentMessage>(page);
      return messages.filter((m) => m.command === command).length;
    })
    .toBeGreaterThan(0);
  const messages = await sentToHost<SettingsSentMessage>(page);
  return messages.find((m) => m.command === command) as T;
}
