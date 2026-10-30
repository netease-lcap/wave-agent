import { test as base, expect, Page, Request, Route } from "@playwright/test";
import path from "path";
import fs from "fs";

/**
 * Desktop variant of the webview test harness: loads the same shared webview
 * bundle but sets `window.waveHostType = 'desktop'` before the bundle runs so
 * the entry point mounts DesktopApp instead of ChatApp. Waits for the
 * desktop-loading element (DesktopApp's first render) instead of
 * chat-container; tests then push `desktopWorkdirState` to mount the layout.
 */
type DesktopTestContext = {
  webviewPage: Page;
};

const webviewDistPath = path.join(process.cwd(), "dist");
const themeDir = path.join(process.cwd(), "theme");
const codiconsCssPath = path.join(
  process.cwd(),
  "node_modules",
  "@vscode",
  "codicons",
  "dist",
  "codicon.css",
);
const codiconsTtfPath = path.join(
  process.cwd(),
  "node_modules",
  "@vscode",
  "codicons",
  "dist",
  "codicon.ttf",
);

// Same dual-theme inlining as packages/desktop/scripts/syncWebview.mjs:
// both variable sets coexist, each scoped to <html data-theme="…">. The
// static data-theme="dark" (mirroring the real index.html) makes the
// [data-host="desktop"][data-theme="…"] rules in host-desktop.css actually
// resolve — without it the designer light/dark pairs collapsed to the
// unscoped light values and screenshots rendered white popups on dark UI.
const rewriteThemeBase = (css: string, theme: string) =>
  css.replace(/:root\s*\{/g, `:root[data-theme="${theme}"] {`);
const readTheme = (file: string, theme: string) =>
  fs.existsSync(path.join(themeDir, file))
    ? rewriteThemeBase(
        fs.readFileSync(path.join(themeDir, file), "utf8"),
        theme,
      )
    : "";
const vscodeStyles =
  readTheme("theme-base-dark.css", "dark") +
  readTheme("theme-base-light.css", "light");

/** 打包产物与 codicons：vscode-webview:// 与 http origin 两种页面共用这一份服务。 */
const serveWebviewAsset = async (route: Route, request: Request) => {
  const filename = new URL(request.url()).pathname.substring(1);

  if (filename === "codicons/codicon.css" && fs.existsSync(codiconsCssPath)) {
    route.fulfill({
      status: 200,
      contentType: "text/css",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: fs.readFileSync(codiconsCssPath),
    });
    return;
  }
  if (filename === "codicons/codicon.ttf" && fs.existsSync(codiconsTtfPath)) {
    route.fulfill({
      status: 200,
      contentType: "font/ttf",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: fs.readFileSync(codiconsTtfPath),
    });
    return;
  }

  const filePath = path.join(webviewDistPath, filename);

  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    const ext = path.extname(filename);

    let contentType = "application/octet-stream";
    if (ext === ".js") contentType = "application/javascript";
    else if (ext === ".css") contentType = "text/css";
    else if (ext === ".ttf") contentType = "font/ttf";
    else if (ext === ".woff") contentType = "font/woff";
    else if (ext === ".woff2") contentType = "font/woff2";

    route.fulfill({
      status: 200,
      contentType,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: content,
    });
  } else {
    route.fulfill({
      status: 404,
      body: `File not found: ${filename}`,
    });
  }
};

/** 宿主看到的那份 HTML（mock 桥 + 打包产物）；换 `baseHref` 即可换 origin。 */
const buildWebviewHtml = (baseHref: string): string => `
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave 代码智聊</title>
    <!-- Base resolves relative URLs (e.g. the terminal chunk's ./terminal.js)
         against the routed vscode-webview scheme so the harness serves them. -->
    <base href="${baseHref}">
    <link rel="stylesheet" href="${baseHref}codicons/codicon.css">
    <link rel="stylesheet" href="${baseHref}chat.css">
    <link rel="stylesheet" href="${baseHref}terminal.css">
    <style>
        ${vscodeStyles}

        body {
            margin: 0;
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
        }

        #root {
            width: 100%;
            height: 100vh;
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <script>
        ${mockDesktopApiJs}
    </script>
    <script src="${baseHref}chat.js"></script>
</body>
</html>`;

/** 关掉页面错误静音的噪音：用例失败时 pageerror 会指出是页面自身崩了。 */
const watchPageErrors = (page: Page) => {
  page.on("pageerror", (error) => {
    console.error("Page error:", error);
  });
};

const waitForMounted = (page: Page) =>
  // DesktopApp renders `desktop-loading` until the host pushes the first
  // `desktopWorkdirState`; tests inject that themselves, so the harness
  // only waits for the loading element (proves the bundle mounted).
  page.waitForSelector('[data-testid="desktop-loading"]', {
    timeout: 3000,
  });

export const test = base.extend<DesktopTestContext>({
  webviewPage: async ({ page }, use) => {
    watchPageErrors(page);
    await page.route("vscode-webview://**", serveWebviewAsset);
    await page.setContent(
      buildWebviewHtml("vscode-webview://mock-extension-id/"),
    );
    await waitForMounted(page);

    await use(page);
  },
});

