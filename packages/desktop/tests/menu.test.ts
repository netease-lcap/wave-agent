import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Input, MenuItemConstructorOptions } from 'electron';
import { Menu } from 'electron';
import {
  buildApplicationMenuTemplate,
  installApplicationMenu,
  matchSessionSwitchInput,
  updateMenuState,
} from '../src/main/menu';

const keyEvent = (overrides: Partial<Input>): Input =>
  ({
    type: 'keyDown',
    key: '',
    code: '',
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

describe('matchSessionSwitchInput', () => {
  it('maps Ctrl+Tab to next and Ctrl+Shift+Tab to prev', () => {
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab', control: true }), false)).toBe('next');
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab', control: true, shift: true }), false)).toBe('prev');
  });

  it('accepts rawKeyDown (non-text presses arrive as rawKeyDown on some platforms)', () => {
    expect(matchSessionSwitchInput(keyEvent({ type: 'rawKeyDown', key: 'Tab', control: true }), false)).toBe('next');
    expect(matchSessionSwitchInput(keyEvent({ type: 'rawKeyDown', key: 'Tab', control: true, shift: true }), false)).toBe('prev');
  });

  it('ignores keyUp and char events', () => {
    expect(matchSessionSwitchInput(keyEvent({ type: 'keyUp', key: 'Tab', control: true }), false)).toBeNull();
    expect(matchSessionSwitchInput(keyEvent({ type: 'char', key: 'Tab', control: true }), false)).toBeNull();
  });

  it('ignores plain Tab and Tab with extra modifiers', () => {
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab' }), false)).toBeNull();
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab', shift: true }), false)).toBeNull();
    // Ctrl+Alt+Tab is the OS window switcher on some platforms — leave it alone.
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab', control: true, alt: true }), false)).toBeNull();
    expect(matchSessionSwitchInput(keyEvent({ key: 'Tab', control: true, meta: true }), true)).toBeNull();
  });

  it('maps Cmd+Shift+]/[ on macOS, matching on code (Shift turns ] into } in key)', () => {
    expect(
      matchSessionSwitchInput(keyEvent({ key: '}', code: 'BracketRight', meta: true, shift: true }), true),
    ).toBe('next');
    expect(
      matchSessionSwitchInput(keyEvent({ key: '{', code: 'BracketLeft', meta: true, shift: true }), true),
    ).toBe('prev');
  });

  it('rejects the bracket combos off macOS or with wrong modifiers', () => {
    // Windows/Linux: Cmd(Win)+Shift+] must not switch sessions.
    expect(
      matchSessionSwitchInput(keyEvent({ code: 'BracketRight', meta: true, shift: true }), false),
    ).toBeNull();
    // Without Shift, Cmd+] / Cmd+[ are not session-switch keys.
    expect(matchSessionSwitchInput(keyEvent({ code: 'BracketRight', meta: true }), true)).toBeNull();
    expect(
      matchSessionSwitchInput(keyEvent({ code: 'BracketRight', meta: true, shift: true, control: true }), true),
    ).toBeNull();
  });
});

describe('buildApplicationMenuTemplate', () => {
  const actions = { nextSession: vi.fn(), prevSession: vi.fn(), newSession: vi.fn(), closePane: vi.fn() };

  function sessionMenuItems(isMac: boolean): MenuItemConstructorOptions[] {
    const template = buildApplicationMenuTemplate(actions, isMac);
    const sessionMenu = template.find((item) => item.label === '会话');
    expect(sessionMenu).toBeDefined();
    return sessionMenu?.submenu as MenuItemConstructorOptions[];
  }

  function itemByLabel(isMac: boolean, label: string): MenuItemConstructorOptions {
    const item = sessionMenuItems(isMac).find((i) => i.label === label);
    expect(item).toBeDefined();
    return item as MenuItemConstructorOptions;
  }

  it('shows Ctrl+Tab / Ctrl+Shift+Tab on Windows/Linux', () => {
    expect(itemByLabel(false, '下一个会话')).toMatchObject({ accelerator: 'Ctrl+Tab', registerAccelerator: false });
    expect(itemByLabel(false, '上一个会话')).toMatchObject({ accelerator: 'Ctrl+Shift+Tab', registerAccelerator: false });
  });

  it('shows Cmd+Shift+] / Cmd+Shift+[ plus the macOS app menu on macOS', () => {
    const template = buildApplicationMenuTemplate(actions, true);
    expect(template[0]).toMatchObject({ role: 'appMenu' });
    expect(itemByLabel(true, '下一个会话')).toMatchObject({ accelerator: 'Cmd+Shift+]', registerAccelerator: false });
    expect(itemByLabel(true, '上一个会话')).toMatchObject({ accelerator: 'Cmd+Shift+[', registerAccelerator: false });
  });

  it('offers 新对话 / 关闭分屏 as registered accelerators that override the window defaults', () => {
    for (const isMac of [true, false]) {
      // Registered (registerAccelerator undefined): the accelerator fires
      // app-wide and preempts Electron's new-window / close-window defaults.
      expect(itemByLabel(isMac, '新对话')).toMatchObject({ id: 'new-session', accelerator: 'CmdOrCtrl+N' });
      expect(itemByLabel(isMac, '关闭分屏')).toMatchObject({ id: 'close-pane', accelerator: 'CmdOrCtrl+W' });
    }
  });

  it('keeps the platform default menus (file/edit/view/window roles)', () => {
    const roles = buildApplicationMenuTemplate(actions, true).map((item) => item.role);
    expect(roles).toEqual(expect.arrayContaining(['fileMenu', 'editMenu', 'viewMenu', 'windowMenu']));
  });

  it('menu item clicks take the same code path as the keys', () => {
    itemByLabel(false, '下一个会话').click?.({} as never, {} as never, {} as never);
    itemByLabel(false, '上一个会话').click?.({} as never, {} as never, {} as never);
    itemByLabel(false, '新对话').click?.({} as never, {} as never, {} as never);
    itemByLabel(false, '关闭分屏').click?.({} as never, {} as never, {} as never);
    expect(actions.nextSession).toHaveBeenCalledTimes(1);
    expect(actions.prevSession).toHaveBeenCalledTimes(1);
    expect(actions.newSession).toHaveBeenCalledTimes(1);
    expect(actions.closePane).toHaveBeenCalledTimes(1);
  });
});

describe('updateMenuState', () => {
  it('toggles the 新对话 / 关闭分屏 items by id', () => {
    const items = (Menu as unknown as { __mockMenuItems: Map<string, { enabled: boolean }> }).__mockMenuItems;
    items.set('new-session', { enabled: true });
    items.set('close-pane', { enabled: true });

    updateMenuState({ canNewSession: false, canClosePane: true });
    expect(items.get('new-session')?.enabled).toBe(false);
    expect(items.get('close-pane')?.enabled).toBe(true);

    updateMenuState({ canNewSession: true, canClosePane: false });
    expect(items.get('new-session')?.enabled).toBe(true);
    expect(items.get('close-pane')?.enabled).toBe(false);
  });
});

describe('installApplicationMenu', () => {
  it('builds and sets the application menu', () => {
    installApplicationMenu({ nextSession: vi.fn(), prevSession: vi.fn(), newSession: vi.fn(), closePane: vi.fn() });
    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    expect(Menu.setApplicationMenu).toHaveBeenCalledTimes(1);
  });
});
