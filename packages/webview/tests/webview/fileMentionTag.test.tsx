import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Helper: type text into the contenteditable message input and set up
 * a selection inside a text node at the end so that selection-change
 * detection works.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  // Set selection at end of the text node (not on the div)
  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    const textNode = input.firstChild;
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  await fireInput(input, { inputType: "insertText" });
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

/**
 * Helper: send a fileSuggestionsResponse message
 */
function sendSuggestionsResponse(
  requestId: string,
  suggestions: unknown[],
  filterText: string,
) {
  act(() => {
    sendCommand("fileSuggestionsResponse", {
      suggestions,
      filterText,
      requestId,
    });
  });
}

/**
 * Helper: select the dropdown item whose visible text contains `label`.
 *
 * The `@` dropdown lists the fixed IDE entries (@终端 / @问题) ahead of file
 * suggestions, so the wanted file is not always at index 0 — walk down to it
 * with the same keys a user presses.
 */
function selectSuggestionByLabel(label: string) {
  const items = Array.from(
    document.querySelectorAll(".file-suggestion-dropdown .suggestion-item"),
  );
  const index = items.findIndex((item) =>
    (item.textContent || "").includes(label),
  );
  if (index < 0) {
    throw new Error(`suggestion "${label}" not found`);
  }
  const input = screen.getByTestId("message-input");
  for (let i = 0; i < index; i++) {
    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
    });
  }
  act(() => {
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  });
}

describe("File Mention Tag Insertion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should insert a visual tag when a file is selected from suggestions", async () => {
    const { vscode } = renderChatApp();

    // Type @ to trigger suggestions
    await typeInInput("@");

    const reqId1 = await waitForFileSuggestionRequest(vscode);

    const fileSuggestion = {
      path: "/workspace/src/components/MessageInput.tsx",
      relativePath: "src/components/MessageInput.tsx",
      name: "MessageInput.tsx",
      extension: "tsx",
      icon: "codicon-file",
      isDirectory: false,
    };

    sendSuggestionsResponse(reqId1, [fileSuggestion], "");

    // Wait for dropdown to render
    await waitFor(() => {
      const dropdown = document.querySelector(".file-suggestion-dropdown");
      expect(dropdown).toBeInTheDocument();
    });

    // Type filter text (append to existing '@')
    await typeInInput("Mess");

    const reqId2 = await waitForFileSuggestionRequest(vscode);
    sendSuggestionsResponse(reqId2, [fileSuggestion], "Mess");

    // Wait for suggestion item to be visible
    await waitFor(() => {
      const items = document.querySelectorAll(
        ".suggestion-item:not(.upload-option)",
      );
      expect(items.length).toBeGreaterThan(0);
    });

    // Select the (only) file suggestion — the fixed IDE entries come first.
    selectSuggestionByLabel("MessageInput.tsx");

    // Check if the tag is inserted into the contenteditable area
    await waitFor(() => {
      const tag = document.querySelector(
        '[data-testid="message-input"] .context-tag',
      );
      expect(tag).toBeInTheDocument();
    });

    const tag = document.querySelector(
      '[data-testid="message-input"] .context-tag',
    )!;
    expect(tag).toHaveTextContent(/MessageInput.tsx/);
    expect(tag).toHaveTextContent(/@/);

    // Check if a space was inserted after the tag
    const innerText = screen.getByTestId("message-input").textContent || "";
    expect(innerText).toContain("MessageInput.tsx");
    expect(innerText).toMatch(/\s$/);
  });

  it("inserts an ordinary file tag for an image file (no preview)", async () => {
    // @ 选中的图片就是普通文件引用（spec ui/file-selector.md 场景 1）：标签不带
    // is-image、点不开，与其它扩展名的文件完全一样。
    const { vscode } = renderChatApp();

    await typeInInput("@");

    await waitForFileSuggestionRequest(vscode);

    await typeInInput("@img");

    const reqId2 = await waitForFileSuggestionRequest(vscode);

    sendSuggestionsResponse(
      reqId2,
      [
        {
          path: "/workspace/images/test.png",
          relativePath: "images/test.png",
          name: "test.png",
          extension: "png",
          icon: "codicon-file-media",
          isDirectory: false,
        },
      ],
      "img",
    );

    await waitFor(() => {
      const items = document.querySelectorAll(
        ".suggestion-item:not(.upload-option)",
      );
      expect(items.length).toBeGreaterThan(0);
    });

    selectSuggestionByLabel("test.png");

    const tag = await waitFor(() => {
      const el = document.querySelector(
        '[data-testid="message-input"] .context-tag',
      );
      expect(el).toBeInTheDocument();
      return el as HTMLElement;
    });
    expect(tag.className).not.toMatch(/is-image/);
    expect(tag.className).not.toMatch(/clickable/);

    act(() => {
      fireEvent.click(tag);
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "previewImage" }),
    );
  });
});
