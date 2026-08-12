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
 * Helper: type text into the contenteditable message input and set up
 * a selection at the end so that selection-change detection works.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  input.textContent = text;

  // Set up selection at end of content
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  await fireInput(input);
}

/**
 * Helper: wait for requestFileSuggestions and return the requestId
 */
async function waitForFileSuggestionRequest(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
): Promise<string> {
  await waitFor(
    () => {
      expect(vscode.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ command: "requestFileSuggestions" }),
      );
    },
    { timeout: 3000 },
  );

  const calls = vscode.postMessage.mock.calls.map((c) => c[0]);
  const requestCall = calls
    .filter((c) => c.command === "requestFileSuggestions")
    .pop();
  return requestCall.requestId;
}

describe("File Mention Feature (@)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show file suggestion dropdown when typing @", async () => {
    const { vscode } = renderChatApp();

    // Type @ symbol to trigger file suggestions
    await typeInInput("@");

    // Wait for the debounced requestFileSuggestions request
    const reqId = await waitForFileSuggestionRequest(vscode);

    // Simulate response with suggestions
    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src",
            relativePath: "src",
            name: "src",
            extension: "",
            icon: "codicon-folder",
            isDirectory: true,
          },
          {
            path: "/workspace/src/components/MessageInput.tsx",
            relativePath: "src/components/MessageInput.tsx",
            name: "MessageInput.tsx",
            extension: "tsx",
            icon: "codicon-file",
            isDirectory: false,
          },
          {
            path: "/workspace/src/components/ChatApp.tsx",
            relativePath: "src/components/ChatApp.tsx",
            name: "ChatApp.tsx",
            extension: "tsx",
            icon: "codicon-file",
            isDirectory: false,
          },
        ],
        filterText: "",
        requestId: reqId,
      });
    });

    // Wait for suggestions to render
    await waitFor(() => {
      const dropdown = document.querySelector(".file-suggestion-dropdown");
      expect(dropdown).toBeInTheDocument();
    });

    // Check for suggestion items
    const suggestionItems = document.querySelectorAll(".suggestion-item");
    // Expect to see only the suggestions we injected (1 folder + 2 files) = 3.
    // The upload option is no longer shown in the @ mention dropdown.
    expect(suggestionItems.length).toBe(3);

    // Verify there is no upload option in the @ mention dropdown
    const uploadOption = document.querySelector(
      ".suggestion-item.upload-option",
    );
    expect(uploadOption).toBeNull();
  });

  it("should filter files as user types after @", async () => {
    const { vscode } = renderChatApp();

    // Type @src to filter
    await typeInInput("@src");

    // Wait for the debounced requestFileSuggestions request
    const reqId = await waitForFileSuggestionRequest(vscode);

    // Mock filtered response with captured requestId
    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src/components/MessageInput.tsx",
            relativePath: "src/components/MessageInput.tsx",
            name: "MessageInput.tsx",
            extension: "tsx",
            icon: "codicon-react",
          },
        ],
        filterText: "src",
        requestId: reqId,
      });
    });

    // Wait for suggestion to render
    await waitFor(() => {
      const items = document.querySelectorAll(".suggestion-item");
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll(".suggestion-item");
    expect(suggestionItems.length).toBe(1);

    // Should only show filtered results (no upload option when there's filter text)
    const uploadOption = document.querySelector(
      ".suggestion-item.upload-option",
    );
    expect(uploadOption).toBeNull();

    // Verify the suggestion text contains the filter
    expect(suggestionItems[0]).toHaveTextContent(/src/);
  });

  it("should insert the file tag on mouse click even when selection is on the popup item", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("@src");

    const reqId = await waitForFileSuggestionRequest(vscode);

    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src/components/MessageInput.tsx",
            relativePath: "src/components/MessageInput.tsx",
            name: "MessageInput.tsx",
            extension: "tsx",
            icon: "codicon-react",
          },
        ],
        filterText: "src",
        requestId: reqId,
      });
    });

    await waitFor(() => {
      expect(document.querySelectorAll(".suggestion-item").length).toBe(1);
    });

    // Real browsers leave the selection on the popup item after a mouse click
    // (the input's text node no longer holds the caret), which made the old
    // getSelection()-based handleFileSelect silently no-op — the same mouse-click
    // condition fixed for slash commands.
    const suggestionItem = document.querySelector(
      ".suggestion-item",
    ) as Element;
    const range = document.createRange();
    range.selectNodeContents(suggestionItem);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    await act(async () => {
      fireEvent.click(suggestionItem);
    });

    // The tag must be inserted on the first click (previously the input stayed
    // "@src" because the selection was no longer inside the input's text node).
    await waitFor(() => {
      expect(input.querySelector(".context-tag")).toBeInTheDocument();
    });
    const tag = input.querySelector(".context-tag")!;
    expect(tag).toHaveTextContent(/MessageInput.tsx/);
    expect(tag).toHaveTextContent(/@/);

    // The "@src" mention text must be replaced (not left behind), and a space
    // is inserted after the tag.
    expect(input.textContent).not.toContain("@src");
    expect(input.textContent).toContain("MessageInput.tsx");
    expect(input.textContent).toMatch(/\s$/);

    // The popup closes after selection.
    expect(
      document.querySelector(".file-suggestion-dropdown"),
    ).not.toBeInTheDocument();
  });

  it("should replace the '@' mention, not insert the tag before it, when the click handler resets the caret to the start", async () => {
    const { vscode } = renderChatApp();

    const input = screen.getByTestId("message-input");
    input.focus();

    await typeInInput("@src");

    const reqId = await waitForFileSuggestionRequest(vscode);

    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          {
            path: "/workspace/src/components/MessageInput.tsx",
            relativePath: "src/components/MessageInput.tsx",
            name: "MessageInput.tsx",
            extension: "tsx",
            icon: "codicon-react",
          },
        ],
        filterText: "src",
        requestId: reqId,
      });
    });

    await waitFor(() => {
      expect(document.querySelectorAll(".suggestion-item").length).toBe(1);
    });

    // Real browsers reset the caret to the start of the input (offset 0) when
    // focus() runs after the input lost focus to the popup item. jsdom's
    // focus() keeps the existing selection, so simulate the real post-focus
    // state directly: selection collapsed inside the input's text node at 0.
    // With a zero-length range the old getSelection() path computed
    // start=end={node, 0} → nothing deleted → the tag landed *before* the '@'.
    const textNode = Array.from(input.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE,
    ) as Text;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    await act(async () => {
      fireEvent.click(document.querySelector(".suggestion-item")!);
    });

    await waitFor(() => {
      expect(input.querySelector(".context-tag")).toBeInTheDocument();
    });

    // The "@src" must be fully replaced by the tag — no stray '@' or leftover
    // mention text may remain in front of the tag.
    expect(input.textContent).not.toContain("@src");
    expect(input.textContent).toContain("MessageInput.tsx");
    expect(input.textContent).toMatch(/\s$/);

    expect(
      document.querySelector(".file-suggestion-dropdown"),
    ).not.toBeInTheDocument();
  });
});
