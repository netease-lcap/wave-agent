/**
 * Application menu + session-switch shortcuts (FR-038) + 新对话/关闭分屏
 * shortcuts (CmdOrCtrl+N / CmdOrCtrl+W).
 *
 * The switch keys — Ctrl+Tab / Ctrl+Shift+Tab on every platform, plus
 * Cmd+Shift+] / Cmd+Shift+[ on macOS (aligned with Claude Code Desktop) — are
 * handled via `before-input-event`, NOT registered menu accelerators:
 * Chromium never delivers Ctrl+Tab to the page, and before-input-event is the
 * single interception point that works identically across platforms and
 * covers both the main window and the preview <webview> guest. Menu items
 * therefore carry `registerAccelerator: false` — the displayed shortcut is
 * informational, and clicking the item takes the exact same code path.
 *
 * CmdOrCtrl+N / CmdOrCtrl+W, in contrast, ARE registered accelerators: menu
 * accelerators fire app-wide (even while the preview guest has focus) and
 * preempt the default Electron behavior (new window / close window), which
 * the single-window app must suppress.
 */

import { Menu, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron';

export interface SessionSwitchActions {
  nextSession: () => void;
  prevSession: () => void;
  newSession: () => void;
  closePane: () => void;
}

export interface SessionMenuState {
  canNewSession: boolean;
  canClosePane: boolean;
}

type SwitchDirection = 'next' | 'prev';

/**
 * Map a before-input-event Input to a switch direction, or null when the key
 * is unrelated. Modifier sets must match exactly so combos like Ctrl+Alt+Tab
 * (OS window switcher) are left alone. The macOS bracket combos match on
 * `code` rather than `key` because Shift turns ]/[ into }/{ in `key`.
 */
export function matchSessionSwitchInput(input: Input, isMac: boolean): SwitchDirection | null {
  // Non-text key presses arrive as keyDown or rawKeyDown depending on
  // platform/modifiers; a single press never emits both.
  if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') return null;
  if (input.control && !input.meta && !input.alt && input.key === 'Tab') {
    return input.shift ? 'prev' : 'next';
  }
  if (isMac && input.meta && input.shift && !input.control && !input.alt) {
    if (input.code === 'BracketRight') return 'next';
    if (input.code === 'BracketLeft') return 'prev';
  }
  return null;
}

/** Full application menu: platform defaults + the 会话 menu with the switch items. */
export function buildApplicationMenuTemplate(
  actions: SessionSwitchActions,
  isMac: boolean,
): MenuItemConstructorOptions[] {
  return [
    ...(isMac ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: '会话',
      submenu: [
        {
          id: 'new-session',
          label: '新对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => actions.newSession(),
        },
        {
          id: 'close-pane',
          label: '关闭分屏',
          accelerator: 'CmdOrCtrl+W',
          click: () => actions.closePane(),
        },
        { type: 'separator' },
        {
          label: '下一个会话',
          accelerator: isMac ? 'Cmd+Shift+]' : 'Ctrl+Tab',
          registerAccelerator: false,
          click: () => actions.nextSession(),
        },
        {
          label: '上一个会话',
          accelerator: isMac ? 'Cmd+Shift+[' : 'Ctrl+Shift+Tab',
          registerAccelerator: false,
          click: () => actions.prevSession(),
        },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}

export function installApplicationMenu(actions: SessionSwitchActions): void {
  const template = buildApplicationMenuTemplate(actions, process.platform === 'darwin');
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Reflect host pane/streaming state in the 新对话 / 关闭分屏 menu items. */
export function updateMenuState(state: SessionMenuState): void {
  const menu = Menu.getApplicationMenu();
  const newItem = menu?.getMenuItemById('new-session');
  if (newItem) newItem.enabled = state.canNewSession;
  const closeItem = menu?.getMenuItemById('close-pane');
  if (closeItem) closeItem.enabled = state.canClosePane;
}

/** Wire the switch keys onto a webContents (main window or preview guest). */
export function attachSessionSwitchKeys(contents: WebContents, actions: SessionSwitchActions): void {
  contents.on('before-input-event', (event, input) => {
    const direction = matchSessionSwitchInput(input, process.platform === 'darwin');
    if (!direction) return;
    event.preventDefault();
    if (direction === 'next') actions.nextSession();
    else actions.prevSession();
  });
}
