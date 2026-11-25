import { vi } from "vitest";

const dockMock = { bounce: vi.fn(() => 7), cancelBounce: vi.fn() };

export const app = {
  isPackaged: false,
  getPath: vi.fn(() => "/tmp/wave-desktop-test-userData"),
  getVersion: vi.fn(() => "0.19.7"),
  getAppPath: vi.fn(() => "/app/root"),
  requestSingleInstanceLock: vi.fn(() => true),
  on: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
  // Crash recovery relaunches via app.exit (never app.quit — see
  // crashRecovery.ts), so tests assert on these two.
  relaunch: vi.fn(),
  exit: vi.fn(),
  /** Renderer memory curve source; tests seed Tab/Browser entries. */
  getAppMetrics: vi.fn((): Electron.ProcessMetric[] => []),
  /**
   * Icon badge (desktop-notifications.md story 4). The real one returns false
   * without throwing on a Windows install that never registered a toast.
   */
  setBadgeCount: vi.fn<(count: number) => boolean>(() => true),
  /**
   * macOS Dock bounce (story 4). The real `app.dock` is undefined on Linux /
   * Windows; the mock hands back an object so a case can assert on the calls,
   * and `__setDock(undefined)` makes one case walk the no-dock branch.
   */
  dock: dockMock as typeof dockMock | undefined,
  /** Test helper: swap / remove the Dock stand-in. */
  __setDock(dock: typeof dockMock | undefined): void {
    app.dock = dock;
  },
};

export const crashReporter = {
  start: vi.fn(),
  getLastCrashReport: vi.fn((): Electron.CrashReport | null => null),
};

export const dialog = {
  showOpenDialog: vi.fn(async () => ({
    canceled: true,
    filePaths: [] as string[],
  })),
  showSaveDialog: vi.fn(async () => ({
    canceled: true,
    filePath: undefined as string | undefined,
  })),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
};

export const shell = {
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ""),
  showItemInFolder: vi.fn(),
};

export const ipcMain = {
  on: vi.fn(),
  handle: vi.fn(),
};

const mockMenuItems = new Map<string, { enabled: boolean }>();

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown[]) => ({
    __template: template,
    popup: vi.fn(),
  })),
  setApplicationMenu: vi.fn(),
  getApplicationMenu: vi.fn(() => ({
    getMenuItemById: (id: string) => mockMenuItems.get(id) ?? null,
  })),
  /** Test hook: seed the items that getMenuItemById returns. */
  __mockMenuItems: mockMenuItems,
};

export const ipcRenderer = {
  send: vi.fn(),
  sendSync: vi.fn(),
  on: vi.fn(),
};

/**
 * Tray + nativeImage: the real ones need a desktop session, so the tray
 * controller takes both as injected dependencies. These stubs exist so the
 * module's top-level `import { Tray } from "electron"` resolves.
 */
export const nativeImage = {
  createFromPath: vi.fn(() => ({
    isEmpty: () => false,
    resize: vi.fn(),
  })),
};

export class Tray {
  setToolTip = vi.fn();
  setContextMenu = vi.fn();
  on = vi.fn();
  destroy = vi.fn();
}

/**
 * Notification: same story as Tray — the real one needs a desktop session, so
 * `notificationService.ts` takes it through an injectable factory in its own
 * tests. This stub exists so `desktopHost.ts`'s `import { Notification } from
 * "electron"` resolves, and it records every instance so the host's wiring can
 * be asserted (what was created / shown / closed, and what a click fires).
 */
type NotificationClickListener = () => void;
const notificationInstances: Notification[] = [];

export class Notification {
  readonly options: Record<string, unknown>;
  show = vi.fn();
  close = vi.fn();
  private readonly clickListeners: NotificationClickListener[] = [];
  on = vi.fn((event: string, listener: NotificationClickListener) => {
    if (event === "click") this.clickListeners.push(listener);
  });
  static readonly isSupported = vi.fn(() => true);

  constructor(options: Record<string, unknown>) {
    this.options = options;
    notificationInstances.push(this);
  }

