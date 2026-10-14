import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import type { Message } from "wave-agent-sdk";

describe("Rewind Feature", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should send rewindToMessage command only after confirming the dialog", async () => {
    const { vscode } = renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("Message 1", "msg-1"),
      MockDataGenerator.createAssistantMessage("Response 1", "msg-2"),
      MockDataGenerator.createUserMessage("Message 2", "msg-3"),
      MockDataGenerator.createAssistantMessage("Response 2", "msg-4"),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    // Verify messages are displayed
    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeInTheDocument();
    });

    // Clear message log to track new commands
    vscode.postMessage.mockClear();

    // Click rewind on the first user message (Message 1)
    const rewindButtons = document.querySelectorAll(".message-action-btn");
    expect(rewindButtons.length).toBeGreaterThanOrEqual(1);

    await act(async () => {
      fireEvent.click(rewindButtons[0] as HTMLElement);
    });

    // Clicking rewind only opens the confirmation dialog — no command yet
    expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();
    expect(screen.getByText("确定要回滚到此消息吗？")).toBeInTheDocument();
    let sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(
      sentMessages.find((m) => m.command === "rewindToMessage"),
    ).toBeUndefined();

    // Confirm the dialog
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });

    // Dialog closes and the command is sent to the extension
    expect(
      screen.queryByTestId("confirm-dialog-overlay"),
    ).not.toBeInTheDocument();
    sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    const rewindCommand = sentMessages.find(
      (m) => m.command === "rewindToMessage",
    );
    expect(rewindCommand).toBeDefined();
    expect(rewindCommand).toMatchObject({
      command: "rewindToMessage",
      messageId: "msg-1",
    });
    // Reply-to attribution: the host echoes this back on `rewindResult`, which
    // is the only signal that authorizes the local truncation.
    expect(typeof rewindCommand.requestId).toBe("string");
    expect(rewindCommand.requestId.length).toBeGreaterThan(0);
  });

  it("should not send rewindToMessage when the dialog is cancelled", async () => {
    const { vscode } = renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("Message 1", "msg-1"),
      MockDataGenerator.createAssistantMessage("Response 1", "msg-2"),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeInTheDocument();
    });

    vscode.postMessage.mockClear();

    const rewindButtons = document.querySelectorAll(".message-action-btn");
    await act(async () => {
      fireEvent.click(rewindButtons[0] as HTMLElement);
    });

    expect(screen.getByTestId("confirm-dialog-overlay")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });

    expect(
      screen.queryByTestId("confirm-dialog-overlay"),
    ).not.toBeInTheDocument();
    const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(
      sentMessages.find((m) => m.command === "rewindToMessage"),
    ).toBeUndefined();
  });

  it("should remove selected message and put its content back to input after rewind", async () => {
    const { vscode } = renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("Message 1", "msg-1"),
      MockDataGenerator.createAssistantMessage("Response 1", "msg-2"),
      MockDataGenerator.createUserMessage("Message 2", "msg-3"),
      MockDataGenerator.createAssistantMessage("Response 2", "msg-4"),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeInTheDocument();
    });

    // Click rewind on the second user message (Message 2)
    const rewindButtons = document.querySelectorAll(".message-action-btn");
    expect(rewindButtons.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      fireEvent.click(rewindButtons[1] as HTMLElement);
    });

    // Confirm the dialog so the command is dispatched
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
    });

    // Simulate the backend acknowledging the rewind. The reply carries no
    // payload: the webview cuts its own list at the anchor, then the host's
    // snapshot (keepMessages) refreshes the remaining fields — including the
    // draft — without touching that list.
    const rewindCommand = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m) => m.command === "rewindToMessage");
    expect(rewindCommand).toBeDefined();

    act(() => {
      sendCommand("rewindResult", {
        requestId: rewindCommand!.requestId,
        messageId: "msg-3",
        ok: true,
      });
    });

    act(() => {
      sendCommand("setInitialState", {
        messages: [],
        keepMessages: true,
        inputContent: "Message 2",
        tasks: [],
        isStreaming: false,
        sessions: [],
        configurationData: {
          language: "zh-CN",
          permissionMode: "ask",
        },
      });
    });

    // Verify Message 2 and Response 2 are removed from the messages list
    // (queryByText must be scoped to messages-container because the input box
    //  now contains 'Message 2' via inputContent)
    const messagesContainer = document.querySelector(".messages-container")!;
    await waitFor(() => {
      expect(screen.getByText("Message 1")).toBeInTheDocument();
      expect(messagesContainer.textContent).not.toContain("Message 2");
      expect(messagesContainer.textContent).not.toContain("Response 2");
    });

    // Verify input box has 'Message 2'
    const input = screen.getByTestId("message-input");
    expect(input.textContent).toContain("Message 2");
  });

  it("should not show rewind button on assistant messages", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createUserMessage("User message"),
      MockDataGenerator.createAssistantMessage("Assistant message"),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(screen.getByText("User message")).toBeInTheDocument();
    });

    // Rewind buttons should only appear on user messages
    const rewindButtons = document.querySelectorAll(".message-action-btn");
    // Only the single user message should have a rewind button
    expect(rewindButtons).toHaveLength(1);
  });

  it("should not show rewind button on background task notification messages", async () => {
    renderChatApp();

    const notificationMessage: Message = {
      id: "msg-notif",
      role: "user",
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          type: "task_notification",
          taskId: "task-1",
          taskType: "shell",
          status: "completed",
          summary: "Task done",
        },
      ],
    };

    const messages = [
      MockDataGenerator.createUserMessage("User message", "msg-user"),
      notificationMessage,
      MockDataGenerator.createAssistantMessage(
        "Assistant message",
        "msg-assistant",
      ),
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(screen.getByText("User message")).toBeInTheDocument();
    });

    // Only the real user message has a rewind button; the background
    // notification (role: user) must not — it is not a rewind checkpoint.
    const rewindButtons = document.querySelectorAll(".message-action-btn");
    expect(rewindButtons).toHaveLength(1);
  });

  it("should not show rewind button on hook-injected user messages", async () => {
    renderChatApp();

    const hookMessage: Message = {
      id: "msg-hook",
      role: "user",
      isMeta: true,
      timestamp: "2024-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: "hook context" }],
    };

    const messages = [
      MockDataGenerator.createUserMessage("User message", "msg-user"),
      hookMessage,
    ];

    act(() => {
      sendCommand("updateMessages", { messages });
    });

    await waitFor(() => {
      expect(screen.getByText("User message")).toBeInTheDocument();
    });

    // Hook-injected messages are system-generated and not rewind checkpoints
    const rewindButtons = document.querySelectorAll(".message-action-btn");
    expect(rewindButtons).toHaveLength(1);
  });

  describe("rewindResult (truncation is applied locally, never re-sent)", () => {
    const four = () => [
      MockDataGenerator.createUserMessage("Message 1", "msg-1"),
      MockDataGenerator.createAssistantMessage("Response 1", "msg-2"),
      MockDataGenerator.createUserMessage("Message 2", "msg-3"),
      MockDataGenerator.createAssistantMessage("Response 2", "msg-4"),
    ];

    /** Load a list, click rewind on the `index`-th rewind button (rewind
     * buttons only exist on user messages), confirm, and return the requestId
     * the webview put on the wire. */
    const requestRewind = async (
      vscode: ReturnType<typeof renderChatApp>["vscode"],
      messages: Message[],
      index: number,
    ) => {
      act(() => {
        sendCommand("updateMessages", { messages });
      });
      await waitFor(() => {
        expect(screen.getByText("Message 1")).toBeInTheDocument();
      });
      const buttons = document.querySelectorAll(".message-action-btn");
      expect(buttons.length).toBeGreaterThan(index);
      await act(async () => {
        fireEvent.click(buttons[index] as HTMLElement);
      });
      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));
      });
      const sent = vscode.postMessage.mock.calls
        .map((c) => c[0])
        .find((m) => m.command === "rewindToMessage");
      return sent.requestId as string;
    };

    it("cuts the list at the anchor when the host reports success", async () => {
      const { vscode } = renderChatApp();
      const requestId = await requestRewind(vscode, four(), 1);

      act(() => {
        sendCommand("rewindResult", {
          requestId,
          messageId: "msg-3",
          ok: true,
        });
      });

      const container = document.querySelector(".messages-container")!;
      await waitFor(() => {
        expect(container.textContent).toContain("Message 1");
        expect(container.textContent).not.toContain("Message 2");
        expect(container.textContent).not.toContain("Response 2");
      });
    });

    it("leaves the list untouched when the host reports failure", async () => {
      const { vscode } = renderChatApp();
      const requestId = await requestRewind(vscode, four(), 1);

      act(() => {
        sendCommand("rewindResult", {
          requestId,
          messageId: "msg-3",
          ok: false,
          error: "boom",
        });
      });

      // Nothing was truncated on disk, so the visible list must stay whole.
      expect(screen.getByText("Message 2")).toBeInTheDocument();
      expect(screen.getByText("Response 2")).toBeInTheDocument();
    });

    it("drops a reply whose requestId is not the pending one", async () => {
      const { vscode } = renderChatApp();
      await requestRewind(vscode, four(), 1);

      act(() => {
        // Late reply from a superseded request (or another pane's): consuming
        // it would truncate on an anchor this request never asked for.
        sendCommand("rewindResult", {
          requestId: "rewind-not-mine",
          messageId: "msg-3",
          ok: true,
        });
      });

      expect(screen.getByText("Message 2")).toBeInTheDocument();
    });

    it("keeps the list when a snapshot arrives with keepMessages", async () => {
      const { vscode } = renderChatApp();
      const requestId = await requestRewind(vscode, four(), 1);

      act(() => {
        sendCommand("rewindResult", {
          requestId,
          messageId: "msg-3",
          ok: true,
        });
      });

      act(() => {
        // The rewind snapshot updates the other fields but deliberately ships
        // an empty list: `keepMessages` means "keep what you already cut".
        sendCommand("setInitialState", {
          messages: [],
          keepMessages: true,
          tasks: [],
          isStreaming: false,
          sessions: [],
          configurationData: {
            language: "zh-CN",
            permissionMode: "ask",
          },
        });
      });

      await waitFor(() => {
        expect(screen.getByText("Message 1")).toBeInTheDocument();
      });
      expect(screen.queryByText("Message 2")).not.toBeInTheDocument();
    });
  });
});
