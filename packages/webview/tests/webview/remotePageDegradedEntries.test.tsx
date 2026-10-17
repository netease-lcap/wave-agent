/**
 * The remote-control Web page renders the IDE branch of the shared chat UI, so
 * without guards it also renders the IDE's host-side entries — settings, plugin
 * tabs, the editor-open path, rewind checkpoints, backgrounded tasks. None of
 * them exist on the serving machine *from the page*: the page has no editor, no
 * host to route to, and no second carrier to put a UI in. This file pins the two
 * halves of spec ui/remote-control.md 场景 23–24:
 *
 * - what has nowhere to open is **degraded, not removed**: a file path stays
 *   readable as plain text (the Write block's content preview especially is the
 *   only way to read what was written on a phone);
 * - what can only fail is **not rendered at all**, so nothing on the page looks
 *   clickable and then does nothing.
 *
 * The counter-assertions matter as much as the asserts: the same fixture renders
 * the link / the button in every other host, so a guard that over-reaches breaks
 * a test here rather than shipping.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import {
  act,
  createMockVscode,
  fireInput,
  renderChatApp,
  screen,
  sendCommand,
  sendHostMessage,
  waitFor,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";
import { MockDataGenerator } from "../fixtures/mockData";
import { Message } from "../../src/components/Message";
import { WriteToolPreview } from "../../src/components/WriteToolPreview";
import { BASH_TOOL_NAME, READ_TOOL_NAME } from "wave-agent-sdk";
import type { Message as MessageType, ToolBlock } from "../../src/types";

const ABSOLUTE_PATH = "/home/user/project/src/styles/QueuedMessageList.css";

/** Mount one message the way the page does — through the shared UI's renderer. */
function showMessage(message: MessageType) {
  const vscode = createMockVscode();
  return render(<Message message={message} vscode={vscode} />);
}

function renderAssistantMarkdown(content: string) {
  return showMessage(MockDataGenerator.createAssistantMessage(content));
}

function readToolMessage() {
  return MockDataGenerator.createAssistantMessageWithTool(
    "I'll read the file.",
    READ_TOOL_NAME,
    JSON.stringify({ file_path: ABSOLUTE_PATH }),
    "File contents read successfully",
  );
}

function bashToolMessage(result: string) {
  return {
    id: "msg-bash-1",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        parameters: JSON.stringify({ command: "ls" }),
        compactParams: "ls",
        stage: "end",
        success: true,
        result,
      },
    ],
  } as unknown as MessageType;
}

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

function postsOf(vscode: ReturnType<typeof createMockVscode>) {
  return vscode.postMessage.mock.calls.map(
    ([msg]) => msg as Record<string, unknown>,
  );
}

/**
 * Webview→host commands a host-local slash command would post on any other host:
 * the ones that make a dialog or RPC on the host side. The page must post none
 * of them (spec ui/remote-control.md 场景 24).
 */
const HOST_ONLY_COMMANDS = new Set([
  "askBtw",
  "backgroundCurrentTask",
  "clearChat",
  "compact",
  "getConfiguredModels",
  "listRewindCheckpoints",
  "openExternal",
  "openFile",
  "planCommand",
  "reloadPlugins",
  "remoteControl",
  "updateConfiguration",
]);

afterEach(() => {
  delete window.waveRemotePage;
  vi.restoreAllMocks();
});

