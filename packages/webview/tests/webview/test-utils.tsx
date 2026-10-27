import React from "react";
import { vi } from "vitest";
import { render, act, fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VsCodeApi } from "../../src/types";
import { ChatApp } from "../../src/components/ChatApp";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

/**
 * Assertion style guide (see PR for #2063/#2067 precedent):
 *
 * Anchor assertions on **stable semantics**, not icon-implementation details:
 * - Prefer `data-testid` handles (`getByTestId("diff-refresh")`,
 *   `getByTestId("account-usage-collapse")`) over CSS class lookups.
 * - For icon state, assert the semantic class (`"is-spinning"`) or the
 *   element kind (`svg` exists), never a font-icon class
 *   (`codicon-chevron-up` / `codicon-modifier-spin`) — icons migrate between
 *   codicon font and inline SVG (0903 baseline) and class assertions break
 *   or, worse, silently pass while asserting nothing.
 * - Tests must still fail without the fix: an assertion that survives any
 *   implementation is not a test.
 */

// Mock heavy dependencies
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

// Mock CSS imports
vi.mock("../../src/styles/ChatApp.css", () => ({}));
vi.mock("../../src/styles/globals.css", () => ({}));
vi.mock("@vscode/codicons/dist/codicon.css", () => ({}));

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

/**
 * Desktop host parity (spec desktop-layout.md「启动即单个分屏」): the real main
 * process answers the webview's `desktopReady` by pushing a single-pane layout
 * (`desktopPanes`), so the welcome/empty state lives inside the split layout
 * from the start and pane-scoped pushes carry the focused paneId. The mock
 * mirrors that — tests driving DesktopApp don't need to inject `desktopPanes`
 * themselves — and once a pane layout is active (auto-pushed here or injected
 * by a split-view test), untagged messages are routed to the focused pane the
 * way the real host tags them.
 */
let desktopLayoutActive = false;
let desktopFocusedPaneId = "pane-1";
// DesktopApp-owner messages — never pane-tagged by the host.
const DESKTOP_GLOBAL_COMMANDS = new Set([
  "desktopWorkdirState",
  "desktopSessionTree",
  "desktopPanes",
]);

function routeHostMessage(message: Record<string, unknown>) {
  if (message.command === "desktopPanes") {
    const panes = (message.panes ?? []) as Array<{ paneId?: string }>;
    desktopLayoutActive = panes.length > 0;
    const focused =
      (message.focusedPaneId as string | undefined) ?? panes[0]?.paneId;
    if (focused) desktopFocusedPaneId = focused;
  }
  let payload = message;
  if (
    desktopLayoutActive &&
    typeof payload.command === "string" &&
    payload.paneId == null &&
    !DESKTOP_GLOBAL_COMMANDS.has(payload.command)
  ) {
    payload = { ...payload, paneId: desktopFocusedPaneId };
  }
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: payload }));
  });
}

/**
 * Create a mock VS Code API object
 */
export function createMockVscode() {
  // Untyped vi.fn() keeps `.mock.calls` loosely typed so tests that filter
  // `postMessage.mock.calls` by `.command` compile without narrowing; the
  // desktopReady seam lives on the implementation instead.
  const postMessage = vi.fn();
  postMessage.mockImplementation((message: unknown) => {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { command?: string }).command === "desktopReady"
    ) {
      // Mirror the host's desktopReady reply: push the single unbound pane
      // first so the shell (never the pre-pane layout) mounts with the workdir.
      routeHostMessage({
        command: "desktopPanes",
        panes: [{ paneId: "pane-1", host: "local", row: 0 }],
        focusedPaneId: "pane-1",
      });
    }
  });
  return {
    postMessage,
    getState: vi.fn().mockReturnValue(null),
    setState: vi.fn(),
  };
}

/**
 * Render the ChatApp with a mock VS Code API
 */
export function renderChatApp(vscode?: VsCodeApi) {
  const mockVscode = (vscode || createMockVscode()) as ReturnType<
    typeof createMockVscode
  >;
  const result = render(<ChatApp vscode={mockVscode} />);
  // Default to authenticated so the message input is enabled and MessageList
  // (not the empty-state WelcomeView) renders for empty-state assertions.
  sendHostMessage(fixtures.authStatusResponse());
  const user = userEvent.setup();
  return { ...result, vscode: mockVscode, user };
}

/**
 * 把一个文件真的打开到桌面端文件面板：点消息里的文件路径，或者（消息里没有可点
 * 的路径时）从工作区目录树里逐级点开——两条都是用户真能走的路——然后让宿主回
 * `desktopFileContent`。
 *
 * 多标签之后回包按 path 归属到「条上已经打开的那个文件」（spec「文件面板已打开
 * 文件的标签」），所以测试必须先把请求发出去：直接推一条 desktopFileContent 不
 * 会凭空开出文件（否则「关掉的标签被迟到的回包复活」也会跟着成立）。
 *
 * `root` 只在不走消息链接时才需要：目录树的根，以及各层目录要回哪些条目。
 */
