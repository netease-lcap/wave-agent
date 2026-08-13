/**
 * Application menu + session-switch + 新对话/并排新对话/关闭分屏
 * (CmdOrCtrl+N / CmdOrCtrl+Shift+N / CmdOrCtrl+W) + panel-toggle shortcuts.
 *
 * The switch keys — Ctrl+Tab / Ctrl+Shift+Tab on every platform, plus
 * Cmd+Shift+] / Cmd+Shift+[ on macOS (aligned with Claude Code Desktop) — and
 * the panel-toggle keys (Shift+Cmd+P / Shift+Cmd+D / Ctrl+` on macOS) are
 * handled via `before-input-event`, NOT registered menu accelerators:
 * Chromium never delivers Ctrl+Tab to the page, and before-input-event is the
 * single interception point that works identically across platforms and
 * covers both the main window and the preview <webview> guest. Menu items
 * therefore carry `registerAccelerator: false` — the displayed shortcut is
 * informational, and clicking the item takes the exact same code path.
 *
 * CmdOrCtrl+N / CmdOrCtrl+Shift+N / CmdOrCtrl+W, in contrast, ARE registered
 * accelerators: menu accelerators fire app-wide (even while the preview guest
 * has focus) and — for Cmd+N / Cmd+W — preempt the default Electron behavior
 * (new window / close window), which the single-window app must suppress.
 *
 * For that preemption to work, 关闭分屏 must be the ONLY Cmd+W claimant: the
 * default fileMenu role expands to File → Close Window (Cmd+W) on macOS, and
 * windowMenu to Minimize / Zoom / Close (Cmd+W) off macOS. Both precede the
 * 对话 menu in menu-bar order, so their Cmd+W would win and close the whole
 * window. buildApplicationMenuTemplate therefore keeps those items but
 * strips their Cmd+W accelerator.
 */

