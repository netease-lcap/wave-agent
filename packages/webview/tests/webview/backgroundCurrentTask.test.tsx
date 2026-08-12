import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  sendCommand,
  act,
} from "./test-utils";

/**
 * Ctrl+B backgrounds the current foreground task (same behavior as the CLI).
 * The webview forwards it to the host via `backgroundCurrentTask`; the host
 * (vsce/desktop) then tells the underlying agent to move the running task to
 * the background task manager. Like Esc-abort, the key is only intercepted
 * while a turn is running so the host keeps its own Ctrl+B binding when idle
 * (e.g. VS Code's Toggle Sidebar).
 */
describe("Background Current Task (Ctrl+B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should post backgroundCurrentTask on Ctrl+B while streaming", async () => {
    const { vscode } = renderChatApp();

    sendCommand("startStreaming");

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "b", ctrlKey: true });
    });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "backgroundCurrentTask",
    });
  });

  it("should post backgroundCurrentTask on Cmd+B while streaming (macOS convention)", async () => {
    const { vscode } = renderChatApp();

    sendCommand("startStreaming");

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "b", metaKey: true });
    });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "backgroundCurrentTask",
    });
  });

  it("should not intercept Ctrl+B when idle (falls through to host binding)", async () => {
    const { vscode } = renderChatApp();

    const messageInput = screen.getByTestId("message-input");
    messageInput.focus();

    await act(async () => {
      fireEvent.keyDown(messageInput, { key: "b", ctrlKey: true });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "backgroundCurrentTask",
    });
  });
});
