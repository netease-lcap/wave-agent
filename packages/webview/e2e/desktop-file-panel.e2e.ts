import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { READ_TOOL_NAME } from "wave-agent-sdk";

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

// Shared setup: single-pane desktop layout with one conversation carrying a
// read-tool message whose path is clickable (FileToolHeader). Clicking the path
// opens the file panel with a loading stub and asks the host to read the file;
// each test then replies with desktopFileContent to fill the panel.
async function setupReadMessage(
  injector: MessageInjector,
  filePath: string,
  offset?: number,
  limit?: number,
) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("这个文件/图片帮我看看", "msg-u1"),
    MockDataGenerator.createAssistantMessageWithTool(
      "好的，我来读取这个文件。",
      READ_TOOL_NAME,
      JSON.stringify({
        file_path: filePath,
        ...(offset !== undefined ? { offset } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
      "读取完成",
    ),
  ]);
}

/** Click the read-tool path and wait for the host to be asked to open it. */
async function openFileFromMessage(
  page: import("@playwright/test").Page,
  injector: MessageInjector,
) {
  await page.locator(".write-tool-path").click();
  await injector.waitForMessage("openFile");
  await expect(page.getByTestId("file-pane")).toBeVisible();
}

/**
 * Generate a real PNG data URL inside the page context so the screenshot shows
 * an actually-rendered image (the fixed data: scheme), not a broken <img>.
 */
function generatePng(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, "#3b82f6");
    grad.addColorStop(0.55, "#8b5cf6");
    grad.addColorStop(1, "#ec4899");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Decorative translucent circles so the preview visibly renders.
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(360, 80, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(120, 220, 46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(240, 140, 58, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(240, 140, 92, -Math.PI * 0.8, Math.PI * 0.25);
    ctx.stroke();
    return canvas.toDataURL("image/png");
  });
}

/** The panel's <img> must have actually decoded the data URL (naturalWidth>0),
 *  not be a broken-image render — the point of the data: scheme fix. */
function expectImageDecoded(page: import("@playwright/test").Page) {
  return expect(page.locator(".file-pane-image"))
    .toHaveJSProperty("complete", true, { timeout: 3000 })
    .then(async () => {
      const naturalWidth = await page
        .locator(".file-pane-image")
        .evaluate((img: HTMLImageElement) => img.naturalWidth);
      expect(naturalWidth).toBeGreaterThan(0);
    });
}

/**
 * Answer one level of the panel's directory tree.
 *
 * The tree is lazy (spec desktop-file-panel.md「文件面板工作区目录树」场景 2): the
 * panel asks for the root when it opens and for a directory when it expands it.
 * Wait for that `desktopListDirectory` request and reply with the same `paneId`
 * — a pane instance only consumes messages tagged with its own id, so a
 * hard-coded pane id would silently fall on the floor and the tree would stay
 * empty.
 */
async function replyDirListing(
  page: import("@playwright/test").Page,
  injector: MessageInjector,
  path: string,
  entries: { name: string; type: "dir" | "file" }[],
) {
  const handle = await page.waitForFunction(
    (wanted) =>
      (
        window as unknown as {
          getTestMessages?: () => Record<string, unknown>[];
        }
      )
        .getTestMessages?.()
        .find(
          (m) => m.command === "desktopListDirectory" && m.path === wanted,
        ) ?? false,
    path,
  );
  const request = (await handle.jsonValue()) as { paneId?: string };
  await injector.simulateExtensionMessage("desktopDirEntries", {
    ...(request.paneId ? { paneId: request.paneId } : {}),
    path,
    entries,
    total: entries.length,
  });
}

