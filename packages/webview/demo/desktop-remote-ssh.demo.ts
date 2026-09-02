import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Remote SSH demo: screenshots for docs/desktop.md 「SSH 远程主机」. Everything
// is mocked — the desktop host bridge (`desktopWorkdirState` with a remote
// host, `desktopTerminalData`, `desktopWorkspaceDiff`) — no real SSH host.
const REMOTE_HOST = "dev-server";
const REMOTE_HOSTS = [REMOTE_HOST, "staging-box"];
const REMOTE_WORKDIR = "/workspace/demo-repo";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

// Shared setup: single-pane desktop layout. The host/workdir come from the
// injected `desktopWorkdirState` (the host-level current host), the
// conversation from `setInitialState` + `updateMessages`. Panel toggles are
// LOCAL React state; only the diff/terminal panels ask the host for data,
// which the demo injects back.
async function setupRemoteSession(injector: MessageInjector, host: string) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: REMOTE_WORKDIR,
    recentWorkdirs: [REMOTE_WORKDIR],
    host,
    hosts: REMOTE_HOSTS,
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(
    injector,
    REMOTE_WORKDIR,
    [
      { sessionId: "s-rs-1", title: "修复远程部署脚本失败", running: true },
      {
        sessionId: "s-rs-2",
        title: "检查容器日志与磁盘占用",
        waitingConfirmation: true,
      },
      { sessionId: "s-rs-3", title: "调整启动命令绑定监听地址" },
    ],
    host,
  );
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.updateMessages([
    MockDataGenerator.createUserMessage(
      "帮我看一下部署脚本为什么在远程服务器上跑不通",
      "msg-u1",
    ),
    MockDataGenerator.createAssistantMessage(
      "我先在远程服务器上看一下部署脚本和最近的日志。",
      "msg-a1",
    ),
  ]);
}

