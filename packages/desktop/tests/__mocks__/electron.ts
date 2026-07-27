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

export const ipcMain = {
  on: vi.fn(),
  handle: vi.fn(),
};

export const ipcRenderer = {
  send: vi.fn(),
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
