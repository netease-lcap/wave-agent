/**
 * The remote-control Web page renders the IDE branch of the shared chat UI, so
 * without guards it also renders the IDE's host-side entries — settings, plugin
 * tabs, the editor-open path, rewind checkpoints, backgrounded tasks. None of
 * them exist on the serving machine *from the page*: the page has no editor, no
 * host to route to, and no second carrier to put a UI in. This file pins the two
 * halves of spec remote/remote-web.md 场景 20/21:
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
function showMessage(message: MessageType, workdir?: string) {
  const vscode = createMockVscode();
  return {
    ...render(<Message message={message} vscode={vscode} workdir={workdir} />),
    vscode,
  };
}

function renderAssistantMarkdown(content: string, workdir?: string) {
  return showMessage(
    MockDataGenerator.createAssistantMessage(content),
    workdir,
  );
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

/** 活着的会话，只是还没有可见消息（「新建对话」刚建好 / `/clear` 之后）。 */
const EMPTY_SESSION = {
  id: "session-empty",
  sessionType: "main" as const,
  workdir: "/repo/app",
  createdAt: new Date("2026-10-14T08:00:00Z"),
  lastActiveAt: new Date("2026-10-14T09:00:00Z"),
  latestTotalTokens: 0,
};

/**
 * 开一个能在输入区敲字的远控页：**必须有会话**。机器上一条会话都没有时页面把
 * 输入区置灰（spec remote/remote-web.md「手机端的会话列表与删除」场景 14，见
 * remotePageNoSession.test.tsx），那种状态下这些「命令怎么走」的用例无从谈起。
 */
function openPageOnEmptySession() {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({
        sessions: [EMPTY_SESSION],
        session: EMPTY_SESSION,
        messages: [],
      }),
    );
  });
  return rendered;
}

function postsOf(vscode: ReturnType<typeof createMockVscode>) {
  return vscode.postMessage.mock.calls.map(
    ([msg]) => msg as Record<string, unknown>,
  );
}

