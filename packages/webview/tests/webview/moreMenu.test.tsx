import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
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

  it("should show a persistent login button next to the more button when logged out (IDE)", () => {
    const { vscode } = renderChatApp();

    // Authenticated by default: no login button in the header.
    expect(screen.queryByTestId("header-login-btn")).not.toBeInTheDocument();

    // Switch to unauthenticated.
    sendCommand("authStatusResponse", { isAuthenticated: false });

    const loginBtn = screen.getByTestId("header-login-btn");
    expect(loginBtn).toHaveTextContent("登 录");
    vscode.postMessage.mockClear();
    fireEvent.click(loginBtn);
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "login" }),
    );

    // Login again clears the button.
    sendCommand("authStatusResponse", { isAuthenticated: true });
    expect(screen.queryByTestId("header-login-btn")).not.toBeInTheDocument();
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

  it("should ask the IDE host to open the settings tab when 设置 is clicked", () => {
    const { vscode } = renderChatApp();

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-settings"));
    });

    // IDE hosts open the settings tab webview in the editor area (spec 场景 10)
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "openSettings" }),
    );
    // Menu closes after selection
    expect(screen.queryByTestId("more-menu")).not.toBeInTheDocument();
  });

  it("should post openExternal with the serverUrl when 企业控制台 is clicked", () => {
    const { vscode } = renderChatApp();

    act(() => {
      sendCommand("configurationResponse", {
        configurationData: { serverUrl: "https://console.example.com" },
      });
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
      sendCommand("configurationResponse", {
        configurationData: { serverUrl: "https://codechat.example.com/" },
      });
    });

    vscode.postMessage.mockClear();
    openMoreMenu();

    act(() => {
      fireEvent.click(screen.getByTestId("more-menu-help-docs"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "openExternal",
        url: "https://codechat.example.com/docs",
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
