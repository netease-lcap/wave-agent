import type { Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import fs from "node:fs";
import path from "node:path";

/**
 * e2e（真浏览器 + 真 settings.js bundle）— 设置页不再有凭据输入控件。
 *
 * 出处：spec sso-auth「IDE 插件更多菜单与欢迎页」场景 5／边界情况「IDE 宿主不再
 * 有直连免登录旁路」（2026-09-10 拍板：宿主端 API Key / Base URL / headers 用户
 * 配置链路整体下线）。
 *
 * 防的是「回归再加回来」：设置页 7 个视图全部渲染一遍，断言没有任何输入控件或
 * 可见文案落在凭据语义上。真 bundle 覆盖 jsdom 测不到的视图切换路径（每个视图是
 * 独立 React 分支，只在切过去时挂载）。
 */

// SettingsPage 的颜色全部走 --vscode-* 变量，独立 settings.html 没有宿主注入，
// 必须手动带上深色主题变量集（与 settings-project-toggle.e2e.ts 同法）。
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

const settingsHtml = `
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

/** 凭据语义（不区分大小写，允许空格/连字符/下划线分隔）。 */
const CREDENTIAL_PATTERN =
  /api[\s_-]?key|base[\s_-]?url|api[\s_-]?base|defaultheaders|bearer\s?token|sk-ant|anthropic\.com/i;

const VIEWS = [
  "全局设置",
  "个性化",
  "项目设置",
  "技能",
  "子代理",
  "钩子",
  "MCP 服务",
];

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.setContent(settingsHtml);
  await expect(page.locator(".settings-page")).toBeVisible();
  // 初始化配置（settings entry 挂载时请求 getConfiguration）。故意带上遗留凭据
  // 字段：宿主已不再回带，若哪天界面又去消费它们，控件就会长出来。
  await page.evaluate(() => {
    window.simulateExtensionMessage({
      command: "configurationResponse",
      configurationData: {
        language: "zh-CN",
        contextLength: 200,
        apiKey: "sk-ant-legacy",
        baseURL: "https://api.anthropic.com/v1",
      },
    });
  });
}

async function openView(page: Page, view: string) {
  await page.locator(".settings-nav-item", { hasText: view }).click();
  // aria-current="page" 只在激活项上：它翻转即代表该视图已挂载完成。
  await expect(
    page.locator('.settings-nav-item[aria-current="page"]', { hasText: view }),
  ).toBeVisible();
}

/** 当前视图里所有输入控件与可见文案（真 DOM 采集，断言用）。 */
function collectViewSurfaces(page: Page) {
  return page.evaluate(() => {
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>("input, select, textarea"),
    ).map((el) =>
      [
        el.getAttribute("aria-label") ?? "",
        el.getAttribute("placeholder") ?? "",
        el.getAttribute("name") ?? "",
        el.getAttribute("id") ?? "",
      ].join(" | "),
    );
    const copy = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".settings-content h1, .settings-content h2, .settings-content h3, .settings-content p, .settings-content label, .settings-content button",
      ),
    ).map((el) => (el.textContent ?? "").trim());
    return { inputs, copy };
  });
}

test.describe("IDE 宿主设置页无凭据输入控件（真 settings bundle）", () => {
  test("7 个视图全部渲染后都不含 API Key / Base URL 控件", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    const offenders: string[] = [];
    for (const view of VIEWS) {
      await openView(webviewPage, view);
      const { inputs, copy } = await collectViewSurfaces(webviewPage);
      for (const surface of [...inputs, ...copy]) {
        if (CREDENTIAL_PATTERN.test(surface)) {
          offenders.push(`[${view}] ${surface}`);
        }
      }
    }

    expect(offenders).toEqual([]);

    // 反面校验：全局设置视图确实渲染出了输入控件，删掉的也确实是「有控件」的视图
    // ——否则上面每条都可能是「空页面通过」。
    await openView(webviewPage, "全局设置");
    const { inputs } = await collectViewSurfaces(webviewPage);
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.join(" | ")).toContain("AI 回复语言");
  });

  test("带遗留凭据的 configurationResponse 不产生凭据控件", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    const globalSurfaces = await collectViewSurfaces(webviewPage);
    expect(globalSurfaces.inputs.join(" | ")).not.toMatch(CREDENTIAL_PATTERN);
    expect(globalSurfaces.copy.join(" | ")).not.toMatch(CREDENTIAL_PATTERN);

    // 个性化视图（自动记忆 + AGENTS.md 编辑器）同样没有任何凭据输入。
    await openView(webviewPage, "个性化");
    const personalization = await collectViewSurfaces(webviewPage);
    expect(personalization.inputs.join(" | ")).not.toMatch(CREDENTIAL_PATTERN);
    expect(personalization.copy.join(" | ")).not.toMatch(CREDENTIAL_PATTERN);
  });
});
