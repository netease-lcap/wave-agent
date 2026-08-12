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

// Switching to a side-by-side pane fires `focusInput`. When a confirm/rewind
// dialog is open in that pane the message input is hidden (display:none during
// a tool confirmation) or covered (rewind modal), so focusing it silently
// no-ops. Instead the dialog's primary action should receive focus so the
// keyboard works on it immediately after the switch.
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

  it("focuses the confirmation dialog primary button when a tool confirmation is open", async () => {
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

    const applyBtn = document.querySelector(
      ".confirmation-btn-apply",
    ) as HTMLElement;
    expect(applyBtn).not.toBeNull();
    // The message input is hidden while the confirmation is showing.
    expect(screen.getByTestId("message-input")).not.toBeVisible();

    blurActive();
    act(() => {
      sendCommand("focusInput");
    });

    expect(document.activeElement).toBe(applyBtn);
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
