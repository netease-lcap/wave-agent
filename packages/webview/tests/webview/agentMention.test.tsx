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
import { parseMentions } from "../../src/utils/messageUtils";
import { renderDraftContent } from "../../src/utils/inputDraft";

/**
 * `@` 显式点名子代理（spec multi-agent/subagent.md「用户故事：显式子代理调用」）。
 * 候选由宿主随文件建议一起下发，判据是条目上的 `agentName`。
 */

async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  input.focus();
  const existing = input.textContent || "";
  input.textContent = existing + text;

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

const agentItem = (name: string, description: string) => ({
  path: `agent:${name}`,
  relativePath: "",
  name,
  extension: "",
  icon: "codicon-hubot",
  isDirectory: false,
  agentName: name,
  agentDescription: description,
});

const fileItem = {
  path: "/workspace/src/Explore.ts",
  relativePath: "src/Explore.ts",
  name: "Explore.ts",
  extension: "ts",
  icon: "codicon-file",
  isDirectory: false,
};

function suggestionItems(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(
      ".file-suggestion-dropdown .suggestion-item:not(.suggestion-empty)",
    ),
  );
}

function selectSuggestionByLabel(label: string) {
  const items = suggestionItems();
  const index = items.findIndex((item) =>
    (item.textContent || "").includes(label),
  );
  if (index < 0) throw new Error(`suggestion "${label}" not found`);
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

describe("Agent Mention (@子代理)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists subagents ahead of files and tags the row with data-agent-name", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("@");
    const requestId = await waitForFileSuggestionRequest(vscode);

    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [agentItem("Explore", "只读探索代码库"), fileItem],
        filterText: "",
        requestId,
      });
    });

    await waitFor(() => {
      expect(suggestionItems().length).toBeGreaterThanOrEqual(2);
    });

    const labels = suggestionItems().map((item) => item.textContent || "");
    expect(labels[labels.length - 2]).toContain("Explore");
    expect(labels[labels.length - 1]).toContain("Explore.ts");
    const rows = suggestionItems().filter(
      (item) => item.getAttribute("data-agent-name") === "Explore",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("只读探索代码库");
  });

  it("filters subagents by name and description", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("@");
    await waitForFileSuggestionRequest(vscode);

    await typeInInput("只读");
    const requestId = await waitForFileSuggestionRequest(vscode);
    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [
          agentItem("Explore", "只读探索代码库"),
          agentItem("Plan", "出实现计划"),
        ],
        filterText: "只读",
        requestId,
      });
    });

    await waitFor(() => {
      const names = suggestionItems()
        .map((item) => item.getAttribute("data-agent-name"))
        .filter(Boolean);
      expect(names).toEqual(["Explore"]);
    });
  });

  it("inserts a tag that serializes to [@agent:<name>] and survives a draft reload", async () => {
    const { vscode } = renderChatApp();
    await typeInInput("@");
    const requestId = await waitForFileSuggestionRequest(vscode);
    act(() => {
      sendCommand("fileSuggestionsResponse", {
        suggestions: [agentItem("Explore", "只读探索代码库")],
        filterText: "",
        requestId,
      });
    });

    await waitFor(() => {
      expect(suggestionItems().length).toBeGreaterThan(0);
    });
    selectSuggestionByLabel("Explore");

    await waitFor(() => {
      expect(
        document.querySelector(
          '[data-testid="message-input"] [data-agent-name="Explore"]',
        ),
      ).toBeInTheDocument();
    });

    // 标签可见文本是 @<名称>，标记是给 SDK 看的 `[@agent:<名称>]`
    const tag = document.querySelector(
      '[data-testid="message-input"] .context-tag',
    )!;
    expect(tag).toHaveTextContent("@Explore");

    vscode.postMessage.mockClear();
    fireEvent.click(screen.getByTestId("send-btn"));

    const sent = vscode.postMessage.mock.calls
      .map((c) => c[0])
      .find((m: Record<string, unknown>) => m.command === "sendMessage");
    expect(sent?.text).toBe("[@agent:Explore]");

    // 草稿还原：标记回到输入框时仍是一个整体标签
    const container = document.createElement("div");
    renderDraftContent(container, "[@agent:Explore] 再看一下");
    expect(
      container.querySelector('[data-agent-name="Explore"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("再看一下");
  });

  it("parses the agent marker for the message bubble", () => {
    const parts = parseMentions("帮我 [@agent:Explore] 看看");
    expect(parts.map((part) => part.type)).toEqual(["text", "agent", "text"]);
    expect(parts[1].agentName).toBe("Explore");
  });
});