export function openFileInDesktopPanel(
  path: string,
  fileView: Record<string, unknown> = {},
  root?: string,
) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  // 消息里显示的是相对工作目录的路径（`src/a.ts`），按文件名认那一个链接。
  const link = Array.from(
    document.querySelectorAll(".write-tool-path, a.file-path-link"),
  ).find((node) => (node.textContent ?? "").endsWith(base));
  if (link) {
    fireEvent.click(link);
  } else {
    if (!root)
      throw new Error(`no clickable path for ${path} and no tree root`);
    if (!screen.queryByTestId("file-pane")) {
      // 两次点击之间必须让 React 渲染一次：空态入口是展开后才出现的。
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
      fireEvent.click(screen.getByTestId("panel-empty-item-file"));
    }
    const segments = path.slice(root.length + 1).split("/");
    let dir = root;
    const reply = (target: string, name: string, isFile: boolean) =>
      act(() => {
        sendCommand("desktopDirEntries", {
          path: target,
          entries: [{ name, type: isFile ? "file" : "dir" }],
          total: 1,
        });
      });
    reply(dir, segments[0], segments.length === 1);
    for (let i = 0; i < segments.length; i++) {
      const isFile = i === segments.length - 1;
      const row = screen
        .getAllByTestId("file-tree-row")
        .find((node) => (node.textContent ?? "").endsWith(segments[i]));
      if (!row) throw new Error(`tree row ${segments[i]} missing`);
      fireEvent.click(row);
      if (!isFile) {
        dir = `${dir}/${segments[i]}`;
        reply(dir, segments[i + 1], i + 1 === segments.length - 1);
      }
    }
  }
  act(() => {
    sendCommand("desktopFileContent", {
      fileView: { path, host: "local", content: "", ...fileView },
    });
  });
}

/**
 * Simulate an extension → webview message
 */
export function sendExtensionMessage(data: Record<string, unknown>) {
  routeHostMessage(data);
}

/**
 * Simulate extension message with command and additional data
 */
export function sendCommand(command: string, data?: Record<string, unknown>) {
  sendExtensionMessage({ command, ...data });
}

/**
 * Send a typed host → webview message anchored to the shared contract
 * (wave-webview-fixtures). Prefer this over sendCommand for messages that
 * have a fixture, so test payloads stay in lockstep with the real hosts.
 */
export function sendHostMessage(message: HostToWebviewMessage) {
  sendExtensionMessage(message as unknown as Record<string, unknown>);
}

/**
 * 点一个「应用不该拦截」的链接，返回应用是否 preventDefault 过。
 *
 * 这类用例断言的是「默认跳转仍在」，而 jsdom 不实现跨文档导航，只会往控制台
 * 打印 `Not implemented: navigation to another Document` 弄脏套件。所以在冒泡到
 * window（React 的处理器挂在更内层，跑到这里时已执行完）的最后一个监听点记下
 * 当时的 defaultPrevented，再自己 preventDefault 兜住这次导航。
 */
export function clickKeepingDefaultNavigation(element: Element): boolean {
  let preventedByApp = true;
  const guard = (event: MouseEvent) => {
    preventedByApp = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener("click", guard);
  try {
    fireEvent.click(element);
  } finally {
    window.removeEventListener("click", guard);
  }
  return preventedByApp;
}

/**
 * Set text on a contenteditable message input, then fire the input event so the
 * React handler picks up the value.
 *
 * `innerText` comes from the prototype polyfill in `tests/setup.ts` (mapped to
 * `textContent`), so do **not** redefine it on the element: a per-element
 * `innerText` pin keeps returning the old text after the DOM changes (e.g. the
 * input settling on another session's draft), which hides real state.
 */
export async function setInputText(element: HTMLElement, text: string) {
  element.textContent = text;
  await act(async () => {
    fireEvent.input(element, { data: text, inputType: "insertText" });
  });
}

/**
 * Fire an input event wrapped in act() to prevent React state update warnings.
 * If fake timers are enabled, also advances them to flush debounced state updates.
 */
export async function fireInput(
  element: HTMLElement,
  options?: { data?: string; inputType?: string },
) {
  await act(async () => {
    fireEvent.input(element, options);
    // Try to advance timers if fake timers are enabled (flushes 150ms debounce in handleSelectionChange)
    try {
      await vi.advanceTimersByTimeAsync(150);
    } catch {
      // Fake timers not enabled, skip
    }
  });
}

// Re-export the shared fixture factory so tests can build contract-anchored
// host payloads (e.g. subagentConfigurationsResponse).
export { fixtures } from "wave-webview-fixtures";

// Re-export commonly used testing utilities
export {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  act,
} from "@testing-library/react";
export { default as userEvent } from "@testing-library/user-event";
