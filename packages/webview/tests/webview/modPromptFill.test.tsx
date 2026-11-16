import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand, sendHostMessage } from "./test-utils";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { ModPromptFillRequest } from "wave-webview-fixtures";

/**
 * `$.prompt.fill` 的落点（spec `ecosystem/plugin-mods.md`「把草稿填进输入框」）。
 *
 * 这一层钉的是 surface 的两件事：文本真的进了输入框（当草稿、不发送），以及
 * **回执一定发**——填不上也必须答 `{ filled: false }`，否则 mod 只能干等到 5 秒
 * 超时（超时、`isFilled:false` 的上游语义在 SDK 侧）。
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

/** webview→host 的填草稿回执。 */
const fillReplies = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === "modPromptFillResult");

const fillMessage = (
  request: Partial<ModPromptFillRequest> = {},
  overrides: { paneId?: string } = {},
) =>
  fixtures.desktopModPromptFill(
    {
      sessionId: "s1",
      requestId: "fill-1",
      text: "先跑一遍测试",
      mode: "replace",
      ...request,
    },
    overrides,
  );

afterEach(() => {
  delete window.waveHostType;
  vi.useRealTimers();
  sessionUi.prune(new Set());
});

describe("desktop mod $.prompt.fill", () => {
  it("把文本填进输入框当草稿、不发出去，并回 filled: true（场景 1）", () => {
    const { vscode } = renderDesktop();
    expect(input().textContent).toBe("");

    sendHostMessage(fillMessage());

    // 草稿到位，消息没发出去。
    expect(input()).toHaveTextContent("先跑一遍测试");
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    // 回执带 requestId 归到那一次请求上。
    expect(fillReplies(vscode)).toEqual([
      { command: "modPromptFillResult", requestId: "fill-1", filled: true },
    ]);
    // 草稿同步给宿主（切会话/重挂载后还在）。
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: "先跑一遍测试",
      }),
    );
  });

  it("append 接在已有草稿后面，空一行、不覆盖（场景 2）", () => {
    const { vscode } = renderDesktop();
    act(() => {
      input().textContent = "我已经打了一半";
    });

    sendHostMessage(fillMessage({ text: "先跑一遍测试", mode: "append" }));

    // 原文在、建议在后，中间一个 <br> 作换行（`replace` 会把它整份换掉）。
    expect(Array.from(input().childNodes).map((n) => n.nodeName)).toEqual([
      "#text",
      "BR",
      "#text",
    ]);
    expect(input().textContent).toBe("我已经打了一半先跑一遍测试");
    expect(fillReplies(vscode)).toEqual([
      { command: "modPromptFillResult", requestId: "fill-1", filled: true },
    ]);
  });

  it("insert 插在光标处，不是末尾（场景 3）", () => {
    const { vscode } = renderDesktop();
    const div = input();
    act(() => {
      div.textContent = "abcdef";
    });
    const range = document.createRange();
    range.setStart(div.firstChild!, 3);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    sendHostMessage(fillMessage({ text: "XY", mode: "insert" }));

    expect(div.textContent).toBe("abcXYdef");
    expect(fillReplies(vscode)).toEqual([
      { command: "modPromptFillResult", requestId: "fill-1", filled: true },
    ]);
  });

  it("审批卡片占着键时不填，答 filled: false（场景 5）", () => {
    const { vscode } = renderDesktop();
    sendCommand("showConfirmation", {
      confirmationId: "conf_1",
      toolName: "Bash",
      confirmationType: "命令待确认",
      toolInput: { command: "rm -rf build" },
    });

    sendHostMessage(fillMessage());

    // 输入框此刻被 dialog 盖着，填进去用户也看不见 —— 按填不上作答。
    expect(input().textContent).toBe("");
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
    expect(fillReplies(vscode)).toEqual([
      { command: "modPromptFillResult", requestId: "fill-1", filled: false },
    ]);
  });

  it("发给别的 pane 的请求不回执，也不动这个 pane 的输入框", () => {
    const { vscode } = renderDesktop();

    sendHostMessage(fillMessage({}, { paneId: "pane-other" }));

    expect(input().textContent).toBe("");
    expect(fillReplies(vscode)).toEqual([]);
  });
});
