import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { seedFileTree, type SeededTreeEntry } from "./fileTreeSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

// Desktop file pane (spec desktop-file-panel.md 文件面板): clicking a read tool's
// file path opens the read-only file panel with line numbers + content. The
// shared webview bundle must be rebuilt first (node esbuild.config.mjs).
const DIR_A = "/Users/dev/projects/wave-agent";
const FILE_PATH = `${DIR_A}/src/pages/login.tsx`;

/** The workdir as the panel's directory tree lists it (root + the two levels the
 *  opened files live in). Seeded because a demo has no host to answer the
 *  listings the tree asks for — see demo/fileTreeSeed.ts. */
const TREE: Record<string, SeededTreeEntry[]> = {
  [DIR_A]: [
    { name: "docs", type: "dir" },
    { name: "src", type: "dir" },
    { name: "package.json", type: "file" },
    { name: "README.md", type: "file" },
  ],
  [`${DIR_A}/src`]: [
    { name: "pages", type: "dir" },
    { name: "main.tsx", type: "file" },
  ],
  [`${DIR_A}/src/pages`]: [
    { name: "login.tsx", type: "file" },
    { name: "orders.tsx", type: "file" },
  ],
  [`${DIR_A}/docs`]: [{ name: "desktop.md", type: "file" }],
};

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
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

const MD_CONTENT = `# Wave Agent

Wave 是一个面向研发全流程的 AI 编码助手，支持 CLI、VS Code、JetBrains 与桌面端。

## 安装

\`\`\`bash
pnpm install
pnpm build
\`\`\`

## 快速开始

运行 \`pnpm wave\` 启动交互式终端界面。

## 贡献

欢迎提交 issue 与 pull request。
`;

