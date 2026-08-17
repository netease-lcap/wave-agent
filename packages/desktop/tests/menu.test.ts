import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Input, MenuItemConstructorOptions } from "electron";
import { Menu } from "electron";
import {
  buildApplicationMenuTemplate,
  installApplicationMenu,
  matchPanelToggleInput,
  matchSessionSwitchInput,
  updateMenuState,
} from "../src/main/menu";

const keyEvent = (overrides: Partial<Input>): Input =>
  ({
    type: "keyDown",
    key: "",
    code: "",
    isAutoRepeat: false,
    isComposing: false,
    shift: false,
    control: false,
    alt: false,
    meta: false,
    ...overrides,
  }) as Input;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("matchSessionSwitchInput", () => {
  it("maps Ctrl+Tab to next and Ctrl+Shift+Tab to prev", () => {
    expect(
      matchSessionSwitchInput(keyEvent({ key: "Tab", control: true }), false),
    ).toBe("next");
    expect(
      matchSessionSwitchInput(
        keyEvent({ key: "Tab", control: true, shift: true }),
        false,
      ),
    ).toBe("prev");
  });

  it("accepts rawKeyDown (non-text presses arrive as rawKeyDown on some platforms)", () => {
    expect(
      matchSessionSwitchInput(
        keyEvent({ type: "rawKeyDown", key: "Tab", control: true }),
        false,
      ),
    ).toBe("next");
    expect(
      matchSessionSwitchInput(
        keyEvent({
          type: "rawKeyDown",
          key: "Tab",
          control: true,
          shift: true,
        }),
        false,
      ),
    ).toBe("prev");
  });

  it("ignores keyUp and char events", () => {
    expect(
      matchSessionSwitchInput(
        keyEvent({ type: "keyUp", key: "Tab", control: true }),
        false,
      ),
    ).toBeNull();
    expect(
      matchSessionSwitchInput(
        keyEvent({ type: "char", key: "Tab", control: true }),
        false,
      ),
    ).toBeNull();
  });

  it("ignores plain Tab and Tab with extra modifiers", () => {
    expect(matchSessionSwitchInput(keyEvent({ key: "Tab" }), false)).toBeNull();
    expect(
      matchSessionSwitchInput(keyEvent({ key: "Tab", shift: true }), false),
    ).toBeNull();
    // Ctrl+Alt+Tab is the OS window switcher on some platforms — leave it alone.
    expect(
      matchSessionSwitchInput(
        keyEvent({ key: "Tab", control: true, alt: true }),
        false,
      ),
    ).toBeNull();
    expect(
      matchSessionSwitchInput(
        keyEvent({ key: "Tab", control: true, meta: true }),
        true,
      ),
    ).toBeNull();
  });

  it("maps Cmd+Shift+]/[ on macOS, matching on code (Shift turns ] into } in key)", () => {
    expect(
      matchSessionSwitchInput(
        keyEvent({ key: "}", code: "BracketRight", meta: true, shift: true }),
        true,
      ),
    ).toBe("next");
    expect(
      matchSessionSwitchInput(
        keyEvent({ key: "{", code: "BracketLeft", meta: true, shift: true }),
        true,
      ),
    ).toBe("prev");
  });

  it("rejects the bracket combos off macOS or with wrong modifiers", () => {
    // Windows/Linux: Cmd(Win)+Shift+] must not switch sessions.
    expect(
      matchSessionSwitchInput(
        keyEvent({ code: "BracketRight", meta: true, shift: true }),
        false,
      ),
    ).toBeNull();
    // Without Shift, Cmd+] / Cmd+[ are not session-switch keys.
    expect(
      matchSessionSwitchInput(
        keyEvent({ code: "BracketRight", meta: true }),
        true,
      ),
    ).toBeNull();
    expect(
      matchSessionSwitchInput(
        keyEvent({
          code: "BracketRight",
          meta: true,
          shift: true,
          control: true,
        }),
        true,
      ),
    ).toBeNull();
  });
});