/**
 * 在真实 http origin 下打开同一个 webview 包。
 *
 * `page.setContent`（上面那个 fixture）的文档跑在 about:blank 上，origin 是
 * opaque 的 "null"，浏览器会直接拒掉 IndexedDB（`SecurityError`）。草稿图片这类
 * 「按 origin 存本地数据」的用例因此必须落在真实 origin 上跑——桌面端真机是
 * file://、插件端是各自的自定义 scheme，都能用 IndexedDB。
 */
export async function openWebviewOnHttpOrigin(page: Page): Promise<void> {
  const origin = "http://wave-e2e.test";
  watchPageErrors(page);
  await page.route(`${origin}/**`, async (route, request) => {
    if (new URL(request.url()).pathname === "/") {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: buildWebviewHtml(`${origin}/`),
      });
      return;
    }
    await serveWebviewAsset(route, request);
  });
  await page.goto(`${origin}/`);
  await waitForMounted(page);
}

const mockDesktopApiJs = `
    window.process = {
        env: {
            NODE_ENV: 'production'
        }
    };

    // Select the desktop root component (mirrors the Electron preload script).
    window.waveHostType = 'desktop';

    let messageHandlers = [];

    // Desktop host parity (spec desktop-split-pane.md「启动即单个分屏」): the real
    // main process answers desktopReady with a single-pane layout, so the
    // welcome/empty state lives inside the split layout and pane-scoped pushes
    // carry the focused paneId. Mirror both here so desktop tests don't inject
    // desktopPanes themselves — any message arriving once a pane layout is
    // active is routed to the focused pane like the real host does.
    let panesActive = false;
    let focusedPaneId = 'pane-1';
    // 窗口级（应用级）命令：真宿主一律不带 paneId 下发（desktopHost.pushAppLevelState
    // 推 configurationResponse + 主题/更新通道），root 实例在分屏 rows 可见时不消费
    // 带 paneId 的消息（forThisPane），所以设置页的初值必须在任何时机注入都能到达
    // root——这里与真宿主对齐，不做 paneId 盖章。
    const globalCommands = [
        'desktopWorkdirState',
        'desktopSessionTree',
        'desktopPanes',
        'configurationResponse',
        'desktopThemeSource',
        'desktopThemeChange',
        'desktopUpdateChannel'
    ];

    const deliver = (message) => {
        if (message.command === 'desktopPanes') {
            const panes = message.panes || [];
            panesActive = panes.length > 0;
            const focused = message.focusedPaneId || (panes[0] && panes[0].paneId);
            if (focused) focusedPaneId = focused;
        } else if (message.command === 'desktopWorkdirState') {
            // Mirror the real main process: a workdir/host push is accompanied
            // by a desktopPanes update that keeps the focused pane's host in
            // sync (desktopHost.ts sendWorkdirState + pushPanes). The pane
            // ChatApp derives its effective host from desktopPanes, so without
            // this a remote desktopWorkdirState leaves the pane showing 本地.
            if (panesActive && message.host) {
                const host = message.host;
                deliver({ command: 'desktopPanes', panes: [{ paneId: focusedPaneId, host, row: 0 }], focusedPaneId });
            }
        }
        let payload = message;
        if (panesActive && message.command && message.paneId == null && globalCommands.indexOf(message.command) === -1) {
            payload = Object.assign({}, message, { paneId: focusedPaneId });
        }
        window.dispatchEvent(new MessageEvent('message', { data: payload }));
    };

    window.acquireVsCodeApi = () => ({
        postMessage: (message) => {
            if (!window.testMessages) window.testMessages = [];
            window.testMessages.push(message);
            if (message && message.command === 'desktopReady') {
                deliver({ command: 'desktopPanes', panes: [{ paneId: 'pane-1', host: 'local', row: 0 }], focusedPaneId: 'pane-1' });
            }
            // 真宿主（desktopHost.ts handleGetWorktreeChanges）会回答 worktree
            // 改动检查，且原样回带 requestId/sessionId；mock 也必须回，否则
            // 删除 worktree 会话的确认框永远停在「正在检查该 worktree 的改动…」
            // （DesktopSidebar 按 requestId 丢弃不匹配的应答）。改动数取代表性
            // 数值，让截图呈现「丢失改动」的最终态。
            if (message && message.command === 'desktopGetWorktreeChanges') {
                const reply = () => deliver({
                    command: 'desktopWorktreeChanges',
                    sessionId: message.sessionId,
                    requestId: message.requestId,
                    changes: { files: 2, commits: 1 },
                });
                // 真宿主是异步回答的（git status 本地/远端都要耗时间），删除
                // worktree 会话的确认框因此会先以「正在检查」的禁用态挂载。默认
                // 同步回答（既有用例与截图只要终态）；需要分别观察「检查中」与
                // 「结果」两个状态的用例，先置 window.__deferWorktreeChanges = true
                // 扣住应答，再用 window.__flushWorktreeChanges() 放行。
                if (window.__deferWorktreeChanges) {
                    window.__flushWorktreeChanges = reply;
                } else {
                    reply();
                }
            }
            window.dispatchEvent(new CustomEvent('vscode-message', { detail: message }));
        },
        setState: (state) => {},
        getState: () => ({})
    });

    window.simulateExtensionMessage = (message) => {
        deliver(message);
    };

    window.getTestMessages = () => window.testMessages || [];
    window.clearTestMessages = () => { window.testMessages = []; };
`;

export { expect };
