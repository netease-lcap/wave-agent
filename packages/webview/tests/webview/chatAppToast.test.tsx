import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  sendHostMessage,
  screen,
  fireEvent,
} from "./test-utils";

// Desktop-host toasts (showToast → in-app ToastStack → toastAction echo).
describe("ChatApp showToast integration", () => {
  it("renders a host-pushed session toast and echoes its action button back as toastAction", () => {
    const { vscode } = renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: {
        id: "t1",
        message: "会话「任务A」需要确认：命令执行待确认",
        position: "bottomRight",
        actionLabel: "查看",
        action: { type: "focusSession", host: "local", sessionId: "s2" },
      },
    });

    expect(
      screen.getByText("会话「任务A」需要确认：命令执行待确认"),
    ).toBeInTheDocument();
    // 后台会话确认 toast 落右下角栈（保持改动前的 VS Code 通知形态）
    expect(screen.getByTestId("toast-stack--bottomRight")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    // The webview echoes the opaque action back; the host performs it (聚焦该
    // 后台会话), and the toast closes.
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "toastAction",
      toastId: "t1",
      action: { type: "focusSession", host: "local", sessionId: "s2" },
    });
    expect(screen.queryByRole("button", { name: "查看" })).toBeNull();
    expect(
      screen.queryByText("会话「任务A」需要确认：命令执行待确认"),
    ).not.toBeInTheDocument();
  });

  it("dismisses a toast via its close button without echoing an action", () => {
    const { vscode } = renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: { id: "t1", message: "当前已是最新版本" },
    });
    expect(screen.getByText("当前已是最新版本")).toBeInTheDocument();
    // 应用级 toast 缺省落顶部居中栈
    expect(screen.getByTestId("toast-stack--top")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(screen.queryByText("当前已是最新版本")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "toastAction" }),
    );
  });

  it("replaces a toast with the same id instead of stacking duplicates", () => {
    renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: { id: "t1", message: "发现新版本 v0.20.0，正在后台下载…" },
    });
    sendHostMessage({
      command: "showToast",
      toast: { id: "t1", message: "新版本 v0.20.0 已下载完成" },
    });

    expect(screen.getAllByTestId("toast")).toHaveLength(1);
    expect(screen.getByText("新版本 v0.20.0 已下载完成")).toBeInTheDocument();
  });
});
