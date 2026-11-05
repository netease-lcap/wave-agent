/**
 * Windows: closing the window hides it to the system tray instead of quitting
 * (spec desktop-shell.md「Windows 关闭窗口最小化到托盘」).
 *
 * Why it lives in its own module: the "close" decision has to be made *before*
 * Electron decides to destroy the window, and it is only allowed to hide when a
 * tray icon actually exists — otherwise the app becomes unreachable (window
 * gone, no icon to click). Keeping creation, the menu template and the quitting
 * latch together makes that precondition explicit and unit-testable without a
 * real desktop session.
 *
 * macOS/Linux are untouched: macOS already keeps the process alive after the
 * window closes (Dock re-activates), Linux keeps the desktop convention of
 * "close = quit".
 */

import { Menu, Tray, nativeImage } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { hostLog } from "./hostLog.js";

/** Icon shipped at `<package>/assets/icon.png` (dist/main → ../..). */
export const TRAY_ICON_PATH = "../../assets/icon.png";

/** Only Windows gets the tray; the other platforms keep their own convention. */
export const TRAY_PLATFORM: NodeJS.Platform = "win32";

export const TRAY_TOOLTIP = "CodeWave IDE";

/** The slice of `BrowserWindow` the tray drives (keeps tests trivial). */
export interface TrayWindow {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  show: () => void;
  hide: () => void;
  focus: () => void;
}

/** The slice of Electron's `Tray` this module uses. */
export interface TrayLike {
  setToolTip: (toolTip: string) => void;
  setContextMenu: (menu: Menu) => void;
  /**
   * Electron's own overloaded signature: we only subscribe to `click` /
   * `double-click`, but a narrower type here would make the real `Tray`
   * unassignable (each overload takes one literal event name).
   */
  on: Tray["on"];
  destroy: () => void;
}

export interface TrayControllerDeps {
  /** Absolute path to the tray icon. */
  iconPath: string;
  /** The window to bring back; `null` before it exists / after it is destroyed. */
  getWindow: () => TrayWindow | null;
  /** Real quit — must run the ordinary quit sequence, never a bare exit. */
  quit: () => void;
  /** Overridable for tests: Electron's `Tray` needs a real desktop session. */
  platform?: NodeJS.Platform;
  createTray?: (image: Electron.NativeImage) => TrayLike;
  loadImage?: (iconPath: string) => Electron.NativeImage;
  warn?: (...args: unknown[]) => void;
}

export interface TrayController {
  /**
   * Creates the tray icon on first use. Returns whether a tray icon exists —
   * the window `close` handler hides only when this is `true`.
   */
  ensure: () => boolean;
  /**
   * Handler for `win.on("close", …)`: hides the window to the tray when
   * possible; otherwise leaves the event alone so Electron closes/destroys the
   * window exactly as before (real quits, non-Windows platforms, no tray icon).
   */
  handleClose: (event: { preventDefault: () => void }, win: TrayWindow) => void;
  /** Latches the "we are really quitting" state (close then passes through). */
  markQuitting: () => void;
  /** Releases the icon (quit path); a later `ensure` would recreate it. */
  destroy: () => void;
}

/** Tray context menu: bring the window back, or really quit. */
export function buildTrayMenuTemplate(actions: {
  show: () => void;
  quit: () => void;
}): MenuItemConstructorOptions[] {
  return [
    {
      id: "tray-show",
      label: "显示 CodeWave IDE",
      click: () => actions.show(),
    },
    { type: "separator" },
    { id: "tray-quit", label: "退出", click: () => actions.quit() },
  ];
}

/**
 * Hides the window only when all three hold: this is Windows, the app is not on
 * its way out, and a tray icon exists. Extracted so the rule reads as one line
 * at the call site and stays testable.
 */
export function shouldHideWindowOnClose(input: {
  platform: NodeJS.Platform;
  quitting: boolean;
  hasTray: boolean;
}): boolean {
  return input.platform === TRAY_PLATFORM && !input.quitting && input.hasTray;
}

export function createTrayController(deps: TrayControllerDeps): TrayController {
  const platform = deps.platform ?? process.platform;
  const warn = deps.warn ?? hostLog.warn.bind(hostLog);
  const loadImage =
    deps.loadImage ??
    ((iconPath: string) => nativeImage.createFromPath(iconPath));
  const createTray: (image: Electron.NativeImage) => TrayLike =
    deps.createTray ?? ((image) => new Tray(image));

  let tray: TrayLike | null = null;
  let quitting = false;

  const showWindow = (): void => {
    const win = deps.getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    // `show()` also re-lists the window in the taskbar — `hide()` removed it.
    win.show();
    win.focus();
  };

  const quit = (): void => {
    // The latch has to be set before `quit()`: the quit sequence closes the
    // window, and an un-latched close would just hide it again.
    quitting = true;
    deps.quit();
  };

  const ensure = (): boolean => {
    // Same gate the close handler answers to: no tray on a platform that does
    // not want one, and none while quitting — the close during the quit
    // sequence must pass straight through instead of hiding the window.
    if (!shouldHideWindowOnClose({ platform, quitting, hasTray: true })) {
      return false;
    }
    if (tray) return true;
    try {
      const created = createTray(loadImage(deps.iconPath));
      created.setToolTip(TRAY_TOOLTIP);
      created.setContextMenu(
        Menu.buildFromTemplate(
          buildTrayMenuTemplate({ show: showWindow, quit }),
        ),
      );
      // Single click is the Windows reflex; double-click also fires `click`
      // first, so both restore the window without extra bookkeeping.
      created.on("click", showWindow);
      created.on("double-click", showWindow);
      tray = created;
      return true;
    } catch (error) {
      // Never fatal: without an icon the close must fall back to the original
      // "destroy the window" behavior (see shouldHideWindowOnClose).
      tray = null;
      warn("[Wave Desktop] Failed to create the tray icon:", error);
      return false;
    }
  };

  return {
    ensure,
    handleClose: (event, win) => {
      // `ensure` already proves "Windows + not quitting + icon exists", so a
      // `true` here is exactly the "hide instead of close" case.
      if (!ensure()) return;
      event.preventDefault();
      win.hide();
    },
    markQuitting: () => {
      quitting = true;
    },
    destroy: () => {
      tray?.destroy();
      tray = null;
    },
  };
}