describe("file paths on the remote-control Web page", () => {
  it("renders a path in the message body as plain text, not an entry", () => {
    window.waveRemotePage = true;
    const { container } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    expect(container.querySelectorAll("a.file-path-link")).toHaveLength(0);
    // Degraded, not dropped — the path is still the thing you read.
    expect(container.textContent).toContain(ABSOLUTE_PATH);
  });

  it("still links the same path in every other host", () => {
    const { container } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    expect(
      container.querySelectorAll(".markdown-content a.file-path-link").length,
    ).toBeGreaterThan(0);
  });

  it("leaves the inline-code and fenced-code channels unlinked too", () => {
    window.waveRemotePage = true;
    const { container } = renderAssistantMarkdown(
      `看 \`${ABSOLUTE_PATH}\`：\n\n\`\`\`text\n${ABSOLUTE_PATH}\n\`\`\`\n`,
    );

    expect(container.querySelectorAll("code a.file-path-link")).toHaveLength(0);
    expect(container.textContent).toContain(ABSOLUTE_PATH);
  });

  it("leaves a bash output path unlinked", () => {
    window.waveRemotePage = true;
    const { container } = showMessage(
      bashToolMessage(`wrote ${ABSOLUTE_PATH}\n`),
    );

    const output = container.querySelector(".bash-command-output");
    expect(output).not.toBeNull();
    expect(output?.querySelectorAll("a.file-path-link")).toHaveLength(0);
    expect(output?.textContent).toContain(ABSOLUTE_PATH);
  });

  it("keeps the tool header path visible but inert, with no openFile on click", async () => {
    window.waveRemotePage = true;
    const { container } = showMessage(readToolMessage());

    const path = await waitFor(() => {
      const el = container.querySelector(".write-tool-path") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(path).toHaveTextContent("QueuedMessageList.css");
    // Plain text: no button role, not in the tab order.
    expect(path.getAttribute("role")).not.toBe("button");
    expect(path.getAttribute("tabindex")).toBeNull();
    expect(path.className).toContain("write-tool-path--plain");
  });

  it("keeps the Write block's content preview but drops its 打开预览 button", () => {
    window.waveRemotePage = true;
    const block = {
      type: "tool",
      name: "Write",
      parameters: JSON.stringify({ file_path: "/a/b.md", content: "l1\nl2" }),
      stage: "end",
      success: true,
      shortResult: "File created (2 lines, 5 characters)",
      id: "write_1",
    } as unknown as ToolBlock;
    const vscode = createMockVscode();
    const { container } = render(
      <WriteToolPreview toolBlock={block} vscode={vscode} />,
    );

    // The written content is the only way to read a Write on a phone — kept.
    expect(container.querySelector(".write-preview-content")).toHaveTextContent(
      "l1",
    );
    expect(container.querySelector(".write-preview-scrim")).toBeNull();
    expect(container.querySelector(".write-preview-open")).toBeNull();
  });

  it("still renders the same Write block's 打开预览 button in every other host", () => {
    const block = {
      type: "tool",
      name: "Write",
      parameters: JSON.stringify({ file_path: "/a/b.md", content: "l1\nl2" }),
      stage: "end",
      success: true,
      shortResult: "File created (2 lines, 5 characters)",
      id: "write_1",
    } as unknown as ToolBlock;
    const { container } = render(
      <WriteToolPreview
        toolBlock={block}
        vscode={createMockVscode()}
        onOpenFile={vi.fn()}
      />,
    );

    expect(container.querySelector(".write-preview-open")).not.toBeNull();
  });
});

describe("entries that can only fail on the page", () => {
  it("keeps 设置 and drops 登录/退出登录 from the more menu, keeping the two real links", () => {
    window.waveRemotePage = true;
    renderChatApp();

    act(() => {
      fireEvent.click(screen.getByTestId("more-btn"));
    });

    expect(screen.getByTestId("more-menu-enterprise")).toBeInTheDocument();
    expect(screen.getByTestId("more-menu-help-docs")).toBeInTheDocument();
    // 第三批解禁（spec「Web 端也能改设置」）：设置页在页面上真的能开、能读写，
    // 所以这一项留下来。登录/退出登录仍不渲染——页面复用企业端登录态。
    expect(screen.getByTestId("more-menu-settings")).toBeInTheDocument();
    expect(screen.queryByTestId("more-menu-logout")).not.toBeInTheDocument();
    expect(screen.queryByTestId("more-menu-login")).not.toBeInTheDocument();
  });

  it("bounds the arrow keys to the entries that are actually left", () => {
    window.waveRemotePage = true;
    renderChatApp();

    act(() => {
      fireEvent.click(screen.getByTestId("more-btn"));
    });

    const menu = screen.getByTestId("more-menu");
    const items = Array.from(
      menu.querySelectorAll<HTMLElement>(".more-menu-item"),
    );
    expect(items).toHaveLength(3);

    act(() => {
      fireEvent.keyDown(items[0], { key: "ArrowDown" });
    });
    expect(items[1].tabIndex).toBe(0);

    act(() => {
      fireEvent.keyDown(items[1], { key: "ArrowDown" });
    });
    expect(items[2].tabIndex).toBe(0);

    // At the last entry the roving stops: with a stale item count it would move
    // to a slot that is not there, leaving the whole menu without a tab stop.
    act(() => {
      fireEvent.keyDown(items[2], { key: "ArrowDown" });
    });
    expect(items[2].tabIndex).toBe(0);
    expect(menu.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("opens 企业控制台 and 帮助文档 in a browser tab instead of asking the host", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    act(() => {
      sendHostMessage(
        fixtures.authStatusResponse({
          serverUrl: "https://console.example.com",
        }),
      );
    });

    act(() => {
      fireEvent.click(screen.getByTestId("more-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-enterprise"));
    });

    expect(open).toHaveBeenCalledWith(
      "https://console.example.com",
      "_blank",
      "noopener,noreferrer",
    );
    expect(postsOf(vscode)).not.toContainEqual(
      expect.objectContaining({ command: "openExternal" }),
    );
  });

  it("offers the queue's three actions, each wired to a host method", () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    act(() => {
      sendCommand("startStreaming");
      sendCommand("updateQueue", {
        queue: [{ id: "q1", content: "排队中的消息" }],
      });
    });

    expect(screen.getByTestId("queued-item-q1")).toHaveTextContent(
      "排队中的消息",
    );

    // 第二批解禁（spec「页面能执行的那批宿主命令」场景 5）：三个动作都留下来了，
    // 背后各有宿主方法 —— 编辑/删除是队列手术，「立即发送」是
    // `sendMessage{force}` + 删这条两步（没有专门的宿主方法，与 IDE / 桌面同形）。
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("queued-send-q1"));
    });
    const sent = postsOf(vscode);
    expect(sent).toContainEqual(
      expect.objectContaining({ command: "sendMessage", text: "排队中的消息" }),
    );
    expect(sent).toContainEqual({
      command: "deleteQueuedMessageById",
      id: "q1",
    });

    // 删除是乐观的（这一条立刻从列表里下去），所以放在最后。
    act(() => {
      sendCommand("updateQueue", {
        queue: [{ id: "q2", content: "再排一条" }],
      });
    });
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(screen.getByTestId("queued-delete-q2"));
    });
    expect(postsOf(vscode)).toContainEqual({
      command: "deleteQueuedMessageById",
      id: "q2",
    });
  });

  it("keeps the rewind button, behind a confirmation that names the file change", () => {
    window.waveRemotePage = true;
    renderChatApp();

    act(() => {
      sendCommand("updateMessages", {
        messages: [MockDataGenerator.createUserMessage("你好", "msg-1")],
      });
    });

    // 第二批解禁：回滚与桌面同语义（截断对话 + 按 `file_history` 快照还原**电脑
    // 侧**工作区文件），所以按钮留下来，但手机上先问一次 —— 且文案必须点明文件。
    const rewindButton = document.querySelector<HTMLElement>(
      ".message-action-btn",
    );
    expect(rewindButton).not.toBeNull();

    act(() => {
      fireEvent.click(rewindButton as HTMLElement);
    });
    expect(screen.getByText("确定要回滚到此消息吗？")).toBeInTheDocument();
    expect(
      screen.getByText(/把电脑侧工作区的文件恢复到回滚点的内容/),
    ).toBeInTheDocument();
  });

  it("sends every host-local slash command as an ordinary message", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    // 第三批解禁之后仍然「只能失败」的那些：它们的背后是宿主的**界面**能力
    // （插件市场 / 钩子等管理视图 / 计划预览 / btw 面板），或者只有宿主侧才有
    // 意义（远程控制自身）。`/config` 已解禁（设置页在页面上真的能开），
    // `/clear` `/rewind` `/model` `/tasks` `/workflows` 见下一条用例。
    const hostLocal = [
      "/plugin",
      "/reload-plugins",
      "/mcp",
      "/agents",
      "/skills",
      "/hooks",
      "/btw 今天几号",
      "/plan",
      "/remote-control",
    ];

    for (const text of hostLocal) {
      vscode.postMessage.mockClear();
      await act(async () => {
        await typeAndSend(text);
      });

      const posts = postsOf(vscode);
      // One ordinary message out — the same fallback an unregistered command
      // gets, which the machine answers like any other text.
      expect(posts.filter((p) => p.command === "sendMessage")).toEqual([
        expect.objectContaining({ command: "sendMessage", text }),
      ]);
      // And nothing host-only went out behind it: no dialog's RPC, no
      // listRewindCheckpoints / getConfiguredModels / planCommand / askBtw …
      expect(
        posts.filter((p) => HOST_ONLY_COMMANDS.has(p.command as string)),
      ).toEqual([]);
    }
  });

  it("serves the five commands the second batch unblocked, instead of sending them as text", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    // /rewind 先读检查点；选中之后的确认与消息按钮共用同一个对话框。
    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/rewind");
    });
    expect(postsOf(vscode)).toContainEqual({
      command: "listRewindCheckpoints",
    });

    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/model");
    });
    expect(postsOf(vscode)).toContainEqual({ command: "getConfiguredModels" });

    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/tasks");
    });
    expect(screen.getByTestId("background-task-manager")).toBeInTheDocument();

    act(() => {
      sendCommand("hideDialog");
    });
    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/workflows");
    });
    expect(screen.getByTestId("workflow-manager")).toBeInTheDocument();

    // /clear 是写操作（换绑 sessionId + 跑 Session hooks）：先弹一次确认，确认
    // 之后才发 `clearChat`。
    act(() => {
      sendCommand("hideDialog");
    });
    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/clear");
    });
    expect(postsOf(vscode).filter((p) => p.command === "clearChat")).toEqual(
      [],
    );
    expect(screen.getByText("确定要清空当前对话吗？")).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByText("确定"));
    });
    expect(postsOf(vscode)).toContainEqual({ command: "clearChat" });
  });

  it("keeps the two commands the machine can really serve", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    await act(async () => {
      await typeAndSend("/compact");
    });
    expect(postsOf(vscode)).toContainEqual({
      command: "compact",
      customInstructions: undefined,
    });

    vscode.postMessage.mockClear();
    await act(async () => {
      await typeAndSend("/status");
    });
    expect(screen.getByTestId("status-dialog")).toBeInTheDocument();
  });
});
