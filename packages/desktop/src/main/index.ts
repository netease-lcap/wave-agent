/**
 * Electron main-process entry.
 *
 * Single instance → ConfigStore + DesktopHost → BrowserWindow (CSP via
 * syncWebview-generated index.html) → IPC wiring. All agent communication
 * happens inside DesktopHost via the shared StdioClient.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { WEBVIEW_CHANNEL } from './channels';
import { ConfigStore } from './configStore';
import { DesktopHost } from './desktopHost';

let mainWindow: BrowserWindow | null = null;
let host: DesktopHost | null = null;

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    const configStore = new ConfigStore();
    host = new DesktopHost(configStore);

    ipcMain.on(WEBVIEW_CHANNEL, (_event, message: Record<string, unknown>) => {
      void host?.handleWebviewMessage(message).catch((error) => {
        console.error('[Wave Desktop] Failed to handle webview message:', error);
      });
    });

    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    void host?.dispose();
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: 'Wave',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  host?.setMainWindow(mainWindow);

  // External links always open in the system browser (FR-008).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // webview/ lives at the package root (synced by scripts/syncWebview.mjs);
  // dist/main → ../.. reaches the package root both in dev and inside app.asar.
  void mainWindow.loadFile(path.join(__dirname, '..', '..', 'webview', 'index.html'));
}
