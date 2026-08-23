import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { READ_TOOL_NAME } from "wave-agent-sdk";
import { screenshotWebp } from "./utils/screenshot.js";

const DIR_A = "/Users/dev/projects/wave-agent";

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
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-panel-image.webp",
    );
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
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-panel-image-remote.webp",
    );
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
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-file-panel-code.webp",
    );
  });

  test("search bar finds and opens a file in the panel", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1280, height: 720 });
    await setupReadMessage(injector, `${DIR_A}/src/assets/login-banner.png`);
    await openFileFromMessage(webviewPage, injector);
    // Drop the openFile already consumed by opening the panel so the search's
    // openFile below is the next (only) one in the log.
    await injector.clearMessageLog();

    const searchInput = webviewPage.getByTestId("file-pane-search-input");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("ChatApp");

    // Focus fires a "" request; typing fires the debounced one — take the latest.
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

    await expect(
      webviewPage
        .locator(".suggestion-name")
        .filter({ hasText: "ChatApp.tsx" }),
    ).toBeVisible();
    // Directories are filtered out — the panel cannot display them.
    await expect(
      webviewPage.locator(".suggestion-name").filter({ hasText: "components" }),
    ).toHaveCount(0);

    await webviewPage
      .locator(".suggestion-item")
      .filter({ hasText: "ChatApp.tsx" })
      .click();

    await injector.waitForMessage("openFile");
    // waitForMessage resolves to a JSHandle; read the raw log for the payload.
    const sent = await injector.getMessagesSentToExtension();
    const openMsg = sent.filter((m) => m.command === "openFile").pop() as {
      path?: string;
    };
    expect(openMsg.path).toBe(targetPath);
    // The toolbar now shows the searched file (dropdown closed, search cleared).
    await expect(webviewPage.locator(".file-pane-path")).toHaveText(
      "src/components/ChatApp.tsx",
    );
    await expect(searchInput).toHaveValue("");

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
});