test.describe("Desktop file pane screenshots", () => {
  test("closed file panel lists the conversation's files", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-fp-1", title: "修复登录页样式对齐" },
    ]);
    await injector.simulateExtensionMessage("setInitialState", initialState);
    // Three successful tool calls: the panel's list view is derived from them
    // (spec desktop-file-panel.md「文件面板列出当前对话的文件」).
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
      MockDataGenerator.createAssistantMessageWithTool(
        "我先看一下登录页组件的样式文件。",
        "Read",
        JSON.stringify({ file_path: "src/pages/login.tsx" }),
        FILE_CONTENT,
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "顺便把说明补上。",
        "Write",
        JSON.stringify({ file_path: "README.md" }),
        "File written",
      ),
      MockDataGenerator.createAssistantMessageWithTool(
        "订单页的表单校验也要改。",
        "Edit",
        JSON.stringify({ file_path: "src/pages/orders.tsx" }),
        "File edited",
      ),
    ]);

    // Open the (empty) file tab from the header toggle's empty state: with no
    // file open, the panel shows this conversation's files instead of a blank.
    await webviewPage.getByTestId("panel-toggle-btn").click();
    await webviewPage.getByTestId("panel-empty-item-file").click();
    const pane = webviewPage.getByTestId("file-pane");
    await expect(
      pane.getByTestId("file-pane-conversation-files"),
    ).toBeVisible();
    const rows = pane.getByTestId("file-pane-conversation-file-row");
    await expect(rows).toHaveCount(3);
    // Newest hit first.
    await expect(rows.first()).toContainText("orders.tsx");
    await seedFileTree(injector, TREE);
    await expect(
      pane.getByTestId("file-pane-tree").getByText("package.json"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-pane-conversation-files.webp",
    );

    // Clicking a row opens that file in the same tab (host replies below), and
    // the toolbar offers a way back to the list. Scoped to the list: the tree
    // on the left lists a `README.md` of its own.
    await pane
      .getByTestId("file-pane-conversation-files")
      .getByText("README.md")
      .click();
    // The reply is keyed by the path the panel asked for — the path the tool
    // recorded (`README.md`), which is what the real host echoes back. A reply
    // carrying some other spelling of the same file (`/Users/…/README.md`)
    // matches nothing on the open-file strip and is dropped (spec
    // desktop-file-panel.md「文件面板已打开文件的标签」).
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: "README.md",
        host: "local",
        content: MD_CONTENT,
        loading: false,
      },
    });
    await expect(pane.locator(".file-pane-markdown h2").first()).toBeVisible();
    await pane.getByTestId("file-pane-back-to-list").click();
    await expect(
      pane.getByTestId("file-pane-conversation-files"),
    ).toBeVisible();
  });

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
      // A second file the conversation touched: the markdown half of this test
      // opens it the same way (tool path → panel) to comment a rendered block.
      MockDataGenerator.createAssistantMessageWithTool(
        "顺手把 README 的安装说明补上。",
        "Write",
        JSON.stringify({ file_path: "README.md" }),
        "File written",
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
    // The tree lists the file's own folders, expanded down to it (a file that
    // opens inside the root expands its ancestors).
    await seedFileTree(injector, TREE);
    const tree = webviewPage.getByTestId("file-pane-tree");
    await expect(tree.getByText("README.md")).toBeVisible();
    await expect(tree.getByText("login.tsx")).toBeVisible();

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-pane.webp",
    );
    // Collapse the directory tree for the comment screenshots below. The code
    // column is as wide as the longest source line (`min-width: max-content`),
    // so with the tree taking ~200px the column — and with it the comment box,
    // which spans that column — runs past the panel's right edge: a real user
    // gets there by scrolling the pane sideways, a still image cannot. Hiding
    // the tree (a normal toolbar toggle) keeps the whole box, 取消/添加
    // included, in frame. The tree itself is what the shot above shows.
    await webviewPage.getByRole("button", { name: "隐藏文件树" }).click();

    // ── Inline line comment (same interaction as the diff pane) ──────
    // Right click the line → 「添加评论」 (spec desktop-file-panel.md
    // 「文件面板评论」). The entry is a gesture rather than a hover-revealed "+",
    // which is what leaves the line-number column flush against the left edge.
    // Line 12 is `      navigate("/dashboard");`; `file-pane-line-<n>` is the
    // source line number, so it identifies the line on its own.
    await webviewPage
      .getByTestId("file-pane-line-12")
      .click({ button: "right" });
    await webviewPage.getByTestId("code-comment-menu-add").click();
    await expect(webviewPage.getByTestId("line-comment-box")).toBeVisible();
    await webviewPage
      .getByTestId("line-comment-input")
      .fill("登录成功后应先回到用户原本要访问的页面，再兜底 /dashboard");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-comment.webp",
    );

    // Submitting appends the comment to the chat input — nothing is sent to
    // the agent and the pane keeps no trace of it, so several lines can be
    // commented before sending once.
    await webviewPage.getByTestId("line-comment-submit").click();
    await expect(webviewPage.getByTestId("message-input")).toContainText(
      "登录成功后应先回到用户原本要访问的页面",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-comment-input.webp",
    );

    // ── Markdown block comment ─────────────────────────────────────────
    // A rendered markdown file has no line numbers, so the same interaction
    // anchors to a block instead (spec desktop-panels.md「文件面板评论」场景 8).
    // Open README.md the same way as the code file above — its tool path — and
    // answer with the path the panel asked for (`README.md`, not the absolute
    // one): a reply is matched to an open file by that path.
    await webviewPage.getByRole("button", { name: "README.md" }).click();
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: "README.md",
        host: "local",
        content: MD_CONTENT,
        loading: false,
      },
    });
    await expect(
      webviewPage.locator(".file-pane-markdown h2").first(),
    ).toBeVisible();

    // The button only exists while a block is hovered, so hover first and click
    // after — Playwright's auto-hover cannot reveal an element that is not in
    // the DOM yet.
    await webviewPage.locator(".file-pane-markdown h2").first().hover();
    await webviewPage.getByTestId("md-block-comment-add").click();
    await expect(webviewPage.getByTestId("line-comment-box")).toBeVisible();
    await webviewPage
      .getByTestId("line-comment-input")
      .fill("安装这一节补一句：Node 版本要求 >= 22");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-md-comment.webp",
    );

    // Same no-trace semantics as line comments: the quote is the block's text,
    // there is no line number, and the box pushes the rest of the document down
    // rather than covering it.
    await webviewPage.getByTestId("line-comment-submit").click();
    await expect(webviewPage.getByTestId("message-input")).toContainText(
      "安装这一节补一句",
    );
  });

  // spec desktop-file-panel.md「文件面板内编辑与保存」场景 1：本地工作目录内的
  // 完整文件点「编辑」进入编辑态，正文换成带行号的 CodeMirror（desktop-only
  // editor.js chunk），工具条右端换成「取消」「保存」。
  test("edit mode in the file panel", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await seedSidebarSessions(injector, DIR_A, [
      { sessionId: "s-fp-1", title: "修复登录页样式对齐" },
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

    await webviewPage.getByRole("button", { name: FILE_PATH }).click();
    await expect(webviewPage.getByTestId("file-pane")).toBeVisible();
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: FILE_PATH,
        host: "local",
        content: FILE_CONTENT,
        contentHash: "demo-hash",
        editable: true,
        truncated: false,
        loading: false,
      },
    });

    await webviewPage.getByTestId("file-pane-edit").click();
    await expect(
      webviewPage.locator(".file-pane-editor .cm-content"),
    ).toBeVisible();
    await expect(webviewPage.getByTestId("file-pane-edit-save")).toBeVisible();
    await seedFileTree(injector, TREE);

    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-pane-edit.webp",
    );
  });
});
