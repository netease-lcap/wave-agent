import { describe, it, expect, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  fireInput,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * Helper: set contenteditable text and fire input event
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input, { inputType: "insertText" });
}

describe("Bang Command", () => {
  it("should send bang command when input starts with !", async () => {
    const { vscode } = renderChatApp();
    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();

    // Type and send a bang command
    await typeInInput("!ls -la");
    await act(async () => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // Verify message was sent to extension
    const sentMessages = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const sendMessage = sentMessages.find(
      (m: { command: string }) => m.command === "sendMessage",
    );
    expect(sendMessage).toBeDefined();
    expect(sendMessage.text).toBe("!ls -la");
  });

  it("should display bang output as a user-message tool block", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createBangMessage(
        "ls -la",
        "total 0\ndrwxr-xr-x  2 user  group  64 Mar 30 10:00 .",
        false,
        0,
      ),
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    // Bang output renders via the generic bash tool block display.
    await waitFor(() => {
      const bangBlock = document.querySelector(".bash-command-unified");
      expect(bangBlock).toBeInTheDocument();
    });

    const bangBlock = document.querySelector(".bash-command-unified")!;
    const cmdEl = bangBlock.querySelector(".bash-command");
    expect(cmdEl).toHaveTextContent("ls -la");

    const outputEl = bangBlock.querySelector(".bash-command-output");
    expect(outputEl).toHaveTextContent(/total 0/);
  });

  it("should handle long output with scrolling", async () => {
    renderChatApp();

    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const messages = [
      MockDataGenerator.createBangMessage("seq 1 20", longOutput, false, 0),
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    await waitFor(() => {
      const output = document.querySelector(
        ".bash-command-unified .bash-command-output",
      );
      expect(output).toBeInTheDocument();
    });

    const output = document.querySelector(
      ".bash-command-unified .bash-command-output",
    )!;
    expect(output).toHaveTextContent("line 1");
    expect(output).toHaveTextContent("line 20");
  });

  it("should show failure exit code in the result", async () => {
    renderChatApp();

    const messages = [
      MockDataGenerator.createBangMessage("false", "", false, 1),
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    await waitFor(() => {
      const output = document.querySelector(
        ".bash-command-unified .bash-command-output",
      );
      expect(output).toHaveTextContent(/\[exit code: 1\]/);
    });
  });

  it("should show success output with no exit-code prefix", async () => {
    renderChatApp();

    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const messages = [
      MockDataGenerator.createBangMessage("seq 1 20", longOutput, false, 0),
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    await waitFor(() => {
      const output = document.querySelector(
        ".bash-command-unified .bash-command-output",
      );
      expect(output).toBeInTheDocument();
      expect(output).toHaveTextContent("line 1");
      expect(output).toHaveTextContent("line 20");
      expect(output).not.toHaveTextContent("[exit code: 0]");
    });
  });
});
