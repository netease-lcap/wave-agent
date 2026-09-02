import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  sendHostMessage,
  screen,
  fireEvent,
} from "./test-utils";

// Desktop-host toasts (showToast → in-app ToastStack → toastAction echo).
describe("ChatApp showToast integration", () => {
  it("renders a host-pushed toast and echoes its action button back as toastAction", () => {
    const { vscode } = renderChatApp();

    sendHostMessage({
      command: "showToast",
      toast: {
        id: "t1",
        message: "发现新版本 v0.20.0",
        actionLabel: "打开下载页",
        action: {
          type: "openDownloadPage",
          url: "https://github.com/release",
        },
      },
    });

    expect(screen.getByText("发现新版本 v0.20.0")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开下载页" }));

    // The webview echoes the opaque action back; the host performs it, and the
    // toast closes (host-side semantics — no update action needs a waiting
    // state now that 更新下载/重启 live in the account-card S0–S6 machine).
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "toastAction",
      toastId: "t1",
      action: { type: "openDownloadPage", url: "https://github.com/release" },
    });
    expect(screen.queryByRole("button", { name: "打开下载页" })).toBeNull();
    expect(screen.queryByText("发现新版本 v0.20.0")).not.toBeInTheDocument();
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
