import { afterEach, describe, it, expect } from "vitest";
import { fixtures } from "wave-webview-fixtures";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  sendHostMessage,
} from "./test-utils";

/**
 * Open the more menu by clicking the more button in the header.
 */
function openMoreMenu() {
  const moreBtn = screen.getByTestId("more-btn");
  act(() => {
    fireEvent.click(moreBtn);
  });
  return screen.getByTestId("more-menu");
}

describe("More Menu", () => {
  it("should render the menu items when opened", () => {
    renderChatApp();

    openMoreMenu();

    expect(screen.getByTestId("more-menu-settings")).toHaveTextContent("设置");
    expect(screen.getByTestId("more-menu-enterprise")).toHaveTextContent(
      "企业控制台",
    );
    expect(screen.getByTestId("more-menu-logout")).toHaveTextContent(
      "退出登录",
    );
  });

  it("should not show 退出登录 when unauthenticated", () => {
    renderChatApp();

    // Switch to unauthenticated
    sendCommand("authStatusResponse", { isAuthenticated: false });

    openMoreMenu();

    expect(screen.getByTestId("more-menu-settings")).toBeInTheDocument();
    expect(screen.getByTestId("more-menu-enterprise")).toBeInTheDocument();
    expect(screen.queryByTestId("more-menu-logout")).not.toBeInTheDocument();
    // Unauthenticated users get a 登录 entry instead
    expect(screen.getByTestId("more-menu-login")).toHaveTextContent("登录");
  });

  it("should ask the plugin host to open the settings tab when 设置 is clicked", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-settings"));
    });

    // plugin hosts open the settings tab webview in the editor area (spec 场景 10)
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "openSettings" }),
    );
    // Menu closes after selection
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should post openExternal with the serverUrl when 企业控制台 is clicked", () => {
    const { vscode } = renderChatApp();

    act(() => {
      sendHostMessage(
        fixtures.authStatusResponse({
          serverUrl: "https://console.example.com",
        }),
      );
    });

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-enterprise"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "openExternal",
        url: "https://console.example.com",
      }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should not post openExternal when serverUrl is missing", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-enterprise"));
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "openExternal" }),
    );
  });

  it("should post openExternal to serverUrl + /docs when 帮助文档 is clicked", () => {
    const { vscode } = renderChatApp();

    act(() => {
      sendHostMessage(
        fixtures.authStatusResponse({
          serverUrl: "https://codechat.example.com/",
        }),
      );
    });

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-help-docs"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "openExternal",
        url: "https://codechat.example.com/docs/",
      }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should not post openExternal for 帮助文档 when serverUrl is missing", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-help-docs"));
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "openExternal" }),
    );
  });

  it("should post logout when 退出登录 is clicked", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-logout"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "logout" }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should post login when 登录 is clicked while unauthenticated", () => {
    const { vscode } = renderChatApp();

    // Switch to unauthenticated
    sendCommand("authStatusResponse", { isAuthenticated: false });

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-login"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "login" }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should close the menu when Escape is pressed", () => {
    renderChatApp();

    openMoreMenu();
    expect(screen.getByTestId("more-menu")).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });

    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });
});

/**
 * 远控页的「切换电脑」收在「更多」菜单里（第一项），不再占顶栏一枚常驻图标
 * ——换机器是低频动作（spec remote/remote-machine.md「机器列表与切换」场景 5）。
 */
describe("More Menu — 远控页的「切换电脑」", () => {
  afterEach(() => {
    delete window.waveRemotePage;
  });

  it("顶栏不再有独立的换机器按钮", () => {
    window.waveRemotePage = true;
    renderChatApp();

    expect(screen.getByTestId("more-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("switch-machine-btn")).toBeNull();
  });

  it("菜单第一项就是它，点下去让页面 shim 打开机器列表", () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    const menu = openMoreMenu();

    const entry = screen.getByTestId("more-menu-switch-machine");
    expect(entry).toHaveTextContent("切换电脑");
    expect(menu.querySelector(".more-menu-item")).toBe(entry);

    act(() => {
      fireEvent.click(entry);
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "openMachinePicker" }),
    );
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("四个本地宿主不出现这一项", () => {
    renderChatApp();

    openMoreMenu();

    expect(screen.queryByTestId("more-menu-switch-machine")).toBeNull();
  });
});
