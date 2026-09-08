import React from "react";
import { vi } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { VsCodeApi } from "../../src/types";
import { ChatApp } from "../../src/components/ChatApp";
import { fixtures, type HostToWebviewMessage } from "wave-webview-fixtures";

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
 * Set text on a contenteditable message input, working around jsdom's lack of innerText support.
 * MessageInput reads `event.currentTarget.innerText` in its handleInput handler, but jsdom does
 * not implement the innerText getter/setter. We define it on the element, set textContent, then
 * fire the input event so the React handler picks up the value.
 */
export async function setInputText(element: HTMLElement, text: string) {
  Object.defineProperty(element, "innerText", {
    value: text,
    configurable: true,
    writable: true,
  });
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
