/**
 * 桌面端文件面板（spec `desktop-file-panel.md`）。
 *
 * 迁移自 `e2e/desktop-file-panel.e2e.ts`。原文只说「见 spec」，这里按用例把契约
 * 写清：面板是右侧的只读查看器 + 工作区目录树 + 标签条，读文件走
 * `openFile` → `desktopFileContent` 往返，工作区目录树按需 `desktopListDirectory`
 * → `desktopDirEntries`，写回走 `desktopSaveFile` → `desktopFileSaveResult`。
 *
 * 本套件跑在真 Chromium 里：CodeMirror 的 `.cm-line` / `.cm-scroller`、真实
 * `Ctrl+A`/`Ctrl+C`、真实鼠标路径都能量。宿主档由 `desktopHarness` 打开
 * （`data-host="desktop"` + host-desktop.css）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { READ_TOOL_NAME } from "wave-agent-sdk/constants";
import { MockDataGenerator } from "../fixtures/mockData";
import { openFileInDesktopPanel, sendCommand } from "./test-utils";
import {
  bootDesktop,
  copiedText,
  installClipboardProbe,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
  toolPathLinks,
  waitForSelector,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 点消息里的路径把文件打开到面板；`fileView` 就是宿主回的那份内容。 */
function openFile(filePath: string, fileView: Record<string, unknown>) {
  openFileInDesktopPanel(filePath, fileView);
}

/**
 * 点第 `index` 个工具路径链接打开文件。带 `:13:17` 后缀的路径按文件名对不上
 * （链接文本是 `src/components/Login.tsx:13:17`），所以按序号点。
 */
function openFileByIndex(
  index: number,
  filePath: string,
  fileView: Record<string, unknown>,
) {
  const link = toolPathLinks()[index];
  expect(link).toBeTruthy();
  fireEvent.click(link);
  sendCommand("desktopFileContent", {
    fileView: { path: filePath, host: "local", content: "", ...fileView },
  });
}

/** 一条「我去读这个文件」的对话，路径可点。 */
function readMessage(
  filePath: string,
  options: { offset?: number; limit?: number } = {},
) {
  return MockDataGenerator.createAssistantMessageWithTool(
    "好的，我来读取这个文件。",
    READ_TOOL_NAME,
    JSON.stringify({
      file_path: filePath,
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    }),
    "读取完成",
  );
}

/** 同一条读取对话，正文可换（多个文件时用来说明第几个）。 */
function readMessageFor(content: string, filePath: string) {
  return MockDataGenerator.createAssistantMessageWithTool(
    content,
    READ_TOOL_NAME,
    JSON.stringify({ file_path: filePath }),
    "读取完成",
  );
}

function bootWithReadMessage(
  filePath: string,
  options: { offset?: number; limit?: number } = {},
) {
  const result = renderDesktopApp();
  bootDesktop({
    workdir: DIR_A,
    messages: [
      MockDataGenerator.createUserMessage("这个文件/图片帮我看看", "msg-u1"),
      readMessage(filePath, options),
    ],
  });
  return result;
}

/** 真 PNG data URL：让面板里的 <img> 真解码出图，而不是坏图。 */
function pngDataUrl(): string {
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
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath();
  ctx.arc(360, 80, 70, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(120, 220, 46, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL("image/png");
}

/**
 * 面板的 <img> 必须真的解码了 data URL（`naturalWidth > 0`），不是坏图 ——
 * 这正是 data: 方案要保住的东西。
 */
async function expectImageDecoded() {
  const img = await waitForSelector(".file-pane-image");
  await expect
    .poll(() => (img as HTMLImageElement).complete, { timeout: 3000 })
    .toBe(true);
  expect((img as HTMLImageElement).naturalWidth).toBeGreaterThan(0);
}

const box = (selector: string) =>
  document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();

/** 树行（`[data-tree-path]`）；不存在时返回 null。 */
const treeRow = (path: string) =>
  document.querySelector<HTMLElement>(`[data-tree-path="${path}"]`);

/** 面板发出去的某条命令（按发送顺序）。 */
const sentWith = (
  vscode: { postMessage: unknown },
  command: string,
  match?: (message: Record<string, unknown>) => boolean,
) =>
  sentCommands(vscode).filter(
    (message) => message.command === command && (!match || match(message)),
  );

/**
 * 目录树是懒加载的：面板按需发 `desktopListDirectory`，测试只能应答它这一次
 * 请求（回包不带 paneId 时 `routeHostMessage` 会打上聚焦分屏的标签，与真机的
 * paneId 过滤同一条路）。
 */
async function replyDirListing(
  vscode: { postMessage: unknown },
  path: string,
  entries: { name: string; type: "dir" | "file" }[],
) {
  await expect
    .poll(
      () =>
        sentWith(vscode, "desktopListDirectory", (m) => m.path === path).length,
      { timeout: 4000 },
    )
    .toBeGreaterThan(0);
  sendCommand("desktopDirEntries", { path, entries, total: entries.length });
}

/** 元素整个落在视口里（对齐 Playwright 的 `toBeInViewport`）。 */
function inViewport(el: Element) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth
  );
}