test.describe("Desktop file panel", () => {
  test("local image previews inline in the panel", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const imagePath = `${DIR_A}/src/assets/login-banner.png`;
    await setupReadMessage(injector, imagePath);
    await openFileFromMessage(webviewPage, injector);

    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: imagePath,
        host: "local",
        loading: false,
        imageBase64: await generatePng(webviewPage),
      },
    });

    await expectImageDecoded(webviewPage);
  });

  test("remote images preview inline with the ssh host label", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    // A remote session shows the file's full remote path; the panel labels the
    // owning ssh host so the viewer's origin stays unambiguous.
    await setupReadMessage(injector, "/home/dev/app/src/assets/banner.png");
    await openFileFromMessage(webviewPage, injector);

    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: "/home/dev/app/src/assets/banner.png",
        host: "prod",
        loading: false,
        imageBase64: await generatePng(webviewPage),
      },
    });

    await expectImageDecoded(webviewPage);
    await expect(webviewPage.getByText("prod")).toBeVisible();
  });

  test("code files render highlighted lines with a jump range", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const codePath = `${DIR_A}/src/components/Login.tsx`;
    // read with offset/limit: the message path shows a ":13:17" suffix and the
    // panel highlights the corresponding line range (13–29).
    await setupReadMessage(injector, codePath, 13, 17);
    await openFileFromMessage(webviewPage, injector);
    await expect(
      webviewPage.getByText("src/components/Login.tsx:13:17"),
    ).toBeVisible();

    const code = [
      "import { useState } from 'react';",
      "",
      "interface LoginProps {",
      "  redirectTo?: string;",
      "}",
      "",
      "export function Login({ redirectTo }: LoginProps) {",
      "  // 表单提交前校验用户名与密码是否填写",
      "  const [user, setUser] = useState('');",
      "  const [pass, setPass] = useState('');",
      "  const [error, setError] = useState('');",
      "",
      "  async function handleSubmit(e: React.FormEvent) {",
      "    e.preventDefault();",
      "    if (!user || !pass) {",
      "      setError('请输入用户名和密码');",
      "      return;",
      "    }",
      "    const res = await fetch('/api/login', {",
      "      method: 'POST',",
      "      headers: { 'Content-Type': 'application/json' },",
      "      body: JSON.stringify({ user, pass }),",
      "    });",
      "    if (!res.ok) {",
      "      setError('登录失败，请检查用户名与密码');",
      "      return;",
      "    }",
      "    window.location.href = redirectTo ?? '/';",
      "  }",
      "",
      "  return (",
      '    <form onSubmit={handleSubmit} className="login-form">',
      '      <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="用户名" />',
      '      <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="密码" />',
      '      {error && <p className="login-error">{error}</p>}',
      '      <button type="submit">登录</button>',
      "    </form>",
      "  );",
      "}",
    ].join("\n");

    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: codePath,
        host: "local",
        loading: false,
        content: code,
        startLine: 13,
        endLine: 29,
        truncated: true,
        totalLines: 320,
      },
    });

    await expect(webviewPage.locator(".file-pane-code")).toBeVisible();
    await expect(
      webviewPage.locator(".file-pane-truncated-hint"),
    ).toBeVisible();
  });

  // spec desktop-file-panel.md「文件面板评论」场景 8：块评论按钮长在块左缘之外的
  // 空隙里，鼠标从块走到按钮要跨过一段「底下没有任何块」的 padding。那段路必须
  // 保住锚点，否则按钮在指针到达前就卸载了——真实鼠标永远点不到它。
  test("markdown block comment button survives the pointer moving onto it", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const mdPath = `${DIR_A}/README.md`;
    await setupReadMessage(injector, mdPath);
    await openFileFromMessage(webviewPage, injector);
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: mdPath,
        host: "local",
        loading: false,
        content: "# 标题\n\n正文段落，用来放一条评论。\n",
      },
    });

    const paragraph = webviewPage.locator(".file-pane-markdown p").first();
    await paragraph.hover();
    const button = webviewPage.getByTestId("md-block-comment-add");
    await expect(button).toBeVisible();

    // Real mouse path, in steps: leave the text, cross the gutter, land on the
    // button. The bug showed up as "element was detached from the DOM" here.
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    await webviewPage.mouse.move(
      box!.x + box!.width / 2,
      box!.y + box!.height / 2,
      { steps: 10 },
    );
    await expect(button).toBeVisible();

    await button.click();
    await expect(webviewPage.getByTestId("line-comment-box")).toBeVisible();
    await webviewPage
      .getByTestId("line-comment-input")
      .fill("这段补一句为什么");
    await webviewPage.getByTestId("line-comment-submit").click();
    // The quote is the hovered block's rendered text, no line number.
    await expect(webviewPage.getByTestId("message-input")).toContainText(
      "正文段落，用来放一条评论",
    );
  });

  // spec desktop-file-panel.md「文件面板工作区目录树 / 按名字查找」（场景 1、2、6
  // 与独立测试第 4 句）：面板里只有一个查找入口 —— 目录树顶部的筛选框。它复用
  // 输入框 `@` 的文件搜索数据流（requestFileSuggestions → fileSuggestionsResponse），
  // 命中后树区域换成结果列表，点一条即打开；清空输入回到目录树且展开态不变。
  test("tree filter finds and opens a file in the panel", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupReadMessage(injector, `${DIR_A}/src/assets/login-banner.png`);
    await openFileFromMessage(webviewPage, injector);

    // 树是懒加载的：打开面板请求根这一层，展开目录请求那一层。回包必须带上
    // 请求里的 paneId —— 面板实例只收打了自己标签的消息（`useHostMessage` 的
    // paneId 过滤），硬编码一个 id 会随布局变。
    await replyDirListing(webviewPage, injector, DIR_A, [
      { name: "src", type: "dir" },
      { name: "README.md", type: "file" },
    ]);
    await expect(webviewPage.getByTestId("file-tree-rows")).toBeVisible();
    // 打开文件时树的祖先会自己展开（场景 6 前半段）：截图里的那个文件就在
    // src/assets 下，所以 src 通常已经是展开的 —— 只在它被折叠时才点开。
    const srcRow = webviewPage.locator(`[data-tree-path="${DIR_A}/src"]`);
    if ((await srcRow.getAttribute("aria-expanded")) !== "true") {
      await srcRow.click();
    }
    await replyDirListing(webviewPage, injector, `${DIR_A}/src`, [
      { name: "assets", type: "dir" },
      { name: "components", type: "dir" },
    ]);
    await expect(
      webviewPage.locator(`[data-tree-path="${DIR_A}/src/components"]`),
    ).toBeVisible();

    // Drop the openFile already consumed by opening the panel (and the tree's
    // listing requests) so the filter's openFile below is the only one in the log.
    await injector.clearMessageLog();

    const searchInput = webviewPage.getByTestId("file-tree-filter");
    await searchInput.fill("ChatApp");

    // Typing fires the debounced request — that is the one the reply must answer.
    const requestId = await injector.waitForFileSuggestionRequest();

    const targetPath = `${DIR_A}/src/components/ChatApp.tsx`;
    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      suggestions: [
        {
          path: targetPath,
          relativePath: "src/components/ChatApp.tsx",
          name: "ChatApp.tsx",
          extension: "tsx",
          icon: "codicon-file",
          isDirectory: false,
        },
        {
          path: `${DIR_A}/src/components`,
          relativePath: "src/components",
          name: "components",
          extension: "",
          icon: "codicon-folder",
          isDirectory: true,
        },
      ],
      filterText: "ChatApp",
      requestId,
    });

    // 树区域换成结果列表：命中一条文件；目录被丢掉了 —— 面板展示不了目录。
    await expect(
      webviewPage.getByTestId("file-tree-filter-results"),
    ).toBeVisible();
    const results = webviewPage.getByTestId("file-tree-filter-result");
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText("ChatApp.tsx");
    // 同名文件靠所在目录区分。
    await expect(results.first()).toContainText("src/components");
    // 目录树本身此刻不在屏上（结果列表接管了这一列）。
    await expect(webviewPage.getByTestId("file-tree-rows")).toHaveCount(0);

    await results.first().click();

    await injector.waitForMessage("openFile");
    // waitForMessage resolves to a JSHandle; read the raw log for the payload.
    const sent = await injector.getMessagesSentToExtension();
    const openMsg = sent.filter((m) => m.command === "openFile").pop() as {
      path?: string;
    };
    expect(openMsg.path).toBe(targetPath);
    // 选中即清空筛选：结果列表退场，目录树回来、src 仍是展开的（场景 3）。
    await expect(searchInput).toHaveValue("");
    await expect(webviewPage.getByTestId("file-tree-rows")).toBeVisible();
    await expect(
      webviewPage.locator(`[data-tree-path="${DIR_A}/src/components"]`),
    ).toBeVisible();
    // The toolbar now shows the searched file.
    await expect(webviewPage.locator(".file-pane-path")).toHaveText(
      "src/components/ChatApp.tsx",
    );

    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: targetPath,
        host: "local",
        loading: false,
        content:
          "import React from 'react';\n\nexport function ChatApp() {\n  return <div>chat</div>;\n}\n",
      },
    });
    await expect(webviewPage.locator(".file-pane-code")).toBeVisible();
  });

  // spec desktop-file-panel.md「文件面板内编辑与保存」场景 1–3：编辑按钮只在
  // 「整份文件 + 工作目录内」出现；点进去是真的 CodeMirror chunk（editor.js，
  // 由 harness 按 dist 目录按需伺服），Mod+S 发出一次带 hash 的保存请求。
  test("edit mode mounts the CodeMirror chunk and saves with the read hash", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const codePath = `${DIR_A}/src/components/Login.tsx`;
    await setupReadMessage(injector, codePath);
    await openFileFromMessage(webviewPage, injector);

    const content = "export const alpha = 1;\n";
    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: codePath,
        host: "local",
        loading: false,
        content,
        contentHash: "hash-1",
        editable: true,
        truncated: false,
        totalLines: 1,
      },
    });
    await expect(webviewPage.locator(".file-pane-code")).toBeVisible();

    await webviewPage.getByTestId("file-pane-edit").click();

    // 真 chunk：CodeMirror 的内容区 + 行号 gutter，且草稿就是文件内容。
    const editor = webviewPage.locator(".file-pane-editor .cm-content");
    await expect(editor).toBeVisible();
    await expect(webviewPage.locator(".cm-lineNumbers")).toBeVisible();
    await expect(editor).toContainText("alpha = 1");

    await editor.click();
    await webviewPage.keyboard.press("ControlOrMeta+a");
    await webviewPage.keyboard.type("export const beta = 2;");
    await webviewPage.keyboard.press("ControlOrMeta+s");

    await injector.waitForMessage("desktopSaveFile");
    const sent = await injector.getMessagesSentToExtension();
    const save = sent.filter((m) => m.command === "desktopSaveFile").pop() as {
      path?: string;
      content?: string;
      contentHash?: string;
      requestId?: string;
    };
    expect(save.path).toBe(codePath);
    expect(save.content).toBe("export const beta = 2;");
    // 乐观并发校验的基底就是面板读到那份内容的 hash。
    expect(save.contentHash).toBe("hash-1");
    expect(save.requestId).toBeTruthy();

    // 宿主回 saved → 退出编辑态、回到只读视图，并提示已保存。
    await injector.simulateExtensionMessage("desktopFileSaveResult", {
      paneId: "pane-1",
      requestId: save.requestId,
      status: "saved",
      contentHash: "hash-2",
    });
    await expect(webviewPage.locator(".cm-content")).toHaveCount(0);
    await expect(webviewPage.locator(".file-pane-code")).toBeVisible();
    await expect(webviewPage.getByText("已保存")).toBeVisible();
  });

  // 场景 2：截断的文件不给编辑入口——写回半份内容会把文件毁掉。
  test("a truncated file offers no edit affordance", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const logPath = `${DIR_A}/logs/big.log`;
    await setupReadMessage(injector, logPath);
    await openFileFromMessage(webviewPage, injector);

    await injector.simulateExtensionMessage("desktopFileContent", {
      fileView: {
        path: logPath,
        host: "local",
        loading: false,
        content: "line 1\nline 2\n",
        truncated: true,
        totalLines: 2001,
      },
    });

    await expect(
      webviewPage.locator(".file-pane-truncated-hint"),
    ).toBeVisible();
    await expect(webviewPage.getByTestId("file-pane-edit")).toHaveCount(0);
  });

  // 场景 4：同名文件的标签只追加「最短可区分目录后缀」，整条路径不进标签
  // （设计师反馈的正是绝对路径被 200px 上限截断成全同的前缀）。
  test("duplicate names get a short directory suffix, never a path", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    const srcIndex = `${DIR_A}/src/index.ts`;
    const libIndex = `${DIR_A}/lib/index.ts`;
    const unique = `${DIR_A}/README.md`;

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("看几个文件", "msg-u1"),
      ...[srcIndex, libIndex, unique].map((filePath, index) =>
        MockDataGenerator.createAssistantMessageWithTool(
          `第 ${index + 1} 个`,
          READ_TOOL_NAME,
          JSON.stringify({ file_path: filePath }),
          "读取完成",
        ),
      ),
    ]);

    const pathLinks = webviewPage.locator(".write-tool-path");
    for (const [index, filePath] of [srcIndex, libIndex, unique].entries()) {
      await pathLinks.nth(index).click();
      await injector.simulateExtensionMessage("desktopFileContent", {
        fileView: {
          path: filePath,
          host: "local",
          loading: false,
          content: `// ${filePath}\n`,
        },
      });
      await expect(webviewPage.getByTestId("file-tab")).toHaveCount(index + 1);
    }

    const tabs = webviewPage.getByTestId("file-tab");
    // 读屏念作「index.ts, src」：名字 + 灰色小字后缀，同行。
    await expect(tabs.nth(0)).toContainText("index.ts, src");
    await expect(tabs.nth(1)).toContainText("index.ts, lib");
    // 唯一文件名不加后缀；绝对路径一个字符都不进标签。
    await expect(tabs.nth(2)).toHaveText("README.md");
    await expect(tabs.nth(0)).not.toContainText(DIR_A);
    // 悬浮给相对路径（不是绝对路径）。
    await expect(tabs.nth(0)).toHaveAttribute("title", "src/index.ts");
  });
});
