import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { Message } from "../../src/components/Message";
import { createMockVscode, sendHostMessage } from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import { sessionUi } from "../../src/utils/sessionUiStore";
import { fixtures } from "wave-webview-fixtures";
import type { Message as MessageType } from "../../src/types";

/**
 * 三个 mod 小件在 surface 这一侧的行为（spec `ecosystem/plugin-mods.md`
 * 「工具行下面的一行」「输入框里现在有什么」「剪贴板与视图」）：
 *
 * - `$.ui.notice` 贴在工具块下面（按 tool_use id）；
 * - `$.prompt.read` 读的是输入框此刻的内容，**一定作答**；
 * - `$.ui.copy` 写剪贴板，成功与失败都回执。
 */

function renderDesktop() {
  window.waveHostType = "desktop";
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(fixtures.desktopWorkdirState({ workdir: "/work/a" }));
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const replies = (
  vscode: ReturnType<typeof createMockVscode>,
  command: string,
) =>
  vscode.postMessage.mock.calls
    .map(([msg]) => msg as Record<string, unknown>)
    .filter((m) => m.command === command);

afterEach(() => {
  delete window.waveHostType;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionUi.prune(new Set());
});

describe("$.ui.notice 贴在工具块下面", () => {
  const message = (id: string) =>
    ({
      id: "msg-notice-1",
      role: "assistant",
      blocks: [{ type: "tool", name: "Bash", id, stage: "end", success: true }],
    }) as unknown as MessageType;

  it("按 tool_use id 落到对应的工具块下面", () => {
    const vscode = createMockVscode();
    render(
      <Message
        message={message("tool-1")}
        vscode={vscode}
        modNotices={{ "tool-1": "3 个文件被改动" }}
      />,
    );

    expect(screen.getByTestId("tool-notice")).toHaveTextContent(
      "3 个文件被改动",
    );
  });

  it("没有这个 id 的 notice 不落到这个工具块上", () => {
    const vscode = createMockVscode();
    render(
      <Message
        message={message("tool-1")}
        vscode={vscode}
        modNotices={{ "tool-2": "别人的" }}
      />,
    );

    expect(screen.queryByTestId("tool-notice")).toBeNull();
  });

  it("desktopModNotice 贴到对应工具块下面，text: null 撤掉那一行", () => {
    const { vscode } = renderDesktop();
    const message = MockDataGenerator.createAssistantMessageWithTool(
      "跑一下测试",
      "Bash",
      '{"command":"pnpm test"}',
      "ok",
    );
    const toolUseId = (message.blocks[1] as { id: string }).id;
    sendHostMessage(fixtures.updateMessages([message]));

    sendHostMessage(
      fixtures.desktopModNotice({
        sessionId: "s1",
        plugin: "todo",
        toolUseId,
        text: "3 个文件被改动",
      }),
    );
    expect(screen.getByTestId("tool-notice")).toHaveTextContent(
      "3 个文件被改动",
    );

    // 修饰符不必自己擦：宿主重发一次 text: null 就撤掉。
    sendHostMessage(
      fixtures.desktopModNotice({
        sessionId: "s1",
        plugin: "todo",
        toolUseId,
        text: null,
      }),
    );
    expect(screen.queryByTestId("tool-notice")).toBeNull();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "modNotice" }),
    );
  });
});

describe("desktop mod $.prompt.read", () => {
  it("把输入框此刻的内容与光标报回去", () => {
    const { vscode } = renderDesktop();
    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "我已经打了一半";
    });
    // 光标停在第二个字后面：读到的是它，不是末尾。
    const range = document.createRange();
    range.setStart(input.firstChild!, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    sendHostMessage(
      fixtures.desktopModPromptRead({
        sessionId: "s1",
        requestId: "read-1",
      }),
    );

    expect(replies(vscode, "modPromptReadResult")).toEqual([
      {
        command: "modPromptReadResult",
        requestId: "read-1",
        text: "我已经打了一半",
        cursor: 2,
      },
    ]);
  });

  it("光标不在输入框里时按末尾算", () => {
    const { vscode } = renderDesktop();
    act(() => {
      screen.getByTestId("message-input").textContent = "abc";
    });
    window.getSelection()!.removeAllRanges();

    sendHostMessage(
      fixtures.desktopModPromptRead({ sessionId: "s1", requestId: "read-4" }),
    );

    expect(replies(vscode, "modPromptReadResult")).toEqual([
      {
        command: "modPromptReadResult",
        requestId: "read-4",
        text: "abc",
        cursor: 3,
      },
    ]);
  });

  it("空输入框也作答（读不到不是沉默的理由）", () => {
    const { vscode } = renderDesktop();

    sendHostMessage(
      fixtures.desktopModPromptRead({ sessionId: "s1", requestId: "read-2" }),
    );

    expect(replies(vscode, "modPromptReadResult")).toEqual([
      {
        command: "modPromptReadResult",
        requestId: "read-2",
        text: "",
        cursor: 0,
      },
    ]);
  });

  it("发给别的 pane 的请求不回执", () => {
    const { vscode } = renderDesktop();

    sendHostMessage(
      fixtures.desktopModPromptRead(
        { sessionId: "s1", requestId: "read-3" },
        { paneId: "pane-other" },
      ),
    );

    expect(replies(vscode, "modPromptReadResult")).toEqual([]);
  });
});

describe("desktop mod $.ui.copy", () => {
  it("写进剪贴板后回答 isCopied: true", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { platform: "", clipboard: { writeText } });
    const { vscode } = renderDesktop();

    sendHostMessage(
      fixtures.desktopModCopy({
        sessionId: "s1",
        requestId: "copy-1",
        text: "复制我",
      }),
    );

    await act(async () => {});
    expect(writeText).toHaveBeenCalledWith("复制我");
    expect(replies(vscode, "modCopyResult")).toEqual([
      { command: "modCopyResult", requestId: "copy-1", isCopied: true },
    ]);
  });

  it("剪贴板拿不到也作答，reason 是协议里的 no-clipboard", async () => {
    vi.stubGlobal("navigator", {
      platform: "",
      clipboard: {
        writeText: async () => {
          throw new Error("NotAllowedError");
        },
      },
    });
    // 旧式退路也不可用：两路都失败才该答 no-clipboard。
    Object.defineProperty(document, "execCommand", {
      value: () => false,
      configurable: true,
    });
    const { vscode } = renderDesktop();

    sendHostMessage(
      fixtures.desktopModCopy({
        sessionId: "s1",
        requestId: "copy-2",
        text: "复制我",
      }),
    );

    await act(async () => {});
    expect(replies(vscode, "modCopyResult")).toEqual([
      {
        command: "modCopyResult",
        requestId: "copy-2",
        isCopied: false,
        reason: "no-clipboard",
      },
    ]);
    delete (document as unknown as Record<string, unknown>).execCommand;
  });
});
