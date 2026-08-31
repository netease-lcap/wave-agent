import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

describe("Clear Chat Functionality", () => {
  it("should clear all messages except welcome message", () => {
    renderChatApp();

    const conversation = MockDataGenerator.createSampleConversation();
    act(() => {
      sendCommand("updateMessages", { messages: conversation });
    });

    // Verify messages are present (4 conversation)
    const messages = document.querySelectorAll(".messages-container .message");
    expect(messages.length).toBe(4);

    // Clear chat
    act(() => {
      sendCommand("updateMessages", { messages: [] });
    });

    // Verify welcome view is shown (empty + authenticated)
    expect(screen.getByTestId("welcome-wordmark")).toBeInTheDocument();
  });

  it("should request clear chat via header button", () => {
    const { vscode } = renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("Test message 1"),
          MockDataGenerator.createAssistantMessage("Response 1"),
          MockDataGenerator.createUserMessage("Test message 2"),
        ],
      });
    });

    // Clear message log to track new commands
    vscode.postMessage.mockClear();

    // Click the new session button
    const newSessionBtn = screen.getByTestId("new-session-btn");
    act(() => {
      fireEvent.click(newSessionBtn);
    });

    // Verify clear chat command is sent to the host (in-place clear)
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "clearChat" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "newChatTab" }),
    );

    // Webview does not clear messages locally; the host clears via updateMessages
    const messages = document.querySelectorAll(".messages-container .message");
    expect(messages.length).toBe(3);
  });

  it("should still send clearChat via the /clear slash command", async () => {
    const { vscode } = renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("Hello"),
          MockDataGenerator.createAssistantMessage("Hi!"),
        ],
      });
    });

    vscode.postMessage.mockClear();

    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "/clear";
    });
    await fireInput(input, { data: "/clear", inputType: "insertText" });

    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // /clear keeps its in-place clear semantics and is not sent to the agent as a message
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "clearChat" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "newChatTab" }),
    );
  });

  it("should reset input state after clearing", async () => {
    renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("Hello"),
          MockDataGenerator.createAssistantMessage("Hi!"),
        ],
      });
    });

    // Type something in input
    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "This text should be preserved";
    });
    await fireInput(input, {
      data: input.textContent,
      inputType: "insertText",
    });

    // Clear chat
    act(() => {
      sendCommand("updateMessages", { messages: [] });
    });

    // Input text should be preserved (clearing messages doesn't clear input)
    expect(input.textContent).toBe("This text should be preserved");

    // Send button should be present (not streaming); abort button should not be rendered
    const sendBtn = screen.getByTestId("send-btn");
    expect(sendBtn).toBeInTheDocument();

    expect(screen.queryByTestId("abort-btn")).not.toBeInTheDocument();
  });

  it("should disable new session button during streaming while extension can still clear", () => {
    const { vscode } = renderChatApp();

    // Start streaming and add a message
    act(() => {
      sendCommand("startStreaming");
      sendCommand("updateMessages", {
        messages: [
          {
            id: "msg_streaming_clear",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "This is being streamed..." }],
          },
        ],
      });
    });

    // Verify abort button is visible (streaming active)
    const abortBtn = screen.getByTestId("abort-btn");
    expect(abortBtn).toBeInTheDocument();

    // New session button is disabled during streaming (prevents clearing an in-progress generation)
    const newSessionBtn = screen.getByTestId("new-session-btn");
    expect(newSessionBtn).toBeDisabled();

    // Clear message log
    vscode.postMessage.mockClear();

    // Clicking the disabled button during streaming does nothing
    act(() => {
      fireEvent.click(newSessionBtn);
    });
    expect(vscode.postMessage).not.toHaveBeenCalled();
    expect(
      document.querySelectorAll(".messages-container .message").length,
    ).toBe(1);

    // But extension can still clear messages via command
    act(() => {
      sendCommand("updateMessages", { messages: [] });
    });

    // Verify chat is cleared (welcome view shown) but streaming state is preserved
    expect(screen.getByTestId("welcome-wordmark")).toBeInTheDocument();

    // Streaming state should still be active (abort button still present)
    expect(abortBtn).toBeInTheDocument();

    // End streaming separately
    act(() => {
      sendCommand("endStreaming");
    });
    expect(screen.queryByTestId("abort-btn")).not.toBeInTheDocument();
  });

  it("should clear error messages", () => {
    renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("Help me with this"),
          MockDataGenerator.createErrorMessage("Something went wrong"),
        ],
      });
    });

    // Verify messages and error are present
    const messages = document.querySelectorAll(".messages-container .message");
    expect(messages.length).toBe(2); // user + error

    const messagesContainer = screen.getByTestId("messages-container");
    expect(messagesContainer).toHaveTextContent("Something went wrong");

    // Clear chat
    act(() => {
      sendCommand("updateMessages", { messages: [] });
    });

    // Verify welcome view is shown
    expect(screen.getByTestId("welcome-wordmark")).toBeInTheDocument();

    // Error message should no longer be visible
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("should allow new conversation after clearing", async () => {
    const { vscode } = renderChatApp();

    // Have a conversation
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("Old conversation"),
          MockDataGenerator.createAssistantMessage("Old response"),
        ],
      });
    });

    // Clear it
    act(() => {
      sendCommand("updateMessages", { messages: [] });
    });

    // Verify cleared (welcome view shown)
    expect(screen.getByTestId("welcome-wordmark")).toBeInTheDocument();

    // Clear message log
    vscode.postMessage.mockClear();

    // Start new conversation — type and send
    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "New conversation after clear";
    });
    await fireInput(input, {
      data: input.textContent,
      inputType: "insertText",
    });

    const sendBtn = screen.getByTestId("send-btn");
    act(() => {
      fireEvent.click(sendBtn);
    });

    // Verify new message was sent
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "sendMessage",
        text: "New conversation after clear",
      }),
    );

    // Simulate response
    act(() => {
      sendCommand("updateMessages", {
        messages: [
          MockDataGenerator.createUserMessage("New conversation after clear"),
          MockDataGenerator.createAssistantMessage("Fresh start!"),
        ],
      });
    });

    // Verify new conversation
    const messages = document.querySelectorAll(".messages-container .message");
    expect(messages.length).toBe(2); // new user + new assistant

    const messagesContainer = screen.getByTestId("messages-container");
    expect(messagesContainer).toHaveTextContent("New conversation after clear");
    expect(messagesContainer).toHaveTextContent("Fresh start!");

    // Should not contain old conversation content
    expect(messagesContainer).not.toHaveTextContent("Old conversation");
    expect(messagesContainer).not.toHaveTextContent("Old response");
  });
});
