import { renderChatApp, screen, fireEvent, waitFor } from "./test-utils";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

/**
 * Keyboard accessibility of the custom dropdowns in the message input:
 * items must be Tab-focusable and activatable with Enter/Space, and Escape
 * must close the menu and return focus to its trigger button.
 */
describe("Message input dropdown keyboard accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const openPlusMenu = () => {
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
  };

  it("should make + menu items Tab-focusable and activate them with Enter", () => {
    renderChatApp();
    // jsdom has no real file dialog; silence the hidden file input click.
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});
    openPlusMenu();

    const uploadItem = screen.getByRole("menuitem", { name: "上传文件" });
    const historyItem = screen.getByRole("menuitem", { name: "历史提示词" });
    expect(uploadItem).toHaveProperty("tabIndex", 0);
    expect(historyItem).toHaveProperty("tabIndex", 0);

    // Enter activates the item and closes the menu.
    uploadItem.focus();
    fireEvent.keyDown(uploadItem, { key: "Enter" });
    expect(clickSpy).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("should activate + menu items with Space and open the history popup", async () => {
    renderChatApp();
    openPlusMenu();

    const historyItem = screen.getByRole("menuitem", { name: "历史提示词" });
    historyItem.focus();
    fireEvent.keyDown(historyItem, { key: " " });

    await screen.findByTestId("history-search-popup");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("should close the + menu with Escape and return focus to the + button", () => {
    renderChatApp();
    openPlusMenu();

    const uploadItem = screen.getByRole("menuitem", { name: "上传文件" });
    uploadItem.focus();
    fireEvent.keyDown(uploadItem, { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "添加" }),
    );
  });

  it("should make the permission menu a roving-tabindex listbox (Arrow keys + Enter)", async () => {
    const { vscode } = renderChatApp();
    fireEvent.click(screen.getByRole("button", { name: "权限模式" }));

    // The currently selected option is the single tab stop and takes focus
    // when the menu opens; the others are removed from the tab order.
    const selected = screen.getByRole("option", { name: "修改前询问" });
    const next = screen.getByRole("option", { name: "自动接受修改" });
    expect(selected).toHaveProperty("tabIndex", 0);
    expect(next).toHaveProperty("tabIndex", -1);
    await waitFor(() => {
      expect(selected).toBe(document.activeElement);
    });

    // ArrowDown roves focus to the next option (it becomes the tab stop).
    fireEvent.keyDown(selected, { key: "ArrowDown" });
    expect(next).toBe(document.activeElement);
    expect(next).toHaveProperty("tabIndex", 0);

    // Enter activates the focused option and closes the menu.
    fireEvent.keyDown(next, { key: "Enter" });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setPermissionMode",
      mode: "acceptEdits",
    });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("should close the permission menu with Tab and leave the mode unchanged", () => {
    const { vscode } = renderChatApp();
    fireEvent.click(screen.getByRole("button", { name: "权限模式" }));

    const option = screen.getByRole("option", { name: "计划模式" });
    option.focus();
    fireEvent.keyDown(option, { key: "Tab" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith({
      command: "setPermissionMode",
      mode: "plan",
    });
  });

  it("should close the permission menu with Escape and return focus to its button", () => {
    renderChatApp();
    fireEvent.click(screen.getByRole("button", { name: "权限模式" }));

    const option = screen.getByRole("option", { name: "计划模式" });
    option.focus();
    fireEvent.keyDown(option, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "权限模式" }),
    );
  });
});