import {
  Menu,
  type Input,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";

export type PanelKind = "preview" | "diff" | "terminal" | "file";

export interface DesktopMenuActions {
  nextSession: () => void;
  prevSession: () => void;
  newSession: () => void;
  newSessionInPane: () => void;
  closePane: () => void;
  togglePanel: (kind: PanelKind) => void;
}

export interface SessionMenuState {
  canNewSession: boolean;
  canClosePane: boolean;
}

type SwitchDirection = "next" | "prev";

/**
 * Map a before-input-event Input to a switch direction, or null when the key
 * is unrelated. Modifier sets must match exactly so combos like Ctrl+Alt+Tab
 * (OS window switcher) are left alone. The macOS bracket combos match on
 * `code` rather than `key` because Shift turns ]/[ into }/{ in `key`.
 */
export function matchSessionSwitchInput(
  input: Input,
  isMac: boolean,
): SwitchDirection | null {
  // Non-text key presses arrive as keyDown or rawKeyDown depending on
  // platform/modifiers; a single press never emits both.
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (input.control && !input.meta && !input.alt && input.key === "Tab") {
    return input.shift ? "prev" : "next";
  }
  if (isMac && input.meta && input.shift && !input.control && !input.alt) {
    if (input.code === "BracketRight") return "next";
    if (input.code === "BracketLeft") return "prev";
  }
  return null;
}

/**
 * Map a before-input-event Input to a panel kind, or null when unrelated.
 * macOS: Shift+Cmd+P (preview) / Shift+Cmd+D (diff) / Shift+Cmd+F (file);
 * Windows/Linux: Ctrl+Shift+P / Ctrl+Shift+D / Ctrl+Shift+F; terminal is
 * Ctrl+` on every platform.
 * Letters match on `code` because Shift uppercases them in `key`.
 */
export function matchPanelToggleInput(
  input: Input,
  isMac: boolean,
): PanelKind | null {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return null;
  if (
    input.control &&
    !input.meta &&
    !input.alt &&
    !input.shift &&
    input.code === "Backquote"
  ) {
    return "terminal";
  }
  const primary = isMac ? input.meta : input.control;
  const secondary = isMac ? input.control : input.meta;
  if (primary && input.shift && !secondary && !input.alt) {
    if (input.code === "KeyP") return "preview";
    if (input.code === "KeyD") return "diff";
    if (input.code === "KeyF") return "file";
  }
  return null;
}

/** Full application menu: platform defaults + 对话/面板 menus. */
export function buildApplicationMenuTemplate(
  actions: DesktopMenuActions,
  isMac: boolean,
  panelChecked: PanelKind[] = [],
): MenuItemConstructorOptions[] {
  return [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    // macOS fileMenu = Close Window (Cmd+W) — keep the item so the window can
    // still be closed from the menu, but strip the accelerator (an explicit
    // '' overrides the role default) so 关闭分屏 is the sole Cmd+W claimant.
    isMac
      ? { label: "文件", submenu: [{ role: "close", accelerator: "" }] }
      : { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "对话",
      submenu: [
        {
          id: "new-session",
          label: "新对话",
          accelerator: "CmdOrCtrl+N",
          click: () => actions.newSession(),
        },
        {
          id: "new-session-in-pane",
          label: "并排新对话",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => actions.newSessionInPane(),
        },
        {
          id: "close-pane",
          label: "关闭分屏",
          accelerator: "CmdOrCtrl+W",
          click: () => actions.closePane(),
        },
        { type: "separator" },
        {
          label: "下一个对话",
          accelerator: isMac ? "Cmd+Shift+]" : "Ctrl+Tab",
          registerAccelerator: false,
          click: () => actions.nextSession(),
        },
        {
          label: "上一个对话",
          accelerator: isMac ? "Cmd+Shift+[" : "Ctrl+Shift+Tab",
          registerAccelerator: false,
          click: () => actions.prevSession(),
        },
      ],
    },
    {
      label: "面板",
      submenu: [
        {
          label: "预览",
          type: "checkbox",
          checked: panelChecked.includes("preview"),
          accelerator: isMac ? "Shift+Cmd+P" : "Ctrl+Shift+P",
          registerAccelerator: false,
          click: () => actions.togglePanel("preview"),
        },
        {
          label: "差异",
          type: "checkbox",
          checked: panelChecked.includes("diff"),
          accelerator: isMac ? "Shift+Cmd+D" : "Ctrl+Shift+D",
          registerAccelerator: false,
          click: () => actions.togglePanel("diff"),
        },
        {
          label: "终端",
          type: "checkbox",
          checked: panelChecked.includes("terminal"),
          accelerator: "Ctrl+`",
          registerAccelerator: false,
          click: () => actions.togglePanel("terminal"),
        },
        {
          label: "文件",
          type: "checkbox",
          checked: panelChecked.includes("file"),
          accelerator: isMac ? "Shift+Cmd+F" : "Ctrl+Shift+F",
          registerAccelerator: false,
          click: () => actions.togglePanel("file"),
        },
      ],
    },
    { role: "viewMenu" },
    // Off macOS windowMenu ends with Close (Cmd+W) — same conflict, so keep
    // only Minimize / Zoom. The macOS windowMenu has no Close item.
    isMac
      ? { role: "windowMenu" }
      : { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }] },
  ];
}

export function installApplicationMenu(
  actions: DesktopMenuActions,
  panelChecked: PanelKind[] = [],
): void {
  const template = buildApplicationMenuTemplate(
    actions,
    process.platform === "darwin",
    panelChecked,
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Reflect host pane/streaming state in the 新对话 / 关闭分屏 menu items. */
export function updateMenuState(state: SessionMenuState): void {
  const menu = Menu.getApplicationMenu();
  const newItem = menu?.getMenuItemById("new-session");
  if (newItem) newItem.enabled = state.canNewSession;
  const newPaneItem = menu?.getMenuItemById("new-session-in-pane");
  if (newPaneItem) newPaneItem.enabled = state.canNewSession;
  const closeItem = menu?.getMenuItemById("close-pane");
  if (closeItem) closeItem.enabled = state.canClosePane;
}

/** Wire the switch/toggle keys onto a webContents (main window or preview guest). */
export function attachDesktopShortcutKeys(
  contents: WebContents,
  actions: DesktopMenuActions,
): void {
  contents.on("before-input-event", (event, input) => {
    const isMac = process.platform === "darwin";
    const direction = matchSessionSwitchInput(input, isMac);
    if (direction) {
      event.preventDefault();
      if (direction === "next") actions.nextSession();
      else actions.prevSession();
      return;
    }
    const kind = matchPanelToggleInput(input, isMac);
    if (kind) {
      event.preventDefault();
      actions.togglePanel(kind);
    }
  });
}