/** 屏上能找到「文字恰好是这段」的元素（toast / 提示文案）。 */
const hasExactText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("div, span, p")).some(
    (el) => {
      if ((el.textContent ?? "").trim() !== text) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
  );

/** 屏上某个元素里有这段文字（原文很多断言是 Playwright 的子串匹配）。 */
const hasText = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("div, span, p")).some(
    (el) => (el.textContent ?? "").includes(text),
  );

describe("Desktop file panel", () => {
  it("local image previews inline in the panel", async () => {
    await page.viewport(1280, 720);
    const imagePath = `${DIR_A}/src/assets/login-banner.png`;
    bootWithReadMessage(imagePath);

    openFile(imagePath, {
      loading: false,
      imageBase64: pngDataUrl(),
    });

    await expectImageDecoded();
  });

  it("remote images preview inline with the ssh host label", async () => {
    await page.viewport(1280, 720);
    // A remote session shows the file's full remote path; the panel labels the
    // owning ssh host so the viewer's origin stays unambiguous.
    bootWithReadMessage("/home/dev/app/src/assets/banner.png");

    openFile("/home/dev/app/src/assets/banner.png", {
      host: "prod",
      loading: false,
      imageBase64: pngDataUrl(),
    });

    await expectImageDecoded();
    expect(isVisible(".file-pane-image")).toBe(true);
    // 宿主名在面板上可见（开着这张图时不至于分不清读的是哪台机器）。
    const hostLabel = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        ".file-pane *:not(script):not(style)",
      ),
    ).find((el) => (el.textContent ?? "").trim() === "prod");
    expect(hostLabel).toBeTruthy();
  });

  it("code files render highlighted lines with a jump range", async () => {
    await page.viewport(1280, 720);
    const codePath = `${DIR_A}/src/components/Login.tsx`;
    // read with offset/limit: the message path shows a ":13:17" suffix and the
    // panel highlights the corresponding line range (13–29).
    bootWithReadMessage(codePath, { offset: 13, limit: 17 });

    openFileByIndex(0, codePath, {
      loading: false,
      startLine: 13,
      endLine: 29,
      truncated: true,
      totalLines: 320,
      content: Array.from({ length: 60 }, (_, i) =>
        i === 12
          ? "async function handleSubmit(e: React.FormEvent) {"
          : `const line${i + 1} = ${i + 1};`,
      ).join("\n"),
    });

    await waitForSelector(".file-pane-code .cm-line");

    // 消息里的路径带上跳跃区间（读的时候传了 offset/limit）。原用例写的是
    // `getByText("src/components/Login.tsx:13:17")`，Playwright 默认子串匹配，
    // 命中的是链接里绝对路径的尾段 —— 这里锁同一件事。
    await expect
      .poll(() => toolPathLinks()[0]?.textContent ?? "")
      .toContain("src/components/Login.tsx:13:17");
    expect(isVisible(".write-tool-path")).toBe(true);

    // 截断说明是面板底部一行次要色小字（对齐 Claude 桌面端文件查看器），不报行数、
    // 不涂底色、也不在正文顶部——正文高度因此一点都不被它挤走。
    const hint = await waitForSelector(".file-pane-truncated-hint");
    expect(hint.textContent).toBe("文件较大，末尾内容可能缺失");
    expect(hint.textContent).not.toContain("320"); // 不报总行数
    const hintBox = hint.getBoundingClientRect();
    const codeBox = box(".file-pane-code");
    expect(hintBox.height).toBeLessThan(32); // 一行字，不是横幅
    expect(hintBox.y).toBeGreaterThanOrEqual(codeBox.y + codeBox.height - 1); // 在正文之下
    expect(getComputedStyle(hint).backgroundColor).toBe("rgba(0, 0, 0, 0)"); // 脚注没有底色

    // 跳跃区间是 17 行的淡底色带子；它只铺正文列，不进行号单元格。
    const bandCount = () =>
      document.querySelectorAll(".cm-line.file-pane-line--active").length;
    await expect.poll(bandCount).toBe(17); // startLine 13 → endLine 29
    expect(
      document.querySelectorAll(".cm-gutters .file-pane-line--active").length,
    ).toBe(0);

    // 带子和选区不同屏：全选后带子整体撤掉，再点回正文（落下光标）它就回来。
    const content = await waitForSelector(".cm-content");
    await userEvent.click(content);
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
    await expect.poll(bandCount).toBe(0);
    await userEvent.click(content);
    await expect.poll(bandCount).toBe(17);
  });

  // spec desktop-file-panel.md「文件面板只读查看器的选区与全选」场景 1：客户反馈
  // 的那条——只读正文以前是一堆普通 DOM 行，`Ctrl+A` 走整页选区，把工具条路径、
  // 标签名、截断提示一起圈进去。这里在真 CodeMirror 上按一次真实快捷键。
  it("select-all stays inside the file, not the panel chrome", async () => {
    await page.viewport(1280, 720);
    const codePath = `${DIR_A}/src/app.ts`;
    bootWithReadMessage(codePath);
    openFile(codePath, {
      loading: false,
      content: "const a = 1;\nconst b = 2;\n",
      truncated: true,
      totalLines: 9,
    });

    const viewer = await waitForSelector('[data-testid="file-pane-viewer"]');
    await expect.poll(() => viewer.textContent ?? "").toContain("const b = 2;");
    // 焦点在代码区里，才是在「读这份文件」的上下文里按全选。
    await userEvent.click(await waitForSelector(".cm-content"));
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");

    const selected = window.getSelection()?.toString() ?? "";
    // 选区恰好是文件内容：行号在 gutter 里，路径/标签名/截断提示都不进来。
    expect(selected).toBe("const a = 1;\nconst b = 2;");
    expect(selected).not.toContain("src/app.ts");
    expect(selected).not.toContain("app.ts");
    expect(selected).not.toContain("末尾内容可能缺失"); // 截断说明在滚动区之外
  });

  // 长文件里 CodeMirror 只渲染视口内的行，`window.getSelection()` 因此只报得出
  // **已渲染**那部分；用户真正拿到的文本来自复制事件（编辑器按自己的文档序列化
  // 整段选区）。这条守的是「全选 + 复制 = 整份文件」这个可交付口径，而不是 DOM
  // 选区字符串。
  it("select-all + copy yields the whole file, not just the rendered lines", async () => {
    await page.viewport(1280, 720);
    const codePath = `${DIR_A}/src/big.ts`;
    bootWithReadMessage(codePath);
    const code = Array.from(
      { length: 200 },
      (_, i) => `const v${i + 1} = ${i + 1};`,
    ).join("\n");
    openFile(codePath, { loading: false, content: `${code}\n` });

    // 复制探针：读复制事件里已经写好的 clipboardData（编辑器在冒泡之前填好），
    // 这就是用户按 Ctrl+C 拿到的东西。
    const scope = window as unknown as { __copied?: string | null };
    scope.__copied = null;
    document.addEventListener("copy", (event) => {
      scope.__copied =
        (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
      event.preventDefault();
    });

    const viewer = await waitForSelector('[data-testid="file-pane-viewer"]');
    await expect
      .poll(() => viewer.textContent ?? "")
      .toContain("const v1 = 1;");
    await userEvent.click(await waitForSelector(".cm-content"));
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
    await userEvent.keyboard("{ControlOrMeta>}c{/ControlOrMeta}");

    // 先证明这条用例确实落在「DOM 里只有一部分行」的情形上，否则它什么也没守住。
    await expect
      .poll(() => document.querySelectorAll(".cm-line").length)
      .toBeGreaterThan(0);
    expect(document.querySelectorAll(".cm-line").length).toBeLessThan(200);
    expect(scope.__copied).toBe(code);
  });

  // spec desktop-file-panel.md「文件面板评论」场景 8：块评论按钮长在块左缘之外的
  // 空隙里，鼠标从块走到按钮要跨过一段「底下没有任何块」的 padding。那段路必须
  // 保住锚点，否则按钮在指针到达前就卸载了——真实鼠标永远点不到它。
  it("markdown block comment button survives the pointer moving onto it", async () => {
    await page.viewport(1280, 720);
    const mdPath = `${DIR_A}/README.md`;
    bootWithReadMessage(mdPath);
    openFile(mdPath, {
      loading: false,
      content: "# 标题\n\n正文段落，用来放一条评论。\n",
    });

    const paragraph = await waitForSelector(".file-pane-markdown p");
    await userEvent.hover(paragraph);
    await expect
      .poll(() => isVisible('[data-testid="md-block-comment-add"]'))
      .toBe(true);

    // 真实鼠标路径：指针从正文块移到按钮上。两者之间是一段「底下没有任何块」的
    // padding —— 按钮必须在那段路上活下来，否则这一跳会落在已经卸载的节点上
    // （错误是 element detached），真实鼠标永远点不到它。
    await userEvent.hover(
      await waitForSelector('[data-testid="md-block-comment-add"]'),
    );
    expect(isVisible('[data-testid="md-block-comment-add"]')).toBe(true);

    await userEvent.click(screen.getByTestId("md-block-comment-add"));
    await expect
      .poll(() => isVisible('[data-testid="line-comment-box"]'))
      .toBe(true);
    const input = await waitForSelector('[data-testid="line-comment-input"]');
    await userEvent.fill(input as HTMLInputElement, "这段补一句为什么");
    await userEvent.click(screen.getByTestId("line-comment-submit"));
    // The quote is the hovered block's rendered text, no line number.
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="message-input"]')
            ?.textContent ?? "",
      )
      .toContain("正文段落，用来放一条评论");
  });

  // spec desktop-file-panel.md「文件面板工作区目录树 / 按名字查找」（场景 1、2、6
  // 与独立测试第 4 句）：面板里只有一个查找入口 —— 目录树顶部的筛选框。它复用
  // 输入框 `@` 的文件搜索数据流（requestFileSuggestions → fileSuggestionsResponse），
  // 命中后树区域换成结果列表，点一条即打开；清空输入回到目录树且展开态不变。
  it("tree filter finds and opens a file in the panel", async () => {
    await page.viewport(1280, 720);
    const imagePath = `${DIR_A}/src/assets/login-banner.png`;
    const { vscode } = bootWithReadMessage(imagePath);
    // 先只打开面板，不回内容：树根这一层的请求在面板打开时就发了。
    fireEvent.click(toolPathLinks()[0]);
    await expect.poll(() => isVisible('[data-testid="file-pane"]')).toBe(true);

    await replyDirListing(vscode, DIR_A, [
      { name: "src", type: "dir" },
      { name: "README.md", type: "file" },
    ]);
    await expect
      .poll(() => isVisible('[data-testid="file-tree-rows"]'))
      .toBe(true);
    // 打开文件时树的祖先会自己展开（场景 6 前半段）：这个文件在 src/assets 下，
    // 所以 src 通常已经展开 —— 只在它被折叠时才点开。
    const srcRow = treeRow(`${DIR_A}/src`)!;
    if (srcRow.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(srcRow);
    }
    await replyDirListing(vscode, `${DIR_A}/src`, [
      { name: "assets", type: "dir" },
      { name: "components", type: "dir" },
    ]);
    await expect
      .poll(() => isVisible(`[data-tree-path="${DIR_A}/src/components"]`))
      .toBe(true);

    const searchInput = screen.getByTestId(
      "file-tree-filter",
    ) as HTMLInputElement;
    await userEvent.fill(searchInput, "ChatApp");

    // 输入触发防抖后的这次请求，回包必须带上它的 requestId。
    await expect
      .poll(
        () =>
          sentWith(
            vscode,
            "requestFileSuggestions",
            (m) => m.filterText === "ChatApp",
          ).length,
        { timeout: 4000 },
      )
      .toBeGreaterThan(0);
    const request = sentWith(
      vscode,
      "requestFileSuggestions",
      (m) => m.filterText === "ChatApp",
    ).pop()!;

    const targetPath = `${DIR_A}/src/components/ChatApp.tsx`;
    sendCommand("fileSuggestionsResponse", {
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
      requestId: request.requestId,
    });

    // 树区域换成结果列表：命中一条文件；目录被丢掉了 —— 面板展示不了目录。
    await expect
      .poll(() => isVisible('[data-testid="file-tree-filter-results"]'))
      .toBe(true);
    const results = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="file-tree-filter-result"]',
        ),
      );
    expect(results()).toHaveLength(1);
    // 同名文件靠所在目录区分。
    expect(results()[0].textContent).toContain("ChatApp.tsx");
    expect(results()[0].textContent).toContain("src/components");
    // 目录树本身此刻不在屏上（结果列表接管了这一列）。
    expect(
      document.querySelectorAll('[data-testid="file-tree-rows"]').length,
    ).toBe(0);

    await userEvent.click(results()[0]);

    await expect
      .poll(() => sentWith(vscode, "openFile").length, { timeout: 4000 })
      .toBeGreaterThan(0);
    const openMsg = sentWith(vscode, "openFile").pop()!;
    expect(openMsg.path).toBe(targetPath);
    // 选中即清空筛选：结果列表退场，目录树回来、src 仍是展开的（场景 3）。
    await expect.poll(() => searchInput.value).toBe("");
    await expect
      .poll(() => isVisible('[data-testid="file-tree-rows"]'))
      .toBe(true);
    await expect
      .poll(() => isVisible(`[data-tree-path="${DIR_A}/src/components"]`))
      .toBe(true);
    // 工具条里现在是刚查出来的这个文件。
    await expect
      .poll(() => document.querySelector(".file-pane-path")?.textContent)
      .toBe("src/components/ChatApp.tsx");

    sendCommand("desktopFileContent", {
      fileView: {
        path: targetPath,
        host: "local",
        loading: false,
        content:
          "import React from 'react';\n\nexport function ChatApp() {\n  return <div>chat</div>;\n}\n",
      },
    });
    await expect.poll(() => isVisible(".file-pane-code")).toBe(true);
  });

  // spec desktop-file-panel.md「文件面板工作区目录树」场景 8：工具栏那颗「在文件树上
  // 显示」要真的把行带回来并**亮一下** —— 行的稳态本来就是选中态，没有那次高亮时
  // 「本来就看得见」与「刚刚定位过去」在画面上完全一样。
  it("reveal in tree expands the row back and flashes it once", async () => {
    await page.viewport(1280, 720);
    const filePath = `${DIR_A}/src/components/ChatApp.tsx`;
    const { vscode } = bootWithReadMessage(filePath);
    openFile(filePath, {
      loading: false,
      content: "export const alpha = 1;\n",
    });

    await replyDirListing(vscode, DIR_A, [{ name: "src", type: "dir" }]);
    const srcRow = treeRow(`${DIR_A}/src`)!;
    if (srcRow.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(srcRow);
    }
    await replyDirListing(vscode, `${DIR_A}/src`, [
      { name: "components", type: "dir" },
    ]);
    const componentsRow = treeRow(`${DIR_A}/src/components`)!;
    if (componentsRow.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(componentsRow);
    }
    await replyDirListing(vscode, `${DIR_A}/src/components`, [
      { name: "ChatApp.tsx", type: "file" },
    ]);
    await expect
      .poll(() =>
        (treeRow(filePath)?.className ?? "").includes("file-tree-row--active"),
      )
      .toBe(true);

    // 把祖先折叠起来：行从画面上消失，此时点「在文件树中显示」才有事可做。
    fireEvent.click(srcRow);
    await expect.poll(() => treeRow(filePath)).toBeNull();

    await userEvent.click(screen.getByTestId("file-pane-reveal-in-tree"));
    await expect
      .poll(
        () =>
          (treeRow(filePath)?.className ?? "").includes(
            "file-tree-row--revealed",
          ),
        { timeout: 4000 },
      )
      .toBe(true);
    expect(inViewport(treeRow(filePath)!)).toBe(true);
    // 高亮自己退场（组件 1.2s 后摘类名）——它是一次提示，不是第二个选中态。
    await expect
      .poll(
        () =>
          (treeRow(filePath)?.className ?? "").includes(
            "file-tree-row--revealed",
          ),
        { timeout: 4000, interval: 100 },
      )
      .toBe(false);
    expect(treeRow(filePath)!.className).toContain("file-tree-row--active");
  });

  // 场景 15：工作根之外的文件（/tmp 里的临时图）在树里永远没有那一行 ——
  // 与其给一个点了毫无反应的按钮，不如不给。
  it("a file outside the workspace offers no reveal-in-tree action", async () => {
    await page.viewport(1280, 720);
    const imagePath = "/tmp/timeline-done.png";
    bootWithReadMessage(imagePath);
    openFile(imagePath, { loading: false, imageBase64: pngDataUrl() });
    await expectImageDecoded();

    expect(
      document.querySelectorAll('[data-testid="file-pane-reveal-in-tree"]')
        .length,
    ).toBe(0);
    // 树本身照常在（只是这个文件不在它里面），文件也照常能看。
    expect(isVisible('[data-testid="file-pane-tree-toggle"]')).toBe(true);
    expect(isVisible('[data-testid="file-copy-path"]')).toBe(true);
  });

  // spec desktop-file-panel.md「文件面板内编辑与保存」场景 1–3：编辑按钮只在
  // 「整份文件 + 工作目录内」出现；点进去是真的 CodeMirror 编辑器，Mod+S 发出
  // 一次带 hash 的保存请求。
  it("edit mode mounts the CodeMirror chunk and saves with the read hash", async () => {
    await page.viewport(1280, 720);
    const codePath = `${DIR_A}/src/components/Login.tsx`;
    const { vscode } = bootWithReadMessage(codePath);
    openFile(codePath, {
      loading: false,
      content: "export const alpha = 1;\n",
      contentHash: "hash-1",
      editable: true,
      truncated: false,
      totalLines: 1,
    });
    await expect.poll(() => isVisible(".file-pane-code")).toBe(true);

    await userEvent.click(screen.getByTestId("file-pane-edit"));

    // 真 CodeMirror：内容区 + 行号 gutter，且草稿就是文件内容。
    await expect
      .poll(() => isVisible(".file-pane-editor .cm-content"))
      .toBe(true);
    expect(isVisible(".cm-lineNumbers")).toBe(true);
    const editor = await waitForSelector(".file-pane-editor .cm-content");
    expect(editor.textContent).toContain("alpha = 1");

    await userEvent.click(editor);
    await userEvent.keyboard("{ControlOrMeta>}a{/ControlOrMeta}");
    await userEvent.keyboard("export const beta = 2;");
    await userEvent.keyboard("{ControlOrMeta>}s{/ControlOrMeta}");

    await expect
      .poll(() => sentWith(vscode, "desktopSaveFile").length, { timeout: 4000 })
      .toBeGreaterThan(0);
    const save = sentWith(vscode, "desktopSaveFile").pop()!;
    expect(save.path).toBe(codePath);
    expect(save.content).toBe("export const beta = 2;");
    // 乐观并发校验的基底就是面板读到那份内容的 hash。
    expect(save.contentHash).toBe("hash-1");
    expect(save.requestId).toBeTruthy();

    // 宿主回 saved → 退出编辑态、回到只读视图（同一个 CodeMirror 的只读面，所以
    // 「编辑区没了」看的是它的 testid），正文换成保存后的内容，并提示已保存。
    sendCommand("desktopFileSaveResult", {
      requestId: save.requestId,
      status: "saved",
      contentHash: "hash-2",
    });
    await expect
      .poll(() => document.querySelectorAll(".file-pane-editor").length)
      .toBe(0);
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="file-pane-viewer"]')
            ?.textContent ?? "",
      )
      .toContain("export const beta = 2;");
    await expect.poll(() => hasExactText("已保存")).toBe(true);
  });

  // 场景 2：截断的文件不给编辑入口——写回半份内容会把文件毁掉。
  it("a truncated file offers no edit affordance", async () => {
    await page.viewport(1280, 720);
    const logPath = `${DIR_A}/logs/big.log`;
    bootWithReadMessage(logPath);
    openFile(logPath, {
      loading: false,
      content: "line 1\nline 2\n",
      truncated: true,
      totalLines: 2001,
    });

    await expect
      .poll(() => isVisible('[data-testid="file-pane-truncated-hint"]'))
      .toBe(true);
    expect(
      document.querySelectorAll('[data-testid="file-pane-edit"]').length,
    ).toBe(0);
  });

  // spec 场景 23–24：「复制文件内容」把面板里的完整内容写进剪贴板，与「复制路径」
  // 是两颗按钮；走的是面板自己的复制链路，终点换成本地探针。
  it("copy-file-contents writes the whole file to the clipboard", async () => {
    await page.viewport(1280, 720);
    const codePath = `${DIR_A}/src/components/Login.tsx`;
    bootWithReadMessage(codePath);
    const content = "export const alpha = 1;\nexport const beta = 2;\n";
    openFile(codePath, {
      loading: false,
      content,
      contentHash: "hash-1",
      editable: true,
      truncated: false,
      totalLines: 2,
    });

    installClipboardProbe();
    const copyContent = await waitForSelector(
      '[data-testid="file-copy-content"]',
    );
    expect(isVisible('[data-testid="file-copy-content"]')).toBe(true);
    // 与「复制路径」并列但互不替代。
    expect(isVisible('[data-testid="file-copy-path"]')).toBe(true);

    await userEvent.click(copyContent);
    await expect.poll(() => hasExactText("内容已复制")).toBe(true);
    expect(copiedText()).toBe(content);
  });

  // 场景 24：截断的文件只复制已加载部分，提示里说清楚。
  it("a truncated file copies the loaded part and says so", async () => {
    await page.viewport(1280, 720);
    const logPath = `${DIR_A}/logs/big.log`;
    bootWithReadMessage(logPath);
    openFile(logPath, {
      loading: false,
      content: "line 1\nline 2\n",
      truncated: true,
      totalLines: 2001,
    });

    installClipboardProbe();
    await userEvent.click(
      await waitForSelector('[data-testid="file-copy-content"]'),
    );
    await expect
      .poll(() => hasText("内容已复制（文件已截断，仅复制已加载内容）"))
      .toBe(true);
    expect(copiedText()).toBe("line 1\nline 2\n");
  });

  // 场景 4：同名文件的标签只追加「最短可区分目录后缀」，整条路径不进标签
  // （设计师反馈的正是绝对路径被 200px 上限截断成全同的前缀）。
  it("duplicate names get a short directory suffix, never a path", async () => {
    await page.viewport(1280, 720);
    const srcIndex = `${DIR_A}/src/index.ts`;
    const libIndex = `${DIR_A}/lib/index.ts`;
    const unique = `${DIR_A}/README.md`;

    renderDesktopApp();
    bootDesktop({
      workdir: DIR_A,
      messages: [
        MockDataGenerator.createUserMessage("看几个文件", "msg-u1"),
        ...[srcIndex, libIndex, unique].map((filePath, index) =>
          readMessageFor(`第 ${index + 1} 个`, filePath),
        ),
      ],
    });

    for (const [index, filePath] of [srcIndex, libIndex, unique].entries()) {
      fireEvent.click(toolPathLinks()[index]);
      sendCommand("desktopFileContent", {
        fileView: {
          path: filePath,
          host: "local",
          loading: false,
          content: `// ${filePath}\n`,
        },
      });
      await expect
        .poll(
          () => document.querySelectorAll('[data-testid="file-tab"]').length,
        )
        .toBe(index + 1);
    }

    const tabs = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="file-tab"]'),
      );
    // 读屏念作「index.ts, src」：名字 + 灰色小字后缀，同行。
    expect(tabs()[0].textContent).toContain("index.ts, src");
    expect(tabs()[1].textContent).toContain("index.ts, lib");
    // 唯一文件名不加后缀；绝对路径一个字符都不进标签。
    expect(tabs()[2].textContent?.trim()).toBe("README.md");
    expect(tabs()[0].textContent).not.toContain(DIR_A);
    // 悬浮给相对路径（不是绝对路径）。
    expect(tabs()[0].title).toBe("src/index.ts");
  });

  // 场景 11：右键菜单必须弹在指针旁边。它挂在带子里时 `position: absolute`
  // 的包含块是最近的定位祖先 `.preview-pane-body`（面板在窗口右侧），
  // `clientX/clientY`（视口坐标）被当成了面板内偏移 —— 实测点击点 (705,153)
  // 的菜单跑到 (1374,287)，整块偏出面板宽度、飘到窗口最右侧甚至屏幕外。
  // 这里锁两件事：落点贴指针，以及贴视口边缘时翻到指针另一侧。
  it("tab context menu opens at the pointer and flips at viewport edges", async () => {
    await page.viewport(1280, 720);
    const first = `${DIR_A}/src/index.ts`;
    const second = `${DIR_A}/lib/index.ts`;

    renderDesktopApp();
    bootDesktop({
      workdir: DIR_A,
      messages: [
        MockDataGenerator.createUserMessage("看两个文件", "msg-u1"),
        readMessageFor("第 1 个", first),
        readMessageFor("第 2 个", second),
      ],
    });

    for (const [index, filePath] of [first, second].entries()) {
      fireEvent.click(toolPathLinks()[index]);
      sendCommand("desktopFileContent", {
        fileView: {
          path: filePath,
          host: "local",
          loading: false,
          content: `// ${filePath}\n`,
        },
      });
      await expect
        .poll(
          () => document.querySelectorAll('[data-testid="file-tab"]').length,
        )
        .toBe(index + 1);
    }

    const tabs = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="file-tab"]'),
      );
    const menu = () =>
      document.querySelector<HTMLElement>('[data-testid="file-tab-menu"]');

    // 一次：真实右键落在第二格标签上 → 菜单左上角就落在指针处。
    const tabBox = tabs()[1].getBoundingClientRect();
    const clickX = Math.round(tabBox.x + 30);
    const clickY = Math.round(tabBox.y + tabBox.height / 2);
    // Playwright 的 `locator.click({ button })` 原样转发 —— 这是真 CDP 右键，
    // `position` 是相对标签左上角的偏移。
    const rightClick = {
      button: "right" as const,
      position: { x: 30, y: Math.round(tabBox.height / 2) },
    };
    await userEvent.click(tabs()[1], rightClick);
    await expect
      .poll(() => isVisible('[data-testid="file-tab-menu"]'))
      .toBe(true);
    const atPointer = menu()!.getBoundingClientRect();
    expect(Math.abs(atPointer.x - clickX)).toBeLessThanOrEqual(1);
    expect(Math.abs(atPointer.y - clickY)).toBeLessThanOrEqual(1);
    expect(atPointer.right).toBeLessThanOrEqual(window.innerWidth);

    // 二次：指针贴视口右下角 → 菜单翻到指针左上，四边都不出视口。
    // 不先关菜单：右键落在另一格标签上就是「重开并重新落位」，与真机行为一致，
    // 也不必依赖「点外部关闭」那条延迟注册的监听器（那会让这条用例有时序抖动）。
    const corner = {
      x: window.innerWidth - 20,
      y: window.innerHeight - 20,
    };
    fireEvent.contextMenu(tabs()[0], {
      clientX: corner.x,
      clientY: corner.y,
    });
    await expect
      .poll(() => isVisible('[data-testid="file-tab-menu"]'))
      .toBe(true);
    const flipped = menu()!.getBoundingClientRect();
    expect(flipped.right).toBeLessThanOrEqual(window.innerWidth);
    expect(flipped.bottom).toBeLessThanOrEqual(window.innerHeight);
    // 翻转 = 菜单右缘/下缘贴着指针，而不是把指针压在菜单左上角。
    expect(flipped.right).toBeLessThanOrEqual(corner.x);
    expect(flipped.bottom).toBeLessThanOrEqual(corner.y);

    // 挂到 body 上还得多一层保证：它确实在最上层能点到（userEvent 走真实指针，
    // 被别的层压住就会失败），点完即收起。
    const item = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="file-tab-menu-item"]',
      ),
    ).find((el) => (el.textContent ?? "").trim() === "关闭其他")!;
    await userEvent.click(item);
    await expect
      .poll(
        () => document.querySelectorAll('[data-testid="file-tab-menu"]').length,
      )
      .toBe(0);
  });
});
