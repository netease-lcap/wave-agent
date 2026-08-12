import {
  renderChatApp,
  screen,
  waitFor,
  act,
  sendCommand,
  fireInput,
  fireEvent,
} from "./test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Place the caret at a flat character offset inside the message input.
 */
function setCaret(input: HTMLElement, offset: number) {
  const selection = window.getSelection()!;
  const range = document.createRange();
  range.setStart(input.firstChild!, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("Async tag insertion (upload success / selection tag)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should insert uploaded file tag at the pre-blur caret position, not the input start", async () => {
    renderChatApp();
    const input = screen.getByTestId("message-input");
    input.focus();

    input.textContent = "hello world";
    await fireInput(input);

    // Caret in the middle of the text: "hello| world"
    setCaret(input, 5);

    // The input loses focus while the upload flow is in flight (the system
    // file picker steals focus) — the caret position must be remembered here.
    fireEvent.blur(input);

    // Real browsers reset the caret to the start on focus(); simulate that
    // state before the async host message arrives.
    setCaret(input, 0);

    act(() => {
      sendCommand("uploadSuccess", {
        uploadedFiles: ["src/components/MessageInput.tsx"],
      });
    });

    await waitFor(() => {
      expect(input.querySelector(".context-tag")).toBeInTheDocument();
    });

    // The tag must land between "hello " and "world", not at the input start
    // (where the browser reset the caret).
    const text = input.textContent!;
    expect(text.indexOf("MessageInput.tsx")).toBeGreaterThan(
      text.indexOf("hello"),
    );
    expect(text.indexOf("world")).toBeGreaterThan(
      text.indexOf("MessageInput.tsx"),
    );
  });

  it("should insert selection tag at the pre-blur caret position", async () => {
    renderChatApp();
    const input = screen.getByTestId("message-input");
    input.focus();

    input.textContent = "hello world";
    await fireInput(input);

    setCaret(input, 5);
    fireEvent.blur(input);

    // Real browsers reset the caret to the start on focus()
    setCaret(input, 0);

    act(() => {
      sendCommand("addSelectionToInput", {
        selection: {
          fileName: "App.tsx",
          filePath: "src/App.tsx",
          startLine: 1,
          endLine: 3,
        },
      });
    });

    await waitFor(() => {
      expect(input.querySelector(".context-tag")).toBeInTheDocument();
    });

    const text = input.textContent!;
    expect(text.indexOf("App.tsx")).toBeGreaterThan(text.indexOf("hello"));
    expect(text.indexOf("world")).toBeGreaterThan(text.indexOf("App.tsx"));
  });
});
