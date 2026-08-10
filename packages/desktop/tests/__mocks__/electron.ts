import { vi } from 'vitest';

export const app = {
  getPath: vi.fn(() => '/tmp/wave-desktop-test-userData'),
  getVersion: vi.fn(() => '0.19.7'),
  requestSingleInstanceLock: vi.fn(() => true),
  on: vi.fn(),
  whenReady: vi.fn(() => Promise.resolve()),
  quit: vi.fn(),
};

export const dialog = {
  showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] as string[] })),
  showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined as string | undefined })),
  showMessageBox: vi.fn(async () => ({ response: 0 })),
};

export const shell = {
  openExternal: vi.fn(async () => undefined),
  openPath: vi.fn(async () => ''),
};

// vi.fn-wrapped class so tests can inspect Notification.mock.instances /
// mockClear() across tests (a plain class has no .mock).
export const Notification = vi.fn(function (this: { options: unknown; show: ReturnType<typeof vi.fn> }, options: unknown) {
  this.options = options;
  this.show = vi.fn();
}) as unknown as typeof import('electron').Notification & {
  isSupported: ReturnType<typeof vi.fn>;
  mockClear: ReturnType<typeof vi.fn>;
};
Notification.isSupported = vi.fn(() => true);

export const ipcMain = {
  on: vi.fn(),
  handle: vi.fn(),
};

const mockMenuItems = new Map<string, { enabled: boolean }>();

export const Menu = {
  buildFromTemplate: vi.fn((template: unknown[]) => ({ __template: template })),
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

export const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

export class BrowserWindow {
  webContents = { send: vi.fn() };
  loadFile = vi.fn(async () => undefined);
  on = vi.fn();
  isDestroyed = vi.fn(() => false);
  isMinimized = vi.fn(() => false);
  restore = vi.fn();
  focus = vi.fn();
  static getAllWindows = vi.fn(() => [] as unknown[]);
}

// powerMonitor mock: `resume` listeners fire on __resume() so the desktop
// host's auto-reconnect wake-awareness can be unit-tested deterministically.
const powerMonitorResumeListeners: Array<() => void> = [];
export const powerMonitor = {
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'resume') powerMonitorResumeListeners.push(cb);
  }),
  off: vi.fn((event: string, cb: () => void) => {
    if (event === 'resume') {
      const i = powerMonitorResumeListeners.indexOf(cb);
      if (i >= 0) powerMonitorResumeListeners.splice(i, 1);
    }
  }),
  /** Test helper: fire the `resume` event (system woke from sleep). */
  __resume(): void {
    for (const cb of [...powerMonitorResumeListeners]) cb();
  },
  __reset(): void {
    powerMonitorResumeListeners.length = 0;
    vi.mocked(this.on).mockClear();
    vi.mocked(this.off).mockClear();
  },
};

// nativeTheme mock: `shouldUseDarkColors` is derived from `themeSource` +
// the OS appearance (systemDark), mirroring real Electron semantics so the
// desktop host's nativeTheme listener can be unit-tested deterministically.
type NativeThemeSetting = 'system' | 'light' | 'dark';
const nativeThemeListeners: Array<() => void> = [];
let systemDark = false;
export const nativeTheme = {
  themeSource: 'system' as NativeThemeSetting,
  get shouldUseDarkColors(): boolean {
    if (this.themeSource === 'dark') return true;
    if (this.themeSource === 'light') return false;
    return systemDark;
  },
  on: vi.fn((event: string, cb: () => void) => {
    if (event === 'updated') nativeThemeListeners.push(cb);
  }),
  off: vi.fn((event: string, cb: () => void) => {
    if (event === 'updated') {
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
    this.themeSource = 'system';
    systemDark = false;
    nativeThemeListeners.length = 0;
    vi.mocked(this.on).mockClear();
    vi.mocked(this.off).mockClear();
  },
};
