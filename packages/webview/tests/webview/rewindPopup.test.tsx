import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";

const CHECKPOINTS = [
  { id: "u1", content: "first user message" },
  { id: "u2", content: "second user message" },
  { id: "u3", content: "third user message" },
];

async function openRewindPopup(vscode: {
  postMessage: ReturnType<typeof vi.fn>;
}) {
  const input = screen.getByTestId("message-input");
  act(() => {
    input.textContent = "/rewind";
  });
  await fireInput(input, { data: "/rewind", inputType: "insertText" });
  act(() => {
    fireEvent.click(screen.getByTestId("send-btn"));
  });
  return vscode;
}

describe("/rewind Popup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests checkpoints from the host instead of sending a message", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "listRewindCheckpoints" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );

    // Popup visible in loading state
    expect(screen.getByTestId("rewind-popup")).toBeInTheDocument();
    expect(screen.getByText("正在加载...")).toBeInTheDocument();
  });

  it("renders all checkpoints with the most recent one pre-selected", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    act(() => {
      sendCommand("rewindCheckpoints", { checkpoints: CHECKPOINTS });
    });

    await waitFor(() => {
      expect(screen.getByText("first user message")).toBeInTheDocument();
    });

    const items = document.querySelectorAll(".rewind-popup-item");
    expect(items).toHaveLength(3);

    const selected = document.querySelectorAll(".rewind-popup-item.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe("third user message");
  });

  it("shows an empty state when there are no checkpoints", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    act(() => {
      sendCommand("rewindCheckpoints", { checkpoints: [] });
    });

    await waitFor(() => {
      expect(screen.getByText("没有可回滚的用户消息")).toBeInTheDocument();
    });
  });

  it("keyboard: ArrowUp moves selection up and Enter opens the confirmation dialog", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    act(() => {
      sendCommand("rewindCheckpoints", { checkpoints: CHECKPOINTS });
    });

    await waitFor(() => {
      expect(screen.getByText("second user message")).toBeInTheDocument();
    });

    const popup = screen.getByTestId("rewind-popup");

    // Default selection is the last item; one ArrowUp selects the second.
    act(() => {
      fireEvent.keyDown(popup, { key: "ArrowUp" });
    });
    const selected = document.querySelector(".rewind-popup-item.selected");
    expect(selected?.textContent).toBe("second user message");

    act(() => {
      fireEvent.keyDown(popup, { key: "Enter" });
    });

    // Popup closes and the confirmation dialog opens — no command sent yet
    expect(screen.queryByTestId("rewind-popup")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "rewindToMessage" }),
    );

    // Confirming sends rewindToMessage with the selected id
    act(() => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "rewindToMessage",
      messageId: "u2",
    });
  });

  it("Escape closes the popup without sending anything", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    act(() => {
      sendCommand("rewindCheckpoints", { checkpoints: CHECKPOINTS });
    });

    await waitFor(() => {
      expect(screen.getByText("first user message")).toBeInTheDocument();
    });

    act(() => {
      fireEvent.keyDown(screen.getByTestId("rewind-popup"), { key: "Escape" });
    });

    expect(screen.queryByTestId("rewind-popup")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("confirm-dialog-overlay"),
    ).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "rewindToMessage" }),
    );
  });

  it("clicking a checkpoint opens the confirmation dialog for that message", async () => {
    const { vscode } = renderChatApp();
    await openRewindPopup(vscode);

    act(() => {
      sendCommand("rewindCheckpoints", { checkpoints: CHECKPOINTS });
    });

    await waitFor(() => {
      expect(screen.getByText("first user message")).toBeInTheDocument();
    });

    act(() => {
      fireEvent.click(screen.getByText("first user message"));
    });

    expect(screen.queryByTestId("rewind-popup")).not.toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "rewindToMessage",
      messageId: "u1",
    });
  });
});
