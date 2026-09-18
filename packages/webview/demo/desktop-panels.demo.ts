import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

// Shared setup: single-pane desktop layout with one conversation so the panel
// toggle and the side panels make sense. Panel toggles are LOCAL React state
// (no host round-trip to mount a panel); only the diff/terminal panels then
// ask the host for their data, which the demo injects back.
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(injector, DIR_A, [
    { sessionId: "s-pn-1", title: "修复登录页样式问题", running: true },
    {
      sessionId: "s-pn-2",
      title: "新增订单列表页组件",
      hasWorktree: true,
    },
    {
      sessionId: "s-pn-3",
      title: "拆分配置到独立模块",
      waitingConfirmation: true,
    },
  ]);
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
    MockDataGenerator.createAssistantMessage(
      "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
      "msg-a1",
    ),
  ]);
}

test.describe("Desktop conversation-level panels", () => {
  test("panel toggle menu lists preview / diff / terminal", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupSinglePane(injector);

    // The "＋" menu lives in the tab bar: open a first panel via the header
    // toggle (empty slot → empty-state entry), then list the panel types.
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-terminal").click();
    await webviewPage.getByTestId("panel-tabs-add").click();
    await expect(webviewPage.getByTestId("panel-toggle-menu")).toBeVisible();
    await expect(
      webviewPage.getByTestId("panel-toggle-item-preview"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("panel-toggle-item-diff"),
    ).toBeVisible();
    await expect(
      webviewPage.getByTestId("panel-toggle-item-terminal"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-panel-toggle.webp",
    );
  });

  test("diff pane renders an accordion of git workspace changes", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupSinglePane(injector);

    // Open the diff panel via the header toggle (empty slot → empty-state).
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-diff").click();

    // DiffPane asks the host for the workspace diff; reply with a sample.
    await injector.waitForMessage("desktopGetWorkspaceDiff");
    await injector.simulateExtensionMessage("desktopWorkspaceDiff", {
      result: {
        kind: "ok",
        base: {
          label: "main",
          sha: "4d2f9a1b7c3e5f80a1b2c3d4e5f60718293a4b5c",
          kind: "default-branch",
          ref: "refs/remotes/origin/main",
        },
        commits: [
          {
            sha: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432",
            shortSha: "9f8e7d6",
            subject: "抽取登录接口调用到 utils/auth",
          },
          {
            sha: "1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d",
            shortSha: "1a2b3c4",
            subject: "登录表单补充错误态",
          },
        ],
        files: [
          {
            path: "src/components/Login.tsx",
            status: "modified",
            additions: 8,
            deletions: 2,
            hunks:
              "@@ -12,4 +12,10 @@\n function Login() {\n-  const [user, setUser] = useState(null);\n+  const [user, setUser] = useState(null);\n+  const [error, setError] = useState(null);\n+  // 表单提交前校验\n   return (",
            truncated: false,
            binary: false,
          },
          {
            path: "src/utils/auth.ts",
            status: "added",
            additions: 15,
            deletions: 0,
            hunks:
              "@@ -0,0 +1,15 @@\n+export function authenticate(user, pass) {\n+  // 校验用户名密码后请求登录接口\n+  return fetch('/api/login', { method: 'POST', body: JSON.stringify({ user, pass }) });\n+}",
            truncated: false,
            binary: false,
          },
          {
            path: "old/config.ts",
            status: "deleted",
            additions: 0,
            deletions: 12,
            hunks: "",
            truncated: false,
            binary: false,
          },
          {
            path: "public/logo.png",
            status: "untracked",
            additions: 0,
            deletions: 0,
            hunks: "",
            truncated: false,
            binary: true,
          },
        ],
      },
    });

    await expect(webviewPage.getByTestId("diff-pane")).toBeVisible();
    await expect(webviewPage.getByTestId("diff-file-modified")).toBeVisible();
    await expect(webviewPage.getByTestId("diff-file-added")).toBeVisible();
    await expect(webviewPage.getByTestId("diff-file-deleted")).toBeVisible();
    await expect(webviewPage.getByTestId("diff-file-untracked")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-diff-pane.webp",
    );

    // Pick a file that actually has hunks (the first one in path order is a
    // deletion with an empty body), then switch to the side-by-side view.
    await webviewPage
      .getByTestId("diff-tree")
      .locator('[data-path="src/components/Login.tsx"]')
      .click();
    await webviewPage.getByTestId("diff-view-split").click();
    await expect(webviewPage.locator(".diff-split-row").first()).toBeVisible();
    // Two line-number gutters per row: the old side and the new side.
    await expect(
      webviewPage
        .locator(".diff-split-row")
        .first()
        .locator(".diff-line-number"),
    ).toHaveCount(2);
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-diff-split.webp",
    );
  });

  test("terminal pane mounts an embedded xterm.js terminal", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupSinglePane(injector);

    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-terminal").click();

    // TerminalPane lazily loads the terminal chunk, builds the xterm instance,
    // then asks the host to create a PTY. The pane instance tags its termId
    // with its paneId (term-<paneId>), so read it back from the create request.
    await injector.waitForMessage("desktopTerminalCreate");
    const creates = (await injector.getMessagesSentToExtension()).filter(
      (m) => m.command === "desktopTerminalCreate",
    );
    const termId = String(creates[creates.length - 1]?.termId ?? "term-main");
    await injector.simulateExtensionMessage("desktopTerminalData", {
      termId,
      data: "user@host:~/wave-agent$ ls -la\r\n",
    });

    await expect(webviewPage.getByTestId("terminal-pane")).toBeVisible();
    await expect(webviewPage.getByTestId("terminal-restart")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-terminal-pane.webp",
    );
  });
});
