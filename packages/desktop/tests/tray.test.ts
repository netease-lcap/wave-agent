import { describe, it, expect, vi } from "vitest";
import { Menu } from "electron";
import {
  buildTrayMenuTemplate,
  createTrayController,
  shouldHideWindowOnClose,
  TRAY_TOOLTIP,
  type TrayLike,
  type TrayWindow,
} from "../src/main/tray";

const createWindow = (overrides: Partial<TrayWindow> = {}): TrayWindow => ({
  isDestroyed: vi.fn(() => false),
  isMinimized: vi.fn(() => false),
  restore: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  focus: vi.fn(),
  ...overrides,
});

type FakeTray = TrayLike & {
  destroy: ReturnType<typeof vi.fn>;
  emit: (event: string) => void;
};

const createFakeTray = (): FakeTray => {
  const listeners = new Map<string, () => void>();
  return {
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => {
      listeners.set(event, listener);
    }),
    destroy: vi.fn(),
    emit: (event: string) => listeners.get(event)?.(),
  };
};

const createHarness = (
  overrides: Partial<Parameters<typeof createTrayController>[0]> & {
    window?: TrayWindow;
    tray?: FakeTray;
  } = {},
) => {
  const window = overrides.window ?? createWindow();
  const tray = overrides.tray ?? createFakeTray();
  const createTray = vi.fn(() => tray);
  const warn = vi.fn();
  const quit = vi.fn();
  const controller = createTrayController({
    iconPath: "/app/root/assets/icon.png",
    getWindow: () => window,
    quit,
    platform: "win32",
    createTray,
    loadImage: () => ({}) as Electron.NativeImage,
    warn,
    ...overrides,
  });
  return { controller, window, tray, createTray, warn, quit };
};

describe("shouldHideWindowOnClose", () => {
  it("hides only on Windows, when not quitting, with a live tray icon", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        quitting: false,
        hasTray: true,
      }),
    ).toBe(true);
  });

  it("never intercepts close on macOS or Linux", () => {
    for (const platform of ["darwin", "linux"] as NodeJS.Platform[]) {
      expect(
        shouldHideWindowOnClose({ platform, quitting: false, hasTray: true }),
      ).toBe(false);
    }
  });

  it("lets a real quit through", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        quitting: true,
        hasTray: true,
      }),
    ).toBe(false);
  });

  it("falls back to the original close when no tray icon exists", () => {
    expect(
      shouldHideWindowOnClose({
        platform: "win32",
        quitting: false,
        hasTray: false,
      }),
    ).toBe(false);
  });
});

describe("buildTrayMenuTemplate", () => {
  it("offers exactly 显示 CodeWave IDE and 退出", () => {
    const show = vi.fn();
    const quit = vi.fn();
    const template = buildTrayMenuTemplate({ show, quit });

    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "显示 CodeWave IDE",
      "separator",
      "退出",
    ]);

    template[0].click?.(undefined as never, undefined, undefined as never);
    template[2].click?.(undefined as never, undefined, undefined as never);
    expect(show).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

describe("createTrayController", () => {
  it("creates the icon on first close and reuses it afterwards", () => {
    const { controller, createTray, tray } = createHarness();

    expect(controller.ensure()).toBe(true);
    expect(controller.ensure()).toBe(true);

    expect(createTray).toHaveBeenCalledTimes(1);
    expect(tray.setToolTip).toHaveBeenCalledWith(TRAY_TOOLTIP);
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1);
    const [template] = vi.mocked(Menu.buildFromTemplate).mock.calls.at(-1)!;
    expect(template.map((item) => item.label ?? item.type)).toEqual([
      "显示 CodeWave IDE",
      "separator",
      "退出",
    ]);
  });

  it("does nothing on macOS/Linux", () => {
    const { controller, createTray } = createHarness({ platform: "darwin" });

    expect(controller.ensure()).toBe(false);
    expect(createTray).not.toHaveBeenCalled();
  });

  it("restores, shows and focuses the window on click / double-click", () => {
    const { controller, window, tray } = createHarness();
    controller.ensure();

    tray.emit("click");
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.restore).not.toHaveBeenCalled();

    vi.mocked(window.isMinimized).mockReturnValue(true);
    tray.emit("double-click");
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(2);
  });

  it("ignores clicks once the window is gone", () => {
    const window = createWindow({ isDestroyed: vi.fn(() => true) });
    const { controller, tray } = createHarness({ window });
    controller.ensure();

    tray.emit("click");

    expect(window.show).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
  });

  it("falls back to the original close when the icon cannot be created", () => {
    const { controller, warn } = createHarness({
      createTray: vi.fn(() => {
        throw new Error("no desktop session");
      }),
    });

    expect(controller.ensure()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("latches quitting: the quit sequence closes the window for real", () => {
    const { controller, window } = createHarness();
    controller.ensure();
    const event = { preventDefault: vi.fn() };

    controller.handleClose(event, window);
    expect(window.hide).toHaveBeenCalledTimes(1);

    controller.markQuitting();
    controller.handleClose(event, window);
    expect(window.hide).toHaveBeenCalledTimes(1);
  });

  it("never creates an icon while quitting", () => {
    const { controller, createTray } = createHarness();
    controller.markQuitting();

    expect(controller.ensure()).toBe(false);
    expect(createTray).not.toHaveBeenCalled();
  });

  it("quits through the tray menu and latches quitting first", () => {
    const { controller, quit, tray } = createHarness();
    controller.ensure();

    const menu = vi.mocked(Menu.buildFromTemplate).mock.results.at(-1)
      ?.value as {
      __template: Electron.MenuItemConstructorOptions[];
    };
    const quitItem = menu.__template.find((item) => item.id === "tray-quit");
    quitItem?.click?.(undefined as never, undefined, undefined as never);

    expect(quit).toHaveBeenCalledTimes(1);
    // The latch has to be on *before* app.quit() closes the window.
    expect(controller.ensure()).toBe(false);
    expect(tray.destroy).not.toHaveBeenCalled();
  });

  it("releases the icon on destroy and can recreate it", () => {
    const { controller, createTray, tray } = createHarness();
    controller.ensure();

    controller.destroy();

    expect(tray.destroy).toHaveBeenCalledTimes(1);

    expect(controller.ensure()).toBe(true);
    expect(createTray).toHaveBeenCalledTimes(2);
  });
});

describe("createTrayController.handleClose", () => {
  it("hides the window instead of destroying it on Windows", () => {
    const { controller, window } = createHarness();
    const event = { preventDefault: vi.fn() };

    controller.handleClose(event, window);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
  });

  it("only populates the tray when the close actually happens", () => {
    const { controller, window, createTray } = createHarness();

    expect(createTray).not.toHaveBeenCalled();
    controller.handleClose({ preventDefault: vi.fn() }, window);
    expect(createTray).toHaveBeenCalledTimes(1);
  });

  it("lets a real quit close the window", () => {
    const { controller, window } = createHarness();
    controller.markQuitting();
    const event = { preventDefault: vi.fn() };

    controller.handleClose(event, window);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("lets the close proceed when the tray icon cannot be created", () => {
    const { controller, window } = createHarness({
      createTray: vi.fn(() => {
        throw new Error("no desktop session");
      }),
    });
    const event = { preventDefault: vi.fn() };

    controller.handleClose(event, window);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });

  it("leaves macOS/Linux untouched", () => {
    const { controller, window, createTray } = createHarness({
      platform: "darwin",
    });
    const event = { preventDefault: vi.fn() };

    controller.handleClose(event, window);

    expect(createTray).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();
  });
});