test.describe("Desktop SSH remote sessions (mocked)", () => {
  test("host selector lists local + parsed SSH hosts", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    // New-session state (no messages): the host selector renders left of the
    // workdir selector. Current host stays 本地 so the menu shows the split
    // between 本地 and the SSH hosts parsed from ~/.ssh/config.
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: REMOTE_WORKDIR,
      recentWorkdirs: [REMOTE_WORKDIR],
      host: "local",
      hosts: REMOTE_HOSTS,
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, REMOTE_WORKDIR, [
      { sessionId: "s-rs-1", title: "修复远程部署脚本失败", running: true },
      {
        sessionId: "s-rs-2",
        title: "检查容器日志与磁盘占用",
        waitingConfirmation: true,
      },
      { sessionId: "s-rs-3", title: "调整启动命令绑定监听地址" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await expect(webviewPage.getByTestId("desktop-host")).toBeVisible();
    await webviewPage.getByTestId("desktop-host").click();
    await expect(webviewPage.getByTestId("desktop-host-menu")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-host-local")).toBeVisible();
    await expect(webviewPage.getByTestId("desktop-host-item")).toHaveCount(2);
    await expect(
      webviewPage.getByTestId("desktop-host-add-entry"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-ssh-host-selector.webp",
    );
  });

  test("add-host entry expands to a connection-string input", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: REMOTE_WORKDIR,
      recentWorkdirs: [REMOTE_WORKDIR],
      host: "local",
      hosts: REMOTE_HOSTS,
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, REMOTE_WORKDIR, [
      { sessionId: "s-rs-1", title: "修复远程部署脚本失败", running: true },
      {
        sessionId: "s-rs-2",
        title: "检查容器日志与磁盘占用",
        waitingConfirmation: true,
      },
      { sessionId: "s-rs-3", title: "调整启动命令绑定监听地址" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", initialState);

    // Open the host menu and expand 添加主机… into the connection-string input.
    await webviewPage.getByTestId("desktop-host").click();
    await webviewPage.getByTestId("desktop-host-add-entry").click();
    await expect(webviewPage.getByTestId("desktop-host-add")).toBeVisible();
    await webviewPage
      .getByTestId("desktop-host-add")
      .locator("input")
      .fill("ssh deploy@dev-server -p 2222");
    await expect(
      webviewPage.getByTestId("desktop-host-add").locator("input"),
    ).toHaveValue("ssh deploy@dev-server -p 2222");

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-ssh-add-host.webp",
    );
  });

  test("remote session terminal panel runs a PTY over ssh", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupRemoteSession(injector, REMOTE_HOST);

    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-toggle-item-terminal").click();
    await webviewPage.keyboard.press("Escape");

    // TerminalPane lazily loads the xterm chunk, then asks the host to create
    // the remote PTY; the demo replies with remote-shell output.
    await injector.waitForMessage("desktopTerminalCreate");
    await injector.simulateExtensionMessage("desktopTerminalData", {
      termId: "term-main",
      data: "root@dev-server:/workspace/demo-repo# ls -la\r\n",
    });
    await injector.simulateExtensionMessage("desktopTerminalData", {
      termId: "term-main",
      data: "total 20\r\ndrwxr-xr-x 4 root root 4096 Aug  1 13:20 .\r\ndrwxr-xr-x 5 root root 4096 Aug  1 13:20 ..\r\n-rw-r--r-- 1 root root  328 Aug  1 13:20 app.js\r\n-rw-r--r-- 1 root root  102 Aug  1 13:20 deploy.sh\r\n",
    });
    await injector.simulateExtensionMessage("desktopTerminalData", {
      termId: "term-main",
      data: "root@dev-server:/workspace/demo-repo# ",
    });

    await expect(webviewPage.getByTestId("terminal-pane")).toBeVisible();
    await expect(webviewPage.getByTestId("terminal-restart")).toBeVisible();
    // The remote prompt must have reached the xterm buffer.
    await expect(webviewPage.getByTestId("terminal-body")).toContainText(
      "root@dev-server:/workspace/demo-repo#",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-ssh-remote-terminal.webp",
    );
  });

  test("remote session diff panel shows git changes over ssh", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupRemoteSession(injector, REMOTE_HOST);

    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-toggle-item-diff").click();
    await webviewPage.keyboard.press("Escape");

    // DiffPane asks the host for the workspace diff; the host runs git over
    // ssh — the demo replies with a remote-repo sample.
    await injector.waitForMessage("desktopGetWorkspaceDiff");
    await injector.simulateExtensionMessage("desktopWorkspaceDiff", {
      result: {
        kind: "ok",
        files: [
          {
            path: "app.js",
            status: "modified",
            additions: 3,
            deletions: 2,
            hunks:
              "@@ -1,6 +1,7 @@\n const http = require('http');\n const PORT = process.env.PORT || 3000;\n-const HOST = '0.0.0.0';\n+const HOST = process.env.HOST || '0.0.0.0';\n+// 容器内监听需要显式绑定到 0.0.0.0\n const server = http.createServer((req, res) => {\n   res.writeHead(200, { 'Content-Type': 'text/plain' });\n-  res.end('Hello World\\n');\n+  res.end('Hello from ' + HOST + '\\n');\n });\n server.listen(PORT, HOST);",
            truncated: false,
            binary: false,
          },
          {
            path: "deploy.sh",
            status: "modified",
            additions: 2,
            deletions: 1,
            hunks:
              "@@ -3,7 +3,8 @@\n set -e\n-rsync -avz ./app.js root@prod:/srv/app/\n+rsync -avz ./app.js ./package.json root@prod:/srv/app/\n+# 部署前先备份当前版本\n ssh root@prod 'systemctl restart wave-app'",
            truncated: false,
            binary: false,
          },
          {
            path: "notes/known-issues.md",
            status: "untracked",
            additions: 4,
            deletions: 0,
            hunks:
              "@@ -0,0 +1,4 @@\n+# 已知问题\n+- 容器时区固定为 UTC，日志时间与本地有偏差\n+- 首次部署需手动创建 /var/log/wave-app 目录",
            truncated: false,
            binary: false,
          },
        ],
      },
    });

    await expect(webviewPage.getByTestId("diff-pane")).toBeVisible();
    await expect(webviewPage.getByTestId("diff-file-modified")).toHaveCount(2);
    await expect(webviewPage.getByTestId("diff-file-untracked")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-ssh-remote-diff.webp",
    );
  });

  test("remote directory browser filters with a keyword and auto-selects", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    // New-session state on a remote host with no workdir yet: the workdir
    // selector shows 「选择远程目录…」 and 浏览… opens the VS Code-style
    // directory browser (list comes from the mocked host reply).
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      recentWorkdirs: [REMOTE_WORKDIR],
      host: REMOTE_HOST,
      hosts: REMOTE_HOSTS,
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(
      injector,
      REMOTE_WORKDIR,
      [
        {
          sessionId: "s-rs-1",
          title: "修复远程部署脚本失败",
          running: true,
        },
        {
          sessionId: "s-rs-2",
          title: "检查容器日志与磁盘占用",
          waitingConfirmation: true,
        },
        { sessionId: "s-rs-3", title: "调整启动命令绑定监听地址" },
      ],
      REMOTE_HOST,
    );
    // Initialize so the input area renders — the loading sweep keeps it
    // hidden until setInitialState (no conversation messages here to bring
    // it up, and the scenario intentionally has no workdir yet).
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await webviewPage.getByTestId("desktop-workdir").click();
    await webviewPage.getByTestId("desktop-workdir-browse").click();
    await expect(
      webviewPage.getByTestId("desktop-remote-browser"),
    ).toBeVisible();

    await injector.simulateExtensionMessage("desktopRemoteDirList", {
      host: REMOTE_HOST,
      requestId: "1",
      resolvedPath: "/home/dev",
      dirs: ["app", "deploy", "docs", "logs", "scripts", "tests"],
    });
    await expect(
      webviewPage.getByTestId("desktop-remote-browser-item"),
    ).toHaveCount(6);

    // Typing a keyword filters the single-level list and highlights matches;
    // the first match is auto-selected so Enter goes straight in.
    await webviewPage.getByTestId("desktop-remote-browser-input").fill("d");
    const items = webviewPage.getByTestId("desktop-remote-browser-item");
    await expect(items).toHaveCount(2);
    await expect(items.first()).toHaveClass(/selected/);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-remote-dir-browser.webp",
    );
  });
});
