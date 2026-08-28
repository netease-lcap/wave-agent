import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { EDIT_TOOL_NAME } from "wave-agent-sdk";

// Switching to a side-by-side pane fires `focusInput`. A tool-permission
// dialog never steals focus (spec「确认弹窗不打断输入」), and the message
// input stays visible while one is open — so focusInput lands on the input
// as usual and the user reaches the dialog with Tab or a click. Exception:
// the rewind modal is a real overlay covering the input, so its primary
// action receives the focus instead.
describe("focusInput with an open dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function blurActive() {
    (document.activeElement as HTMLElement | null)?.blur();
  }

  it("focuses the message input when no dialog is open", () => {
    renderChatApp();

    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(screen.getByTestId("message-input"));
  });

  it("focuses the message input when a tool confirmation is open", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("showConfirmation", {
        confirmationId: "test_confirmation",
        toolName: EDIT_TOOL_NAME,
        confirmationType: "代码修改待确认",
        toolInput: {
          file_path: "test.ts",
          old_string: "old",
          new_string: "new",
        },
      });
    });

    // The dialog is up but does not hijack pane focus: the input stays
    // visible and is the focusInput target (no accidental Enter-approves).
    const applyBtn = document.querySelector(
      ".confirmation-btn-apply",
    ) as HTMLElement;
    expect(applyBtn).not.toBeNull();
    expect(screen.getByTestId("message-input")).toBeVisible();

    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(screen.getByTestId("message-input"));
  });

  it("focuses the rewind confirm button when the rewind modal is open", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("Message 1", "msg-1"),
      MockDataGenerator.createAssistantMessage("Response 1", "msg-2"),
    ];
    act(() => {
      sendCommand("updateMessages", { messages });
    });

    // Open the rewind confirmation modal.
    await act(async () => {
      fireEvent.click(
        document.querySelector(".message-action-btn") as HTMLElement,
      );
    });
    expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();

    const confirmBtn = screen.getByTestId("confirm-dialog-confirm");
    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(confirmBtn);
  });
});
