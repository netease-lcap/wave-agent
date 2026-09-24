import { describe, it, expect, vi } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  fireInput,
} from "./test-utils";
import type { Message, TextBlock } from "wave-agent-sdk";

/**
 * Helper: append text to contenteditable input without destroying existing child nodes.
 * Sets selection inside the new text node so handlers that check nodeType work.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  const textNode = document.createTextNode(text);
  input.appendChild(textNode);

  // Set selection inside the new text node
  const range = document.createRange();
  range.setStart(textNode, text.length);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  await fireInput(input, { inputType: "insertText" });
}

describe("Selection Feature (Inline Tags)", () => {
  it("should insert inline selection tag and render it in history", async () => {
    const { vscode } = renderChatApp();

    // 1. Simulate "Add to Wave" command from extension
    const selection = {
      filePath: "/path/to/src/file.ts",
      fileName: "src/file.ts",
      startLine: 10,
      endLine: 20,
      lineCount: 11,
      selectedText: "const x = 1;\nconst y = 2;",
      isEmpty: false,
    };

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "addSelectionToInput", selection },
        }),
      );
    });

    // 2. Verify inline tag is inserted in the input
    await waitFor(() => {
      const inlineTag = document.querySelector(
        '#messageInput .context-tag-container[data-is-selection="true"]',
      );
      expect(inlineTag).toBeInTheDocument();
    });

    const inlineTag = document.querySelector(
      '#messageInput .context-tag-container[data-is-selection="true"]',
    )!;
    expect(inlineTag).toHaveTextContent(/file\.ts#10-20/);

    // Verify old selection tag is NOT visible
    const oldSelectionTag = document.querySelector(".selection-tag");
    expect(oldSelectionTag).not.toBeInTheDocument();

    // 3. Type some text and send
    await typeInInput("Check this code: ");

    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    // 4. Verify the markdown sent to extension
    await waitFor(() => {
      const sent = (
        vscode.postMessage as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0]);
      const sendMsg = sent.find(
        (m: { command: string }) => m.command === "sendMessage",
      );
      expect(sendMsg).toBeDefined();
    });

    const sentMessages = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const sendMessage = sentMessages.find(
      (m: { command: string }) => m.command === "sendMessage",
    ) as Record<string, unknown>;
    expect(sendMessage.text).toContain(
      "[Selection: /path/to/src/file.ts|file.ts#10-20]",
    );
    expect(sendMessage.selection).toBeUndefined();

    // 5. Simulate message in history with selection tag
    const messages: Message[] = [
      {
        id: "msg_sel_inline",
        role: "user",
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text",
            content:
              "Check this code: [Selection: /path/to/src/file.ts|file.ts#10-20]",
          } as TextBlock,
        ],
      },
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    // 6. Verify message rendering
    await waitFor(() => {
      const messageElements = document.querySelectorAll(".message.user");
      expect(messageElements.length).toBeGreaterThan(0);
      const lastMsg = messageElements[messageElements.length - 1];
      const renderedTag = lastMsg.querySelector(".context-tag");
      expect(renderedTag).toBeInTheDocument();
    });

    const messageElements = document.querySelectorAll(".message.user");
    const lastMsg = messageElements[messageElements.length - 1];
    const renderedTag = lastMsg.querySelector(".context-tag")!;
    expect(renderedTag).toHaveTextContent(/file\.ts#10-20/);

    // Verify old block-level reference is NOT visible
    const selectionRef = document.querySelector(".selection-reference");
    expect(selectionRef).not.toBeInTheDocument();

    // 7. Test clicking the tag
    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(renderedTag);
    });

    await waitFor(() => {
      const clickMessages = (
        vscode.postMessage as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0]);
      const openFileMsg = clickMessages.find(
        (m: { command: string }) => m.command === "openFile",
      );
      expect(openFileMsg).toBeDefined();
    });

    const clickMessages = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = clickMessages.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    expect(openFileMsg.path).toBe("/path/to/src/file.ts");
    expect(openFileMsg.startLine).toBe(10);
    expect(openFileMsg.endLine).toBe(20);
  });

  // 回归（缺陷：右键「添加到 CodeWave IDE」点了完全没反应）：
  // lastCaretOffsetRef 只在 blur 时写入、清空输入框时从不重置，而
  // resolveInsertionPoint 一旦快照非 null 就只信它（不回落到实时选区）。
  // 用户打过字 → 光标移出输入框（快照 = 文本末尾）→ 输入框被清空（发送后
  // contenteditable 被清空 / 手动删空）⇒ 快照偏移 > 当前文本长度 ⇒
  // findTextOffset 返回 null ⇒ insertSelectionTag 直接 return，界面上既无
  // 标签、也无 toast / 报错。同一族的 insertUploadedFilePaths 有兜底所以不受影响。
  it("should still insert the tag after the caret snapshot went stale", async () => {
    renderChatApp();

    await typeInInput("hello world");
    const input = screen.getByTestId("message-input");

    // 光标移出输入框：blur 时快照下光标偏移（此刻为 11）
    await act(async () => {
      fireEvent.focusOut(input);
    });

    // 清空输入框（等价于发送后 MessageInput 清空 contenteditable）
    await act(async () => {
      input.replaceChildren();
    });
    expect(input.textContent).toBe("");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "addSelectionToInput",
            selection: {
              filePath: "/path/to/src/file.ts",
              fileName: "src/file.ts",
              startLine: 10,
              endLine: 20,
              lineCount: 11,
              selectedText: "const x = 1;",
              isEmpty: false,
            },
          },
        }),
      );
    });

    await waitFor(() => {
      const inlineTag = document.querySelector(
        '#messageInput .context-tag-container[data-is-selection="true"]',
      );
      expect(inlineTag).toBeInTheDocument();
    });
  });

  it("should be backward compatible with old selection format", async () => {
    const { vscode } = renderChatApp();

    const messages: Message[] = [
      {
        id: "msg_sel_old",
        role: "user",
        timestamp: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "text",
            content: "Old format: [Selection: file.ts#10-20]",
          } as TextBlock,
        ],
      },
    ];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { command: "updateMessages", messages },
        }),
      );
    });

    await waitFor(() => {
      const messageElements = document.querySelectorAll(".message.user");
      expect(messageElements.length).toBeGreaterThan(0);
      const lastMsg = messageElements[messageElements.length - 1];
      const renderedTag = lastMsg.querySelector(".context-tag");
      expect(renderedTag).toBeInTheDocument();
    });

    const messageElements = document.querySelectorAll(".message.user");
    const lastMsg = messageElements[messageElements.length - 1];
    const renderedTag = lastMsg.querySelector(".context-tag")!;
    expect(renderedTag).toHaveTextContent(/file\.ts#10-20/);

    // Test clicking old format (path will be fileName)
    (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
    await act(async () => {
      fireEvent.click(renderedTag);
    });

    await waitFor(() => {
      const clickMessages = (
        vscode.postMessage as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0]);
      const openFileMsg = clickMessages.find(
        (m: { command: string }) => m.command === "openFile",
      );
      expect(openFileMsg).toBeDefined();
    });

    const clickMessages = (
      vscode.postMessage as ReturnType<typeof vi.fn>
    ).mock.calls.map((c) => c[0]);
    const openFileMsg = clickMessages.find(
      (m: { command: string }) => m.command === "openFile",
    ) as Record<string, unknown>;
    expect(openFileMsg).toBeDefined();
    expect(openFileMsg.path).toBe("file.ts");
  });
});
