import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  sendHostMessage,
  screen,
  fireEvent,
} from "./test-utils";

// Desktop-host update toasts (showToast → in-app ToastStack → toastAction echo).
describe("ChatApp showToast integration", () => {
  it("renders a host-pushed toast and echoes its action button back as toastAction", () => {
    const { vscode } = renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: {
        id: "t1",
        message: "新版本 v0.20.0 已下载完成，重启应用以完成安装。",
        actionLabel: "重启安装",
        action: { type: "quitAndInstall" },
      },
    });

    expect(
      screen.getByText("新版本 v0.20.0 已下载完成，重启应用以完成安装。"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重启安装" }));

    // The webview echoes the opaque action back; the host performs it.
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "toastAction",
      toastId: "t1",
      action: { type: "quitAndInstall" },
    });
    // The toast is removed once acted upon.
    expect(
      screen.queryByText("新版本 v0.20.0 已下载完成，重启应用以完成安装。"),
    ).not.toBeInTheDocument();
  });

  it("dismisses a toast via its close button without echoing an action", () => {
    const { vscode } = renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: { id: "t1", message: "当前已是最新版本" },
    });
    expect(screen.getByText("当前已是最新版本")).toBeInTheDocument();

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
