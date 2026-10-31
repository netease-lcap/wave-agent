import {
  renderChatApp,
  screen,
  waitFor,
  act,
  fireEvent,
  fireInput,
  sendCommand,
} from "./test-utils";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  assembleIdeContextBlocks,
  ideContextMarker,
} from "../../src/utils/ideContext";
import { MockDataGenerator } from "../fixtures/mockData";

/**
 * IDE 上下文提及（spec `ui/ide-context-mentions.md`）的端到端 webview 行为：
 * 下拉里的固定条目 → 选中插入的标签标记 → 发送时向宿主取内容并拼进正文 →
 * 用户气泡里的标签点开是弹窗预览。格式化细节（清理/截断/上限）在
 * `tests/utils/ideContext.test.ts`，这里只测链路是否接通。
 */

/** 把文本写进 contenteditable 并把光标放到末尾（与 fileMentionTag 同法）。 */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  input.textContent = text;
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  await fireInput(input, { inputType: "insertText" });
}

/** 等宿主的 requestFileSuggestions 到达并取回 requestId。 */
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
  return calls.filter((c) => c.command === "requestFileSuggestions").pop()
    .requestId;
}

/** 取出最近一次 webview→宿主的某类请求。 */
function lastRequest(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
  command: string,
) {
  return vscode.postMessage.mock.calls
    .map((c) => c[0])
    .filter((c) => c.command === command)
    .pop();
}

/** 读出下拉里各项的标题文本（固定条目在前，文件建议在后）。 */
function dropdownTitles(): string[] {
  return Array.from(
    document.querySelectorAll(".file-suggestion-dropdown .suggestion-name"),
  ).map((element) => element.textContent ?? "");
}

/** 键入 `@` → 宿主回一份文件建议（让固定条目与文件建议同屏可比较）。 */
async function openMentionDropdown(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
) {
  await typeInInput("@");
  const requestId = await waitForFileSuggestionRequest(vscode);
  act(() => {
    sendCommand("fileSuggestionsResponse", {
      requestId,
      filterText: "",
      suggestions: [
        {
          path: "/workspace/src/main.ts",
          relativePath: "src/main.ts",
          name: "main.ts",
          extension: "ts",
          icon: "codicon-file",
          isDirectory: false,
        },
      ],
    });
  });
  await waitFor(() => {
    expect(dropdownTitles().length).toBeGreaterThan(0);
  });
}

/** 在下拉里选中指定条目（用键盘 Enter，与真实操作一致）。 */
async function selectSuggestion(label: string) {
  const index = dropdownTitles().indexOf(label);
  expect(index).toBeGreaterThanOrEqual(0);
  const input = screen.getByTestId("message-input");
  act(() => {
    for (let i = 0; i < index; i++) {
      fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
    }
  });
  act(() => {
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  });
  await waitFor(() => {
    expect(
      document.querySelector(
        '[data-testid="message-input"] [data-ide-context]',
      ),
    ).toBeInTheDocument();
  });
}