describe("matchPanelToggleInput", () => {
  it("maps Shift+Cmd+P/D/F to preview/diff/file on macOS, matching on code", () => {
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "P", code: "KeyP", meta: true, shift: true }),
        true,
      ),
    ).toBe("preview");
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "D", code: "KeyD", meta: true, shift: true }),
        true,
      ),
    ).toBe("diff");
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "F", code: "KeyF", meta: true, shift: true }),
        true,
      ),
    ).toBe("file");
  });

  it("maps Ctrl+Shift+P/D/F to preview/diff/file on Windows/Linux", () => {
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "P", code: "KeyP", control: true, shift: true }),
        false,
      ),
    ).toBe("preview");
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "D", code: "KeyD", control: true, shift: true }),
        false,
      ),
    ).toBe("diff");
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "F", code: "KeyF", control: true, shift: true }),
        false,
      ),
    ).toBe("file");
  });

  it("maps Ctrl+` to terminal on every platform", () => {
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "`", code: "Backquote", control: true }),
        true,
      ),
    ).toBe("terminal");
    expect(
      matchPanelToggleInput(
        keyEvent({ key: "`", code: "Backquote", control: true }),
        false,
      ),
    ).toBe("terminal");
  });

  it("accepts rawKeyDown for non-text presses", () => {
    expect(
      matchPanelToggleInput(
        keyEvent({ type: "rawKeyDown", code: "KeyF", meta: true, shift: true }),
        true,
      ),
    ).toBe("file");
  });

  it("ignores keyUp/char events", () => {
    expect(
      matchPanelToggleInput(
        keyEvent({ type: "keyUp", code: "KeyF", meta: true, shift: true }),
        true,
      ),
    ).toBeNull();
    expect(
      matchPanelToggleInput(
        keyEvent({ type: "char", code: "KeyF", meta: true, shift: true }),
        true,
      ),
    ).toBeNull();
  });

  it("rejects the letter combos without Shift, on the wrong platform, or with extra modifiers", () => {
    // Without Shift: Cmd+F / Cmd+P are not panel toggles.
    expect(
      matchPanelToggleInput(keyEvent({ code: "KeyF", meta: true }), true),
    ).toBeNull();
    // macOS: Cmd+Shift+F on the wrong primary (control) must not toggle.
    expect(
      matchPanelToggleInput(
        keyEvent({ code: "KeyF", control: true, shift: true }),
        true,
      ),
    ).toBeNull();
    // Windows/Linux: Meta(Win)+Shift+F must not toggle.
    expect(
      matchPanelToggleInput(
        keyEvent({ code: "KeyF", meta: true, shift: true }),
        false,
      ),
    ).toBeNull();
    // Ctrl+Alt+Shift+F (OS-level) must be left alone.
    expect(
      matchPanelToggleInput(
        keyEvent({ code: "KeyF", control: true, shift: true, alt: true }),
        false,
      ),
    ).toBeNull();
    // Non-panel keys (e.g. KeyA) return null.
    expect(
      matchPanelToggleInput(
        keyEvent({ code: "KeyA", meta: true, shift: true }),
        true,
      ),
    ).toBeNull();
  });
});

