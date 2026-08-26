import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  fireInput,
} from "./test-utils";

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("/plan command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should forward bare /plan to the host without sending a message", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      await typeAndSend("/plan");
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "planCommand",
        args: undefined,
      });
    });
    // The plan command must never be sent to the agent as a chat message.
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("should forward /plan with a description to the host", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      await typeAndSend("/plan Add user auth");
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "planCommand",
        args: "Add user auth",
      });
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("should forward /plan open as a plain description (no external editor)", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      await typeAndSend("/plan open");
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "planCommand",
        args: "open",
      });
    });
  });
});
