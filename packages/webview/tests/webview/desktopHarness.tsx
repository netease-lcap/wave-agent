/**
 * 桌面端（`DesktopApp`）用例的公共起点。
 *
 * 桌面端页面在真机上由 `src/index.tsx` 挂：`window.waveHostType === "desktop"`
 * 时把 `data-host="desktop"` 打到 `<html>` 上、渲染 `<DesktopApp>`，页面静态声明
 * `data-theme="dark"`。单元测试不走那个入口，所以这里补上这两件事 —— 少了
 * `data-host` 整套中密度参数（host-desktop.css，1200+ 条选择器都带这个前缀）
 * 就不会生效，量出来的仍是插件端的尺寸。
 *
 * `import "../../src/styles/host-desktop.css"` 是同一件事的另一半：真机页面加载
 * 打包后的 chat.css，单元测试由 vite 按 import 注入。
 *
 * 消息注入沿用 `test-utils` 的 `sendCommand`：每条命令各自 `act()`。**必须一条
 * 一条发**，两条塞进同一个 `act()` 时 pane 里的 ChatApp 还没挂上监听器，
 * `setInitialState` 会被丢掉（表现是输入区永远不出现）。
 */

import React from "react";
import { render, waitFor } from "@testing-library/react";
import { createMockVscode, sendCommand } from "./test-utils";
import { DesktopApp } from "../../src/components/DesktopApp";
import { sessionUi } from "../../src/utils/sessionUiStore";
import "../../src/styles/host-desktop.css";

export function renderDesktopApp() {
  document.documentElement.dataset.host = "desktop";
  document.documentElement.dataset.theme = "dark";
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  return { ...result, vscode };
}

/**
 * 清掉面板分组缓存（`SessionUiStore` 是模块级单例，按 `new:<paneId>` 归档）。
 * 桌面端同一分屏的标签/文件树展开态会被下一个用例继承 —— 不清就会出现「只点了一个
 * 文件，却有 10 个标签」这种串味。
 */
export function resetPanelState() {
  sessionUi.prune(new Set());
}

/** 清掉宿主档与主题，别让下一个用例量到桌面端的尺寸。 */
export function resetHostTier() {
  delete document.documentElement.dataset.host;
  delete document.documentElement.dataset.theme;
}

/** 两帧：让 ResizeObserver / 首帧布局落地。 */
export const twoFrames = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );

/** webview 发给宿主的所有消息（按发送顺序）。 */
export function sentCommands(vscode: { postMessage: unknown }) {
  return (
    vscode.postMessage as unknown as {
      mock: { calls: [Record<string, unknown>][] };
    }
  ).mock.calls.map(([message]) => message);
}

/** 最后一条指定命令的载荷。 */
export function lastSent(vscode: { postMessage: unknown }, command: string) {
  return sentCommands(vscode)
    .filter((message) => message.command === command)
    .pop() as Record<string, unknown> | undefined;
}

/**
 * 打开桌面端一个分屏：先推工作目录（这一步才挂上 pane 的 ChatApp），再推初值，
 * 最后按需推消息。三步各自 `act()`，见文件头的时序说明。
 */
export function bootDesktop(options: {
  workdir?: string;
  /** mock 出来的 SDK `Message`（没有 index signature，别收窄成 Record）。 */
  messages?: readonly unknown[];
  isStreaming?: boolean;
  extra?: Record<string, unknown>;
}) {
  const {
    workdir = "/Users/dev/projects/wave-agent",
    messages = [],
    isStreaming = false,
    extra = {},
  } = options;
  sendCommand("desktopWorkdirState", {
    workdir,
    recentWorkdirs: [workdir],
  });
  sendCommand("setInitialState", {
    messages: [],
    isStreaming,
    sessions: [],
    isAuthenticated: true,
    permissionMode: "default",
    ...extra,
  });
  if (messages.length) sendCommand("updateMessages", { messages });
}

/**
 * 复制链路探针：把 `navigator.clipboard.writeText` 换掉，写进去的文本留在
 * `window.__copied` 上。走的仍是面板自己的复制链路，只是终点从系统剪贴板换成
 * 这个函数（headless 下系统剪贴板读不回来，权限也不一定给）。
 */
export function installClipboardProbe() {
  const scope = window as unknown as { __copied?: string | null };
  scope.__copied = null;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        scope.__copied = text;
      },
    },
  });
}

export function copiedText(): string | null {
  return (window as unknown as { __copied?: string | null }).__copied ?? null;
}

/**
 * 元素「可见」，判据与 Playwright 的 `toBeVisible` 同一套：存在、有非空盒、
 * 不是 `display:none` / `visibility:hidden`。jest-dom 的 `toBeVisible` 不量盒，
 * 零尺寸的壳子在它那里也算可见。
 */
export function isVisible(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** 等某个选择器出现（等价于 Playwright 的自动重试查询）。 */
export const waitForSelector = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no element for ${selector}`);
    return el;
  });

/** 当前消息里的第 n 个工具路径链接（`Read` / `Write` 块里的可点路径）。 */
export const toolPathLinks = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".write-tool-path"));