describe("buildApplicationMenuTemplate", () => {
  const actions = {
    nextSession: vi.fn(),
    prevSession: vi.fn(),
    newSession: vi.fn(),
    newSessionInPane: vi.fn(),
    closePane: vi.fn(),
    togglePanel: vi.fn(),
  };

  function sessionMenuItems(isMac: boolean): MenuItemConstructorOptions[] {
    const template = buildApplicationMenuTemplate(actions, isMac);
    const sessionMenu = template.find((item) => item.label === "对话");
    expect(sessionMenu).toBeDefined();
    return sessionMenu?.submenu as MenuItemConstructorOptions[];
  }

  function itemByLabel(
    isMac: boolean,
    label: string,
  ): MenuItemConstructorOptions {
    const item = sessionMenuItems(isMac).find((i) => i.label === label);
    expect(item).toBeDefined();
    return item as MenuItemConstructorOptions;
  }

  it("shows Ctrl+Tab / Ctrl+Shift+Tab on Windows/Linux", () => {
    expect(itemByLabel(false, "下一个对话")).toMatchObject({
      accelerator: "Ctrl+Tab",
      registerAccelerator: false,
    });
    expect(itemByLabel(false, "上一个对话")).toMatchObject({
      accelerator: "Ctrl+Shift+Tab",
      registerAccelerator: false,
    });
  });

  it("shows Cmd+Shift+] / Cmd+Shift+[ plus the macOS app menu on macOS", () => {
    const template = buildApplicationMenuTemplate(actions, true);
    expect(template[0]).toMatchObject({ role: "appMenu" });
    expect(itemByLabel(true, "下一个对话")).toMatchObject({
      accelerator: "Cmd+Shift+]",
      registerAccelerator: false,
    });
    expect(itemByLabel(true, "上一个对话")).toMatchObject({
      accelerator: "Cmd+Shift+[",
      registerAccelerator: false,
    });
  });

  it("offers 新对话 / 关闭分屏 as registered accelerators that override the window defaults", () => {
    for (const isMac of [true, false]) {
      // Registered (registerAccelerator undefined): the accelerator fires
      // app-wide and preempts Electron's new-window / close-window defaults.
      expect(itemByLabel(isMac, "新对话")).toMatchObject({
        id: "new-session",
        accelerator: "CmdOrCtrl+N",
      });
      expect(itemByLabel(isMac, "关闭分屏")).toMatchObject({
        id: "close-pane",
        accelerator: "CmdOrCtrl+W",
      });
    }
  });

  it("offers 并排新对话 as a registered CmdOrCtrl+Shift+N accelerator on both platforms", () => {
    for (const isMac of [true, false]) {
      // Registered like Cmd+N: fires app-wide, including while the preview
      // guest or terminal panel has focus.
      expect(itemByLabel(isMac, "并排新对话")).toMatchObject({
        id: "new-session-in-pane",
        accelerator: "CmdOrCtrl+Shift+N",
      });
    }
  });

  it("localizes the platform menus (文件/编辑/视图/窗口) without role menus off macOS", () => {
    for (const isMac of [true, false]) {
      const template = buildApplicationMenuTemplate(actions, isMac);
      // Role menus (fileMenu/editMenu/viewMenu/windowMenu) are replaced by
      // explicit localized menus; macOS keeps only the appMenu role.
      const roles = template.map((item) => item.role);
      expect(roles).not.toEqual(
        expect.arrayContaining([
          "fileMenu",
          "editMenu",
          "viewMenu",
          "windowMenu",
        ]),
      );
      for (const label of ["文件", "编辑", "对话", "面板", "视图", "窗口"]) {
        expect(template.some((item) => item.label === label)).toBe(true);
      }
    }
  });

  it("keeps standard roles inside 编辑/视图 with Chinese labels", () => {
    const submenuRoles = (
      template: MenuItemConstructorOptions[],
      label: string,
    ) =>
      (
        template.find((item) => item.label === label)
          ?.submenu as MenuItemConstructorOptions[]
      ).map((item) => item.role);
    for (const isMac of [true, false]) {
      const template = buildApplicationMenuTemplate(actions, isMac);
      expect(submenuRoles(template, "编辑")).toEqual(
        expect.arrayContaining([
          "undo",
          "redo",
          "cut",
          "copy",
          "paste",
          "delete",
          "selectAll",
          ...(isMac ? (["pasteAndMatchStyle"] as string[]) : []),
        ]),
      );
      expect(submenuRoles(template, "视图")).toEqual(
        expect.arrayContaining([
          "reload",
          "forceReload",
          "toggleDevTools",
          "resetZoom",
          "zoomIn",
          "zoomOut",
          "togglefullscreen",
        ]),
      );
    }
  });

  it("offers 退出 on Windows/Linux and Close Window (no Cmd+W) on macOS", () => {
    const winFileMenu = buildApplicationMenuTemplate(actions, false).find(
      (item) => item.label === "文件",
    );
    expect(winFileMenu?.submenu).toMatchObject([
      { role: "quit", label: "退出" },
    ]);
    const macFileMenu = buildApplicationMenuTemplate(actions, true).find(
      (item) => item.label === "文件",
    );
    expect(macFileMenu?.submenu).toMatchObject([
      { role: "close", accelerator: "", label: "关闭窗口" },
    ]);
  });

  it("关闭分屏 is the only Cmd+W claimant in the whole menu", () => {
    const collectAccelerators = (
      items: MenuItemConstructorOptions[],
    ): string[] =>
      items.flatMap((item) => [
        ...(typeof item.accelerator === "string" ? [item.accelerator] : []),
        ...(Array.isArray(item.submenu)
          ? collectAccelerators(item.submenu)
          : []),
      ]);
    for (const isMac of [true, false]) {
      const cmdW = collectAccelerators(
        buildApplicationMenuTemplate(actions, isMac),
      ).filter((a) =>
        /^(CmdOrCtrl|CommandOrControl|Cmd|Command|Ctrl|Control)\+W$/i.test(a),
      );
      expect(cmdW).toEqual(["CmdOrCtrl+W"]);
    }
  });

  it("macOS keeps a clickable Close Window item without the Cmd+W accelerator", () => {
    const fileMenu = buildApplicationMenuTemplate(actions, true).find(
      (item) => item.label === "文件",
    );
    expect(fileMenu).toMatchObject({
      submenu: [{ role: "close", accelerator: "" }],
    });
  });

  function panelMenuItems(isMac: boolean): MenuItemConstructorOptions[] {
    const template = buildApplicationMenuTemplate(actions, isMac);
    const panelMenu = template.find((item) => item.label === "面板");
    expect(panelMenu).toBeDefined();
    return panelMenu?.submenu as MenuItemConstructorOptions[];
  }

  function panelItemByLabel(
    isMac: boolean,
    label: string,
  ): MenuItemConstructorOptions {
    const item = panelMenuItems(isMac).find((i) => i.label === label);
    expect(item).toBeDefined();
    return item as MenuItemConstructorOptions;
  }

  it("shows the panel toggles with informational accelerators (registerAccelerator: false)", () => {
    // macOS: Shift+Cmd+P / Shift+Cmd+D / Shift+Cmd+F; terminal is Ctrl+`.
    expect(panelItemByLabel(true, "预览")).toMatchObject({
      accelerator: "Shift+Cmd+P",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(true, "差异")).toMatchObject({
      accelerator: "Shift+Cmd+D",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(true, "文件")).toMatchObject({
      accelerator: "Shift+Cmd+F",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(true, "终端")).toMatchObject({
      accelerator: "Ctrl+`",
      registerAccelerator: false,
    });
    // Windows/Linux: Ctrl+Shift+P / Ctrl+Shift+D / Ctrl+Shift+F; terminal still Ctrl+`.
    expect(panelItemByLabel(false, "预览")).toMatchObject({
      accelerator: "Ctrl+Shift+P",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(false, "差异")).toMatchObject({
      accelerator: "Ctrl+Shift+D",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(false, "文件")).toMatchObject({
      accelerator: "Ctrl+Shift+F",
      registerAccelerator: false,
    });
    expect(panelItemByLabel(false, "终端")).toMatchObject({
      accelerator: "Ctrl+`",
      registerAccelerator: false,
    });
  });

  it("menu item clicks take the same code path as the keys", () => {
    itemByLabel(false, "下一个对话").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    itemByLabel(false, "上一个对话").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    itemByLabel(false, "新对话").click?.({} as never, {} as never, {} as never);
    itemByLabel(false, "并排新对话").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    itemByLabel(false, "关闭分屏").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    panelItemByLabel(false, "预览").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    panelItemByLabel(false, "差异").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    panelItemByLabel(false, "终端").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    panelItemByLabel(false, "文件").click?.(
      {} as never,
      {} as never,
      {} as never,
    );
    expect(actions.nextSession).toHaveBeenCalledTimes(1);
    expect(actions.prevSession).toHaveBeenCalledTimes(1);
    expect(actions.newSession).toHaveBeenCalledTimes(1);
    expect(actions.newSessionInPane).toHaveBeenCalledTimes(1);
    expect(actions.closePane).toHaveBeenCalledTimes(1);
    expect(actions.togglePanel).toHaveBeenCalledTimes(4);
    expect(actions.togglePanel).toHaveBeenNthCalledWith(1, "preview");
    expect(actions.togglePanel).toHaveBeenNthCalledWith(2, "diff");
    expect(actions.togglePanel).toHaveBeenNthCalledWith(3, "terminal");
    expect(actions.togglePanel).toHaveBeenNthCalledWith(4, "file");
  });
});

describe("updateMenuState", () => {
  it("toggles the 新对话 / 并排新对话 / 关闭分屏 items by id", () => {
    const items = (
      Menu as unknown as { __mockMenuItems: Map<string, { enabled: boolean }> }
    ).__mockMenuItems;
    items.set("new-session", { enabled: true });
    items.set("new-session-in-pane", { enabled: true });
    items.set("close-pane", { enabled: true });

    updateMenuState({ canNewSession: false, canClosePane: true });
    expect(items.get("new-session")?.enabled).toBe(false);
    expect(items.get("new-session-in-pane")?.enabled).toBe(false);
    expect(items.get("close-pane")?.enabled).toBe(true);

    updateMenuState({ canNewSession: true, canClosePane: false });
    expect(items.get("new-session")?.enabled).toBe(true);
    expect(items.get("new-session-in-pane")?.enabled).toBe(true);
    expect(items.get("close-pane")?.enabled).toBe(false);
  });
});

describe("installApplicationMenu", () => {
  it("builds and sets the application menu", () => {
    installApplicationMenu({
      nextSession: vi.fn(),
      prevSession: vi.fn(),
      newSession: vi.fn(),
      newSessionInPane: vi.fn(),
      closePane: vi.fn(),
      togglePanel: vi.fn(),
    });
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});
