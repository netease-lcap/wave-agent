import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop file pane (spec desktop-file-panel.md 文件面板): clicking a read tool's
// file path opens the read-only file panel with line numbers + content. The
// shared webview bundle must be rebuilt first (node esbuild.config.mjs).
const DIR_A = "/Users/dev/projects/wave-agent";
const FILE_PATH = `${DIR_A}/src/pages/login.tsx`;

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

const FILE_CONTENT = `import { useState } from "react";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await signIn({ email, password });
      navigate("/dashboard");
    } catch (err) {
      setError("登录失败，请检查邮箱与密码");
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit">登录</button>
    </form>
  );
}
`;

test.describe("Desktop file pane screenshots", () => {
  test("read tool path opens the file panel", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-fp-1", title: "修复登录页样式对齐" },
      {
        sessionId: "s-fp-2",
        title: "重构订单管理列表页",
        hasWorktree: true,
      },
      {
        sessionId: "s-fp-3",
        title: "审查表单校验边界",
        waitingConfirmation: true,
      },
    ]);
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
        "Read",
        JSON.stringify({ file_path: FILE_PATH }),
        FILE_CONTENT,
      ),
    ]);

    // Click the read tool's file path → the file panel opens on the right.
    await webviewPage.getByRole("button", { name: FILE_PATH }).click();
    await expect(webviewPage.getByTestId("file-pane")).toBeVisible();

    // Host replies with the file content (routed by paneId, single pane here).
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: FILE_PATH,
        host: "local",
        content: FILE_CONTENT,
        loading: false,
      },
    });
    await expect(
      webviewPage.getByTestId("file-pane").getByText("src/pages/login.tsx"),
    ).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-pane.webp",
    );
  });
});
