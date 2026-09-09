import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

/** 提取 webview 最近一次发出的 requestId（requestHistory/searchHistory）。 */
function sentRequestId(
  vscode: { postMessage: ReturnType<typeof vi.fn> },
  command: string,
): string {
  const calls = vscode.postMessage.mock.calls as Array<
    [{ command?: string; requestId?: string }]
  >;
  return (
    calls.filter((c) => c[0]?.command === command).pop()?.[0]?.requestId ?? ""
  );
}

describe("History Search Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should open history search popup on Ctrl+R and select a prompt", async () => {
    const { vscode } = renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    // 1. Press Ctrl+R
    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "r", ctrlKey: true });
    });

    // 2. Verify popup is visible
    await waitFor(() => {
      expect(screen.getByTestId("history-search-popup")).toBeInTheDocument();
    });

    // 3. Simulate history response from extension（归属键 = 请求 requestId）
    const mockHistory = [
      { prompt: "First prompt", timestamp: Date.now() - 10000 },
      { prompt: "Second prompt", timestamp: Date.now() - 5000 },
      { prompt: "Third prompt", timestamp: Date.now() },
    ];

    sendCommand("historyResponse", {
      history: mockHistory,
      requestId: sentRequestId(vscode, "requestHistory"),
    });

    // 4. Verify history items are displayed
    await waitFor(() => {
      const items = screen
        .getByTestId("history-search-popup")
        .querySelectorAll(".history-search-item");
      expect(items).toHaveLength(3);
      expect(items[0]).toHaveTextContent(/First prompt/);
    });

    // 5. Navigate and select - first item is selected by default, ArrowDown selects second
    const popup = screen.getByTestId("history-search-popup");
    const searchInput = popup.querySelector(
      ".history-search-input",
    ) as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
    });
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Enter" });
    });

    // 6. Verify popup is closed and input is populated
    await waitFor(() => {
      expect(
        screen.queryByTestId("history-search-popup"),
      ).not.toBeInTheDocument();
    });

    // Verify the message input was populated with the selected prompt
    await waitFor(() => {
      expect(messageInput.textContent?.trim()).toBe("Second prompt");
    });
  });

  it("should filter history results as user types", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    // 1. Press Ctrl+R
    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "r", ctrlKey: true });
    });

    // 2. Type in search box
    await waitFor(() => {
      expect(screen.getByTestId("history-search-popup")).toBeInTheDocument();
    });

    const popup = screen.getByTestId("history-search-popup");
    const searchInput = popup.querySelector(
      ".history-search-input",
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "test" } });
    });

    // Advance fake time past the 300ms debounce (wrapped in act to flush state updates)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });

    // 3. Verify searchHistory command was sent to extension
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "searchHistory", query: "test" }),
    );

    // 4. Simulate filtered response（归属键 = 请求 requestId）
    const filteredHistory = [
      { prompt: "test prompt 1", timestamp: Date.now() - 1000 },
      { prompt: "another test", timestamp: Date.now() },
    ];

    sendCommand("historyResponse", {
      history: filteredHistory,
      requestId: sentRequestId(vscode, "searchHistory"),
    });

    // 5. Verify filtered items
    await waitFor(() => {
      const items = screen
        .getByTestId("history-search-popup")
        .querySelectorAll(".history-search-item");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent(/test prompt 1/);
    });
  });

  it("drops a stale historyResponse whose requestId belongs to an older query (过期即弃)", async () => {
    const { vscode } = renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "r", ctrlKey: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId("history-search-popup")).toBeInTheDocument();
    });

    // 晚到的旧查询回复（requestId 不匹配）→ 丢弃：列表为空、loading 保持
    sendCommand("historyResponse", {
      history: [{ prompt: "stale", timestamp: Date.now() }],
      requestId: "stale-request-id",
    });
    expect(screen.getByTestId("history-search-popup").textContent).toContain(
      "正在加载...",
    );

    // 当前请求的回复 → 正常渲染
    sendCommand("historyResponse", {
      history: [{ prompt: "fresh", timestamp: Date.now() }],
      requestId: sentRequestId(vscode, "requestHistory"),
    });
    await waitFor(() => {
      const items = screen
        .getByTestId("history-search-popup")
        .querySelectorAll(".history-search-item");
      expect(items).toHaveLength(1);
      expect(items[0]).toHaveTextContent(/fresh/);
    });
  });

  it("should close history search popup on Escape", async () => {
    renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    // 1. Press Ctrl+R
    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "r", ctrlKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-search-popup")).toBeInTheDocument();
    });

    // 2. Press Escape on the search input
    const popup = screen.getByTestId("history-search-popup");
    const searchInput = popup.querySelector(
      ".history-search-input",
    ) as HTMLElement;
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });

    // 3. Verify popup is closed
    await waitFor(() => {
      expect(
        screen.queryByTestId("history-search-popup"),
      ).not.toBeInTheDocument();
    });
  });

  it("should return focus to message input after closing history search by clicking outside", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();
    expect(messageInput).toHaveFocus();

    // 1. Press Ctrl+R to open history search
    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "r", ctrlKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId("history-search-popup")).toBeInTheDocument();
    });

    // 2. Click outside the popup (e.g., on the chat container — empty state shows WelcomeView)
    const chatContainer = screen.getByTestId("chat-container");
    await act(async () => {
      fireEvent.mouseDown(chatContainer);
    });

    // 3. Verify popup is closed
    await waitFor(() => {
      expect(
        screen.queryByTestId("history-search-popup"),
      ).not.toBeInTheDocument();
    });

    // 4. Verify focus is returned to message input (closeHistorySearch uses setTimeout(0))
    await vi.runAllTimersAsync();
    expect(messageInput).toHaveFocus();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