  /** Test helper: fire the `click` listeners the service registered. */
  __click(): void {
    for (const listener of [...this.clickListeners]) listener();
  }

  /** Every instance built since the last `__reset`, oldest first. */
  static __instances(): readonly Notification[] {
    return notificationInstances;
  }

  static __reset(): void {
    notificationInstances.length = 0;
    this.isSupported.mockReset();
    this.isSupported.mockReturnValue(true);
  }
}

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

export class BrowserWindow {
  webContents = { send: vi.fn() };
  loadFile = vi.fn(async () => undefined);
  private readonly listeners = new Map<string, Set<() => void>>();
  /** Stores every listener so `__emit` can replay a window event (story 4's `focus`). */
  on = vi.fn((event: string, cb: () => void) => {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
  });
  /** Taskbar flash / urgency hint (story 4); `false` stops it. */
  flashFrame = vi.fn();
  isDestroyed = vi.fn(() => false);
  isMinimized = vi.fn(() => false);
  isFocused = vi.fn(() => true);
  isVisible = vi.fn(() => true);
  restore = vi.fn();
  focus = vi.fn();
  static getAllWindows = vi.fn(() => [] as unknown[]);
  /** Test helper: fire the listeners registered for `event`. */
  __emit(event: string): void {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb();
  }
}

/**
 * Power/OS state the reconnect sequence reads: `suspend`/`resume` drive the
 * "a sleep is not a failure" rule, `getSystemIdleState` decides whether
 * somebody is at the computer. Tests flip both through the helpers below.
 */
type PowerListener = () => void;
const powerListeners = new Map<string, Set<PowerListener>>();
let systemIdleState: "active" | "idle" | "locked" | "unknown" = "active";
export const powerMonitor = {
  on: vi.fn((event: string, cb: PowerListener) => {
    const set = powerListeners.get(event) ?? new Set<PowerListener>();
    set.add(cb);
    powerListeners.set(event, set);
  }),
  off: vi.fn((event: string, cb: PowerListener) => {
    powerListeners.get(event)?.delete(cb);
  }),
  getSystemIdleState: vi.fn(() => systemIdleState),
  getSystemIdleTime: vi.fn(() => 0),
  /** Test helper: fire a power event (`suspend` / `resume` / …). */
  __emit(event: string): void {
    for (const cb of [...(powerListeners.get(event) ?? [])]) cb();
  },
  /** Test helper: what `getSystemIdleState` reports next. */
  __setIdleState(state: typeof systemIdleState): void {
    systemIdleState = state;
  },
  __reset(): void {
    powerListeners.clear();
    systemIdleState = "active";
    vi.mocked(this.on).mockClear();
    vi.mocked(this.off).mockClear();
  },
};

// nativeTheme mock: `shouldUseDarkColors` is derived from `themeSource` +
// the OS appearance (systemDark), mirroring real Electron semantics so the
// desktop host's nativeTheme listener can be unit-tested deterministically.
type NativeThemeSetting = "system" | "light" | "dark";
const nativeThemeListeners: Array<() => void> = [];
let systemDark = false;
export const nativeTheme = {
  themeSource: "system" as NativeThemeSetting,
  get shouldUseDarkColors(): boolean {
    if (this.themeSource === "dark") return true;
    if (this.themeSource === "light") return false;
    return systemDark;
  },
  on: vi.fn((event: string, cb: () => void) => {
    if (event === "updated") nativeThemeListeners.push(cb);
  }),
  off: vi.fn((event: string, cb: () => void) => {
    if (event === "updated") {
      const i = nativeThemeListeners.indexOf(cb);
      if (i >= 0) nativeThemeListeners.splice(i, 1);
    }
  }),
  /** Test helper: flip the OS appearance and fire the `updated` event. */
  __setSystemDark(v: boolean): void {
    systemDark = v;
    for (const cb of [...nativeThemeListeners]) cb();
  },
  __reset(): void {
    this.themeSource = "system";
    systemDark = false;
    nativeThemeListeners.length = 0;
    vi.mocked(this.on).mockClear();
    vi.mocked(this.off).mockClear();
  },
};