/**
 * Webview→host commands a host-local slash command would post on any other host:
 * the ones that make a dialog or RPC on the host side. The page must post none
 * of them (spec remote/remote-web.md 场景 21).
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
  /** 页面对一份内容的回包（两条按需读取通道共用这套驱动）。 */
  function replyText(
    requestId: unknown,
    payload: Record<string, unknown> = {},
  ) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "textPreviewResponse",
            requestId,
            content: "# 构建日志\n\nbuild ok\n",
            bytes: 20,
            returnedBytes: 20,
            truncated: false,
            encodingIssue: false,
            ...payload,
          },
        }),
      );
    });
  }

  it("把正文里的路径变成入口，点了按需读那份文件", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });

    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    expect(request).toMatchObject({ path: ABSOLUTE_PATH });

    replyText(request!.requestId);

    // 内容进的是全屏弹层（本页唯一能滚动、能选中复制的容器）。
    expect(await screen.findByRole("dialog")).toHaveTextContent("build ok");
  });

  it("行内代码与围栏代码块里的路径同样可点", async () => {
    window.waveRemotePage = true;
    const { container } = renderAssistantMarkdown(
      `看 \`${ABSOLUTE_PATH}\`：\n\n\`\`\`text\n${ABSOLUTE_PATH}\n\`\`\`\n`,
    );

    expect(
      container.querySelectorAll("code a.file-path-link").length,
    ).toBeGreaterThan(0);
    expect(container.textContent).toContain(ABSOLUTE_PATH);
  });

  it("Bash 输出里的路径也同样可点", () => {
    window.waveRemotePage = true;
    const { container } = showMessage(
      bashToolMessage(`wrote ${ABSOLUTE_PATH}\n`),
    );

    const output = container.querySelector(".bash-command-output");
    expect(output).not.toBeNull();
    expect(output?.querySelectorAll("a.file-path-link").length).toBeGreaterThan(
      0,
    );
    expect(output?.textContent).toContain(ABSOLUTE_PATH);
  });

  it("工具块头的路径可点，相对路径按会话工作目录拼回绝对路径", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = showMessage(
      readToolMessage(),
      "/home/user/project",
    );

    const path = await waitFor(() => {
      const el = container.querySelector(".write-tool-path") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(path).toHaveTextContent("QueuedMessageList.css");

    act(() => {
      fireEvent.click(path);
    });

    expect(
      postsOf(vscode).find((msg) => msg.command === "getTextPreview"),
    ).toMatchObject({ path: ABSOLUTE_PATH });
  });

  it("图片路径仍走取图那条，不被文本通道抢走", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      "截图在 `/tmp/shots/before.png`。",
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });

    const commands = postsOf(vscode).map((msg) => msg.command);
    expect(commands).toContain("getImagePreview");
    expect(commands).not.toContain("getTextPreview");
  });

  it("宿主说截断了，就写在标题栏上（不假装整份都在）", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });
    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    replyText(request!.requestId, {
      bytes: 5 * 1024 * 1024,
      returnedBytes: 256 * 1024,
      truncated: true,
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("前 256 KB / 共 5.0 MB");
  });

  it("代码/日志按原样显示：等宽预格式化，不被 markdown 吃掉缩进", async () => {
    window.waveRemotePage = true;
    // 用 `.ts` 路径：语言按扩展名选，内容与扩展名对不上时本来就没有 token 可上色。
    const { container, vscode } = renderAssistantMarkdown(
      "改动在 /home/user/project/src/utils/cache.ts 里。",
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });
    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    replyText(request!.requestId, {
      content:
        "/**\n * 两段式缓存\n */\nexport class C {\n    private readonly m = new Map();\n}\n",
    });

    const dialog = await screen.findByRole("dialog");
    // 等宽那一档；markdown 排版档不出现——`*` 开头会被当成项目符号、4 空格缩进
    // 会被当成缩进代码块，源文件就成了两截不同样式的散文。
    expect(dialog.querySelector(".ide-context-preview-body")).not.toBeNull();
    expect(dialog.querySelector(".ide-context-preview-doc")).toBeNull();
    expect(dialog.querySelector("li")).toBeNull();
    // 但还是有语法高亮：按扩展名选语言，与文件面板同一份配色。
    expect(dialog.querySelector(".hljs-keyword")).not.toBeNull();
  });

  it("解不成 UTF-8 时在正文上方提示，不挤进标题栏被省略", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });
    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    replyText(request!.requestId, {
      bytes: 5 * 1024 * 1024,
      returnedBytes: 256 * 1024,
      truncated: true,
      encodingIssue: true,
    });

    const dialog = await screen.findByRole("dialog");
    // 短的那句留在标题栏，长的那句单独一行——两条都不许被 ellipsis 吃掉。
    expect(dialog.querySelector(".ide-context-preview-note")).toHaveTextContent(
      "前 256 KB / 共 5.0 MB",
    );
    expect(
      dialog.querySelector(".ide-context-preview-notice"),
    ).toHaveTextContent("可能显示成乱码");
  });

  it("只有 markdown 文档走排版渲染", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      "报告写在 /home/user/project/README.md 里。",
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });
    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    replyText(request!.requestId, { content: "# 标题\n\n- 一条\n" });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector(".ide-context-preview-doc")).not.toBeNull();
    expect(dialog.querySelector("h1")).toHaveTextContent("标题");
  });

  it("读不了时把宿主那句原因显示在弹层里，不静默", async () => {
    window.waveRemotePage = true;
    const { container, vscode } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    const link = await waitFor(() => {
      const el = container.querySelector("a.file-path-link") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    act(() => {
      fireEvent.click(link);
    });
    const request = postsOf(vscode).find(
      (msg) => msg.command === "getTextPreview",
    );
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            command: "textPreviewResponse",
            requestId: request!.requestId,
            error: `${ABSOLUTE_PATH} is not a text file`,
          },
        }),
      );
    });

    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "is not a text file",
    );
  });

  it("still links the same path in every other host", () => {
    const { container } = renderAssistantMarkdown(
      `改动在 ${ABSOLUTE_PATH} 里。`,
    );

    expect(
      container.querySelectorAll(".markdown-content a.file-path-link").length,
    ).toBeGreaterThan(0);
  });

  it("keeps the Write block's content preview, and keeps the button off when nothing can open it", () => {
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

    // 内容预览不经过任何请求，照旧在（那是消息里现成的一份内容）。
    expect(container.querySelector(".write-preview-content")).toHaveTextContent(
      "l1",
    );
    // 没有 handler（页面上的入口由 Message 注入）时不给按钮：
    // 不留「看着能点、点了没反应」。
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
  it("drops 设置 and 登录/退出登录 from the more menu, keeping the two real links", () => {
    window.waveRemotePage = true;
    renderChatApp();

    act(() => {
      fireEvent.click(screen.getByTestId("more-btn"));
    });

    expect(screen.getByTestId("more-menu-enterprise")).toBeInTheDocument();
    expect(screen.getByTestId("more-menu-help-docs")).toBeInTheDocument();
    expect(screen.queryByTestId("more-menu-settings")).not.toBeInTheDocument();
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
    expect(items).toHaveLength(2);

    act(() => {
      fireEvent.keyDown(items[0], { key: "ArrowDown" });
    });
    expect(items[1].tabIndex).toBe(0);

    // At the last entry the roving stops: with a stale item count it would move
    // to a slot that is not there, leaving the whole menu without a tab stop.
    act(() => {
      fireEvent.keyDown(items[1], { key: "ArrowDown" });
    });
    expect(items[1].tabIndex).toBe(0);
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
    const { vscode } = openPageOnEmptySession();

    // 第二批解禁之后仍然「只能失败」的那些：它们的背后是宿主的**界面**能力
    // （设置页 / 插件 / 计划预览 / btw 面板），或者只有宿主侧才有意义（远程控制
    // 自身）。/clear /rewind /tasks /workflows 与 /btw 已经解禁，见下面几条用例。
    const hostLocal = [
      "/config",
      "/plugin",
      "/reload-plugins",
      "/mcp",
      "/agents",
      "/skills",
      "/hooks",
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

  it("serves /btw as a side question instead of sending it as text", async () => {
    const { vscode } = openPageOnEmptySession();

    await act(async () => {
      await typeAndSend("/btw 今天几号");
    });

    // 一条 `askBtw` 出去，一条 `sendMessage` 都不发（spec「Web 页也能用 /btw
    // 旁路提问」场景 1）：这条问答既不进对话历史，也不该让模型把它当正文回答。
    expect(postsOf(vscode).filter((p) => p.command === "sendMessage")).toEqual(
      [],
    );
    expect(postsOf(vscode)).toContainEqual({
      command: "askBtw",
      question: "今天几号",
    });

    // 面板与宿主无关，照常挂在输入区上方。
    expect(screen.getByTestId("btw-panel")).toBeInTheDocument();
  });

  it("shows the usage line for a bare /btw and asks the machine nothing", async () => {
    const { vscode } = openPageOnEmptySession();

    await act(async () => {
      await typeAndSend("/btw");
    });

    expect(postsOf(vscode).filter((p) => p.command === "askBtw")).toEqual([]);
    expect(postsOf(vscode).filter((p) => p.command === "sendMessage")).toEqual(
      [],
    );
    expect(screen.getByText(/用法：\/btw/)).toBeInTheDocument();
  });

  it("serves the four commands the second batch unblocked, instead of sending them as text", async () => {
    const { vscode } = openPageOnEmptySession();

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
    const { vscode } = openPageOnEmptySession();

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
