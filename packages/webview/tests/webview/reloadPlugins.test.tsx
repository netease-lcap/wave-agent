/**
 * `/reload-plugins` 入口（webview 侧，桌面 / IDE 同一份 bundle，spec
 * ecosystem/plugin.md「插件变更的就地重载」场景 13）：命令不进对话、不触发模型
 * 回复，只把 `reloadPlugins` 交给宿主去执行就地换装。
 */

import { describe, it, expect } from "vitest";
import {
  render,
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendHostMessage,
  fireInput,
  createMockVscode,
  fixtures,
} from "./test-utils";
import { ChatApp } from "../../src/components/ChatApp";

/** 在消息输入框里敲一条斜杠命令并回车。 */
async function submitCommand(command: string) {
  const input = screen.getByTestId("message-input");
  act(() => {
    input.textContent = command;
  });
  await fireInput(input, { data: command, inputType: "insertText" });
  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
}

describe("/reload-plugins", () => {
  it("IDE 端：只发 reloadPlugins，不进对话", async () => {
    const { vscode } = renderChatApp();
    vscode.postMessage.mockClear();

    await submitCommand("/reload-plugins");

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "reloadPlugins" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });

  it("桌面端：同一入口同样拦截（不重建、不进对话）", async () => {
    const { vscode } = renderDesktopChatApp();
    vscode.postMessage.mockClear();

    await submitCommand("/reload-plugins");

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "reloadPlugins" }),
    );
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "sendMessage" }),
    );
  });
});

// Render a desktop-mode ChatApp (mirrors clearChat.test.tsx): the message input
// renders after authStatusResponse + setInitialState arrive.
function renderDesktopChatApp() {
  const vscode = createMockVscode();
  const result = render(
    <ChatApp
      vscode={vscode as never}
      host={
        {
          type: "desktop",
          host: "local",
          hosts: ["local"],
          recentWorkdirs: [],
          workdir: "/work/a",
          sessionTree: [],
          panes: [{ paneId: "pane-1" }],
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
        } as never
      }
    />,
  );
  sendHostMessage(fixtures.authStatusResponse());
  sendHostMessage(fixtures.setInitialState());
  return { ...result, vscode };
}
