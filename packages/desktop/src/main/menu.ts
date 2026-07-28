/**
 * Application menu + session-switch shortcuts (FR-038).
 *
 * The switch keys — Ctrl+Tab / Ctrl+Shift+Tab on every platform, plus
 * Cmd+Shift+] / Cmd+Shift+[ on macOS (aligned with Claude Code Desktop) — are
 * handled via `before-input-event`, NOT registered menu accelerators:
 * Chromium never delivers Ctrl+Tab to the page, and before-input-event is the
 * single interception point that works identically across platforms and
 * covers both the main window and the preview <webview> guest. Menu items
 * therefore carry `registerAccelerator: false` — the displayed shortcut is
 * informational, and clicking the item takes the exact same code path.
 */

import { Menu, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron';

export interface SessionSwitchActions {
  nextSession: () => void;
  prevSession: () => void;
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
