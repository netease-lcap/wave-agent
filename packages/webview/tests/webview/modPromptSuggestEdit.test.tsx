import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendHostMessage, setInputText } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPromptSuggestRequest } from "wave-webview-fixtures";

/**
 * `prompt.suggest` / `prompt.edit` / `ui.focus` 的落点（spec
 * `ecosystem/plugin-mods.md`「输入框里的建议与焦点」）。
 *
 * 这一层钉的是 surface 上的三件事：建议摆成暗字且**一定作答**、用户的每次编辑
 * 都报给宿主（带前缀/后缀差值）、插件改写的结果只套在**最后一次**编辑上。
 * 钩子链、`next(e)` 语义、超时都在 SDK 侧。
 */

function renderDesktop() {
  window.waveHostType = "desktop";
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(fixtures.desktopWorkdirState({ workdir: "/work/a" }));
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const input = () => screen.getByTestId("message-input");

const posts = (vscode: ReturnType<typeof createMockVscode>, command: string) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === command);

const suggestMessage = (
  request: Partial<ModPromptSuggestRequest> = {},
  overrides: { paneId?: string } = {},
) =>
  fixtures.desktopModPromptSuggest(
    {
      sessionId: "s1",
      requestId: "suggest-1",
      text: "请先跑一遍测试",
      plugin: "wave",
      ...request,
    },
    overrides,
  );

afterEach(() => {
  delete window.waveHostType;
  vi.useRealTimers();
  sessionUi.prune(new Set());
});

describe("desktop mod prompt.suggest", () => {
  it("把建议摆成暗字并回 isShown: true；按 Tab 采纳进草稿、建议消失（场景 11）", async () => {
    const { vscode } = renderDesktop();
    expect(input().textContent).toBe("");

    sendHostMessage(suggestMessage());

    const ghost = screen.getByTestId("mod-suggestion");
    expect(ghost).toHaveTextContent("请先跑一遍测试");
    expect(posts(vscode, "modPromptSuggestResult")).toEqual([
      {
        command: "modPromptSuggestResult",
        requestId: "suggest-1",
        isShown: true,
      },
    ]);
    // 建议只是提议：草稿还是空的，什么都没发出去。
    expect(input().textContent).toBe("");

    await act(async () => {
      input().dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    // 采纳 = 变成草稿（光标在后面，可以接着打），建议同时收走。
    expect(input()).toHaveTextContent("请先跑一遍测试");
    expect(screen.queryByTestId("mod-suggestion")).toBeNull();
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: "请先跑一遍测试",
      }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("草稿里已有字时摆不上，仍然作答 isShown: false", async () => {
    const { vscode } = renderDesktop();
    await setInputText(input(), "已经在打了");

    sendHostMessage(suggestMessage());

    expect(screen.queryByTestId("mod-suggestion")).toBeNull();
    expect(posts(vscode, "modPromptSuggestResult")).toEqual([
      {
        command: "modPromptSuggestResult",
        requestId: "suggest-1",
        isShown: false,
      },
    ]);
  });

  it("空白建议摆不上", () => {
    const { vscode } = renderDesktop();
    sendHostMessage(suggestMessage({ text: "   " }));

    expect(screen.queryByTestId("mod-suggestion")).toBeNull();
    expect(posts(vscode, "modPromptSuggestResult")).toEqual([
      {
        command: "modPromptSuggestResult",
        requestId: "suggest-1",
        isShown: false,
      },
    ]);
  });
});

describe("desktop mod prompt.edit", () => {
  it("用户打完字上报一次编辑：带编辑前的正文、光标与被替换的那一段（场景 10）", async () => {
    const { vscode } = renderDesktop();
    await setInputText(input(), "hello");

    const edits = posts(vscode, "modPromptEdit");
    expect(edits).toHaveLength(1);
    expect(edits[0]).toMatchObject({
      text: "",
      cursor: 0,
      start: 0,
      end: 0,
      inputText: "hello",
    });
    expect(typeof edits[0].requestId).toBe("string");
  });

  it("插件的改写套回输入框，光标落在改写后的位置", async () => {
    const { vscode } = renderDesktop();
    await setInputText(input(), "helo");
    const requestId = posts(vscode, "modPromptEdit")[0].requestId as string;

    await act(async () => {
      sendHostMessage({
        command: "modPromptEditResult",
        requestId,
        text: "hello",
        cursor: 5,
      });
    });

    expect(input()).toHaveTextContent("hello");
    // 改写也要同步给宿主，否则切会话回来又变回被改写前的那份。
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: "hello",
      }),
    );
  });

  it("晚到的旧回执（不是最后一次编辑）不套用", async () => {
    const { vscode } = renderDesktop();
    await setInputText(input(), "a");
    const first = posts(vscode, "modPromptEdit")[0].requestId as string;
    await setInputText(input(), "ab");

    await act(async () => {
      sendHostMessage({
        command: "modPromptEditResult",
        requestId: first,
        text: "旧结果",
        cursor: 3,
      });
    });

    expect(input()).not.toHaveTextContent("旧结果");
    expect(input().textContent).toBe("ab");
  });
});

describe("desktop mod ui.focus", () => {
  it("焦点落在输入框上时报一次 Composer（场景 10）", async () => {
    const { vscode } = renderDesktop();
    // 输入框挂载时会自动聚焦一次；先移走再点回来，才是一次「用户的落点」。
    await act(async () => {
      input().blur();
    });
    vscode.postMessage.mockClear();

    await act(async () => {
      input().focus();
    });

    expect(posts(vscode, "uiFocus")).toEqual([
      expect.objectContaining({
        command: "uiFocus",
        component: "Composer",
        requestId: "composer",
      }),
    ]);
  });
});
