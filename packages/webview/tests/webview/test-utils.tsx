import React from "react";
import { vi } from "vitest";
import {
  render,
  act,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VsCodeApi } from "../../src/types";
import { ChatApp } from "../../src/components/ChatApp";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

/**
 * Assertion style guide (see PR for #2063/#2067 precedent):
 *
 * Anchor assertions on **stable semantics**, not icon-implementation details:
 * - Prefer `data-testid` handles (`getByTestId("diff-refresh")`,
 *   `getByTestId("account-usage-btn")`) over CSS class lookups.
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

// 样式不做 mock：browser mode 里 `vi.mock("*.css")` 会触发 import map 重建，与已
// 预打包的依赖冲突、整文件加载失败；样式本身由 vite 正常注入即可。

// ResizeObserver 用真浏览器自带的：虚拟列表靠它盯行高与容器尺寸，桩掉它等于让
// 「行长高了」「面板开合」这两条路在测试里彻底消失。

/**
 * Desktop host parity (spec desktop-split-pane.md「启动即单个分屏」): the real main
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
 * Give the message list a real, scrollable viewport.
 *
 * `.messages-container` gets its height from the chat layout around it, and
 * Testing Library renders the app into a bare container: leave it alone and the
 * list either has nothing to scroll (no scroll position is ever reachable) or
 * grows as tall as its own content (nothing is virtualized, every row stays in
 * the DOM). The test states the viewport the layout would have given it.
 */
export function pinMessageListViewport(
  container: HTMLElement,
  height = 600,
): HTMLElement {
  // `flex: none` first: `.messages-container` is a flex item with
  // `flex: 1 1 0%`, and a non-auto flex-basis replaces `height` as the item's
  // main size — without it the element stays as tall as all its rows.
  container.style.flex = "none";
  container.style.height = `${height}px`;
  container.style.overflowY = "auto";
  return container;
}

/**
 * Declare a scroll box's height *before* it mounts, and return a restore.
 *
 * A scroll container takes its height from the layout around it (`flex: 1 1 0%`
 * inside a full-height pane). Testing Library renders the component into a bare
 * container with none of that, so the box grows as tall as its content, and a
 * programmatic `scrollTop` write is clamped straight back to 0 — which is what
 * several cases assert on. A stylesheet rule is the only way to have the height
 * in place before the first layout: the component scrolls from a mount effect,
 * so pinning the node after `render()` is already too late.
 */
export function pinScrollBoxHeight(
  selector: string,
  height: number,
): () => void {
  const style = document.createElement("style");
  style.textContent = `${selector} {
    height: ${height}px !important;
    flex: none !important;
    overflow-y: auto !important;
  }`;
  document.head.appendChild(style);
  return () => style.remove();
}

/**
 * Scroll the message list until message `id`'s row top sits `pastTop` px above
 * the fold, then dispatch a scroll event so the list recomputes whatever it
 * derives from the scroll position (sticky candidate, outline highlight, ...).
 *
 * Row heights are whatever the content measures, so the offset is read back
 * from the row rather than assumed: park at the content top first (the row may
 * be far outside the current window, and only windowed rows are in the DOM),
 * take its offset in the list's own coordinate space, and scroll there.
 *
 * Returns the row, for assertions about where it ended up.
 */
export async function scrollRowAboveFold(
  container: HTMLElement,
  id: string,
  pastTop = 24,
): Promise<HTMLElement> {
  act(() => {
    container.scrollTop = 0;
    fireEvent.scroll(container);
  });
  const row = await waitFor(() => {
    const found = container.querySelector<HTMLElement>(
      `[data-measured-message-id="${id}"]`,
    );
    if (!found) throw new Error(`row ${id} is not rendered`);
    return found;
  });
  const rowStart =
    row.getBoundingClientRect().top -
    container.getBoundingClientRect().top +
    container.scrollTop;
  act(() => {
    container.scrollTop = rowStart + pastTop;
    fireEvent.scroll(container);
  });
  return row;
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
 * 契约是「应用没有取消默认」——只要读出这件事就够了，不需要让默认行为真的发生。
 * 真浏览器读到 `defaultPrevented === false` 就会照着链接跳走，把测试页面（以及
 * 后面的用例）一起带走，所以在冒泡到 window 的最后一个监听点（React 的处理器挂在
 * 更内层，跑到这里时已执行完）记下当时的 `defaultPrevented`，然后自己
 * `preventDefault()` 取消这次默认导航。
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
 * 展开一个已结束的 Bash 工具行（specs/ui/message-rendering-system.md「Bash 工具
 * 块默认收起」）：`end` + 成功的块默认收起，命令与输出**不在 DOM 里**，想断言它们
 * 就得先点开折叠行。
 *
 * 幂等：正文已经可见（运行中的块、`!` 模式、没有折叠入口的块）时什么都不做——那些
 * 形态本来就常显，再点一下反而会把它们收起来。
 */
export function expandBashRow(container: HTMLElement): HTMLElement | null {
  const header = container.querySelector(".bash-tool-header") as HTMLElement;
  if (header && !container.querySelector(".bash-command")) {
    fireEvent.click(header);
  }
  return header ?? null;
}

/**
 * Set text on a contenteditable message input, then fire the input event so the
 * React handler picks up the value.
 *
 * `innerText` is a real property in a real browser, so write `textContent` and
 * let the component read whatever it reads — do **not** redefine `innerText` on
 * the element: a per-element pin keeps returning the old text after the DOM
 * changes (e.g. the input settling on another session's draft), which hides the
 * real state.
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