describe("IDE 上下文提及", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("下拉里 Terminal / Problems 排在文件建议之前，选中后插入标记标签", async () => {
    const { vscode } = renderChatApp();
    await openMentionDropdown(vscode);

    expect(dropdownTitles().slice(0, 2)).toEqual(["Terminal", "Problems"]);
    expect(dropdownTitles()).toContain("main.ts");

    await selectSuggestion("Terminal");

    const tag = document.querySelector(
      '[data-testid="message-input"] [data-ide-context="terminal"]',
    )!;
    expect(tag).toHaveTextContent("Terminal");
    // 正文里的载体是 `data-ide-context`（`convertToMarkdown` 据此写出裸标记），
    // 内容此刻还不存在，发送时才向宿主取。
    expect(tag.getAttribute("data-ide-context")).toBe("terminal");
    expect(tag.getAttribute("data-path")).toBe("ide:terminal");
  });

  it("发送时向宿主请求内容，回复后拼进消息正文", async () => {
    const { vscode } = renderChatApp();
    await openMentionDropdown(vscode);
    await selectSuggestion("Terminal");

    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    const request = await waitFor(() => {
      const call = lastRequest(vscode, "requestIdeContext");
      expect(call).toBeDefined();
      return call;
    });
    expect(request.providers).toEqual(["terminal"]);

    act(() => {
      sendCommand("ideContextResponse", {
        requestId: request.requestId,
        results: [
          {
            provider: "terminal",
            ok: true,
            terminalText: "$ pnpm build\n构建失败了",
          },
        ],
      });
    });

    const sent = await waitFor(() => {
      const call = lastRequest(vscode, "sendMessage");
      expect(call).toBeDefined();
      return call;
    });
    expect(sent.text).toContain("终端输出");
    expect(sent.text).toContain("$ pnpm build\n构建失败了");
  });

  it("宿主读到空/不可用时把说明写进正文，消息照常发出", async () => {
    const { vscode } = renderChatApp();
    await openMentionDropdown(vscode);
    await selectSuggestion("Problems");

    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    const request = await waitFor(() => {
      const call = lastRequest(vscode, "requestIdeContext");
      expect(call).toBeDefined();
      return call;
    });

    act(() => {
      sendCommand("ideContextResponse", {
        requestId: request.requestId,
        results: [
          { provider: "problems", ok: false, reason: "没有活动编辑器" },
        ],
      });
    });

    const sent = await waitFor(() => {
      const call = lastRequest(vscode, "sendMessage");
      expect(call).toBeDefined();
      return call;
    });
    expect(sent.text).toContain("当前文件的问题不可用：没有活动编辑器");
  });

  it("用户气泡里是标签，点开是弹窗预览（内容来自消息正文）", async () => {
    renderChatApp();

    const text = assembleIdeContextBlocks(
      `看下构建输出\n${ideContextMarker("terminal")}`,
      [
        {
          provider: "terminal",
          ok: true,
          terminalText: "$ pnpm build\n构建失败了",
        },
      ],
    );
    act(() => {
      sendCommand("updateMessages", {
        messages: [MockDataGenerator.createUserMessage(text)],
      });
    });

    const chip = await waitFor(() => {
      const element = document.querySelector(
        '[data-testid="messages-container"] [data-path="ide:terminal"]',
      );
      expect(element).toBeInTheDocument();
      return element as HTMLElement;
    });
    expect(chip).toHaveTextContent("Terminal");
    // 标签内部不是展开的正文：内容只在弹窗里出现。
    expect(chip).not.toHaveTextContent("pnpm build");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    act(() => {
      fireEvent.click(chip);
    });

    const dialog = await waitFor(() => {
      const element = screen.getByRole("dialog");
      expect(element).toBeInTheDocument();
      return element;
    });
    // 弹窗标题是英文名，正文首行仍是块标题——两者同名会让同一个词出现两次。
    expect(
      dialog.querySelector(".ide-context-preview-title"),
    ).toHaveTextContent("Terminal");
    expect(dialog).toHaveTextContent("终端输出");
    expect(dialog).toHaveTextContent("$ pnpm build");

    act(() => {
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("桌面端（没有编辑器可读）不出现固定条目", async () => {
    const win = window as unknown as Record<string, unknown>;
    win.waveHostType = "desktop";
    try {
      const { vscode } = renderChatApp();
      await typeInInput("@");
      const requestId = await waitForFileSuggestionRequest(vscode);
      act(() => {
        sendCommand("fileSuggestionsResponse", {
          requestId,
          filterText: "",
          suggestions: [
            {
              path: "/workspace/src/main.ts",
              relativePath: "src/main.ts",
              name: "main.ts",
              extension: "ts",
              icon: "codicon-file",
              isDirectory: false,
            },
          ],
        });
      });
      await waitFor(() => {
        expect(dropdownTitles()).toContain("main.ts");
      });
      expect(dropdownTitles()).not.toContain("Terminal");
      expect(dropdownTitles()).not.toContain("Problems");
    } finally {
      delete win.waveHostType;
    }
  });
});
