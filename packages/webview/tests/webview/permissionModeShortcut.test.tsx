import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendCommand,
} from "./test-utils";

describe("Permission Mode Shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should open the permission mode menu on Cmd+Shift+M (macOS)", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const input = screen.getByTestId("message-input");
    expect(
      document.querySelector(".permission-mode-menu"),
    ).not.toBeInTheDocument();

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.keyDown(input, {
        code: "KeyM",
        metaKey: true,
        shiftKey: true,
      });
    });

    // Opens the menu without directly switching the mode
    const menu = document.querySelector(".permission-mode-menu");
    expect(menu).toBeInTheDocument();
    const optionValues = Array.from(
      document.querySelectorAll(".permission-mode-item"),
    ).map((o) => o.getAttribute("data-value"));
    expect(optionValues).toEqual([
      "default",
      "acceptEdits",
      "bypassPermissions",
      "plan",
    ]);
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "setPermissionMode",
      mode: "acceptEdits",
    });

    // Focus lands on the currently selected option so Enter/Space confirm
    // immediately and Escape closes
    await waitFor(() => {
      expect(document.querySelector(".permission-mode-item.selected")).toBe(
        document.activeElement,
      );
    });
  });

  it("should open the permission mode menu on Ctrl+Shift+M (Windows/Linux)", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "acceptEdits",
        configurationData: {},
      });
    });

    const input = screen.getByTestId("message-input");
    await act(async () => {
      fireEvent.keyDown(input, {
        code: "KeyM",
        ctrlKey: true,
        shiftKey: true,
      });
    });

    expect(document.querySelector(".permission-mode-menu")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        document.querySelector(
          '.permission-mode-item.selected[data-value="acceptEdits"]',
        ),
      ).toBe(document.activeElement);
    });
  });

  it("should select a mode from the shortcut-opened menu", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const input = screen.getByTestId("message-input");
    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.keyDown(input, {
        code: "KeyM",
        metaKey: true,
        shiftKey: true,
      });
    });
    await act(async () => {
      fireEvent.click(
        document.querySelector(
          '.permission-mode-item[data-value="acceptEdits"]',
        ) as HTMLElement,
      );
    });

    await waitFor(() => {
      expect(vscode.postMessage).toHaveBeenCalledWith({
        command: "setPermissionMode",
        mode: "acceptEdits",
      });
    });
    expect(
      document.querySelector(".permission-mode-menu"),
    ).not.toBeInTheDocument();
  });

  it("should not cycle the permission mode on Shift+Tab", async () => {
    const { vscode } = renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const input = screen.getByTestId("message-input");
    const select = document.querySelector(
      ".permission-mode-select",
    ) as HTMLElement;
    expect(select.className).toContain("mode-default");

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "setPermissionMode",
      mode: "acceptEdits",
    });
    expect(
      document.querySelector(".permission-mode-menu"),
    ).not.toBeInTheDocument();
    expect(select.className).toContain("mode-default");
  });

  it("should update the select visual style when mode changes via extension update", async () => {
    renderChatApp();

    await act(async () => {
      sendCommand("setInitialState", {
        messages: [],
        permissionMode: "default",
        configurationData: {},
      });
    });

    const select = document.querySelector(
      ".permission-mode-select",
    ) as HTMLElement;
    expect(select.className).toContain("mode-default");

    // Simulate extension sending a different mode (e.g. from external change)
    await act(async () => {
      sendCommand("updatePermissionMode", { mode: "plan" });
    });

    expect(select.className).toContain("mode-plan");
    expect(select.className).not.toContain("mode-default");
  });
});
