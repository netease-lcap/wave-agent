import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  within,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import { MockDataGenerator } from "../fixtures/mockData";
import React from "react";
import { ChatApp, prunePanelGroupCache } from "../../src/components/ChatApp";
import type { VsCodeApi } from "../../src/types";

/**
 * 设置页「新增/编辑」预填提示词 × 宿主快照时序（线上缺陷回归）。
 *
 * 复现：桌面端 设置 → 钩子 →「+ 新增钩子」→ 会话输入框是空的；切走会话再切回来
 * 提示词才出现。
 *
 * 根因：宿主（desktop `pushInitialState`、vscode `handleWebviewReady`、
 * jetbrains `handleWebviewReady`）在 webviewReady 后先发 `authStatusResponse`
 * 再发 `setInitialState`。前者就把 `initialized` 置真、让输入区挂载，预填请求
 * 于是在这两条消息之间被写进输入框；紧接着到达的 `setInitialState` 把
 * `inputContent`（宿主此刻还只有空草稿）作为新的受控值灌回 MessageInput，
 * 刚写好的预填文本被整段覆盖成空 —— 提示词只在宿主草稿里活着，所以切走再切回
 * （重新回放 setInitialState）才看得见。
 */

function desktopHost(
  panes: Array<{ paneId: string }> = [{ paneId: "pane-1" }],
) {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: [],
    workdir: "/work/a",
    sessionTree: [],
    panes,
    focusedPaneId: "pane-1",
    onSelectWorkdir: () => {},
    onSelectRecentWorkdir: () => {},
    onRemoveRecentWorkdir: () => {},
    onSelectHost: () => {},
    onAddHost: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

function paneInput(paneId: string): HTMLElement {
  return within(screen.getByTestId(`desktop-pane-${paneId}`)).getByTestId(
    "message-input",
  );
}

async function typeInPane(paneId: string, text: string) {
  const input = paneInput(paneId);
  input.focus();
  await act(async () => {
    input.textContent = text;
    fireEvent.input(input, { data: text, inputType: "insertText" });
  });
  fireEvent.keyDown(input, { key: "Enter" });
}

const history = () => [MockDataGenerator.createUserMessage("之前的问题")];

describe("设置页预填提示词 × 宿主快照到达时序", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prunePanelGroupCache(new Set());
  });

  it("desktop：预填写在 authStatusResponse 与 setInitialState 之间时不丢", async () => {
    const vscode = createMockVscode();
    render(
      <ChatApp vscode={vscode as unknown as VsCodeApi} host={desktopHost()} />,
    );
    // pane 首屏：宿主先回 authStatus，快照尚未到达（inputContent 仍未受控）。
    sendHostMessage(fixtures.authStatusResponse());

    await typeInPane("pane-1", "/hooks");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /新增钩子/ }));
    });

    // 关设置页 → pane 行重挂载 → 真实宿主回放：authStatusResponse 先到，
    // setInitialState（带快照里的空草稿）后到。
    sendHostMessage(fixtures.authStatusResponse());

    // 关键判据：authStatus 只是「认证状态到了」，输入框虽已挂载，但这条 pane 的
    // 权威快照还没落地 —— 此刻写草案，紧接着到达的 setInitialState 会把它重置掉
    // （浏览器里 `inputContent` 受控值把 contentEditable 整段清空）。所以预填必须
    // 等到 setInitialState 之后才写。
    expect(paneInput("pane-1").textContent ?? "").not.toContain("用户级钩子");

    // pane 快照按 paneId 定向下发（desktopHost.pushPaneSessionState）。
    sendHostMessage({
      ...fixtures.setInitialState({
        messages: history(),
        inputContent: "",
      }),
      paneId: "pane-1",
    } as never);

    await waitFor(() => {
      expect(paneInput("pane-1").textContent ?? "").toContain("用户级钩子");
    });

    // 宿主侧草稿也已经带上提示词 —— 「切回来才看见」的那份状态与首屏一致，
    // 不再出现「宿主有、首屏没有」的分裂。
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "updateInputContent",
        content: expect.stringContaining("用户级钩子"),
      }),
    );
  });

  it("IDE 宿主：prefillPrompt 早于 webview 初始化到达时不丢（重放而非静默丢弃）", async () => {
    const vscode = createMockVscode();
    render(<ChatApp vscode={vscode as unknown as VsCodeApi} />);

    // 设置页（独立 webview）关闭后，宿主把 prefillPrompt 转发到聊天 webview；
    // 此时聊天 webview 可能还没收到 setInitialState（React 尚未挂载输入框）。
    sendHostMessage({
      command: "prefillPrompt",
      prompt:
        "帮我配一个用户级钩子：<事件>时，<matcher 工具>，跑<命令>，<超时/异步>",
    } as never);

    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(
      fixtures.setInitialState({
        messages: history(),
        inputContent: "",
      }) as never,
    );

    await waitFor(() => {
      expect(screen.getByTestId("message-input").textContent ?? "").toContain(
        "用户级钩子",
      );
    });
  });
});
