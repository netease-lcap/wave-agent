/**
 * Electron main-process entry.
 *
 * Single instance → ConfigStore + DesktopHost → BrowserWindow (CSP via
 * syncWebview-generated index.html) → IPC wiring. All agent communication
 * happens inside DesktopHost via the shared StdioClient.
 */

import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import { execFileSync } from "child_process";
import * as path from "path";
import { WEBVIEW_CHANNEL } from "./channels";
import { ConfigStore } from "./configStore";
import { DesktopHost } from "./desktopHost";
import { isLocalhostUrl } from "./isLocalhostUrl";
import {
  attachDesktopShortcutKeys,
  installApplicationMenu,
  updateMenuState,
  type DesktopMenuActions,
} from "./menu";

/**
 * GUI-launched apps (Finder/Spotlight) get a bare system PATH without the
 * user's nvm/homebrew dirs, so `which wave`/`which npm`/`which node` all fail
 * and the binary resolver breaks. Probe the user's login shell once and adopt
 * its PATH; child processes inherit it via `...process.env` spreads.
 */
function adoptLoginShellPath(): void {
  if (process.platform === "win32") return;
  try {
    // execFileSync, NOT execSync: with execSync the command goes through
    // /bin/sh -c which would expand `$PATH` BEFORE zsh sources .zshrc,
    // defeating the whole probe.
    const probed = execFileSync("/bin/zsh", ["-lic", "echo $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split("\n")
      .pop()
      ?.trim();
    if (probed) process.env.PATH = probed;
  } catch {
    // keep the default PATH — the resolver will surface its usual errors
  }
}

adoptLoginShellPath();

// Dev instances get their own userData so they can run alongside an installed
// app (the single-instance lock is scoped to the userData directory) and never
// touch the real config/session index.
if (!app.isPackaged) {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "wave-desktop-dev"),
  );
}

let mainWindow: BrowserWindow | null = null;
let host: DesktopHost | null = null;

// Session-switch shortcuts (Ctrl+Tab / Ctrl+Shift+Tab, macOS also
// Cmd+Shift+] / [), 新对话 Cmd+N / 并排新对话 Cmd+Shift+N / 关闭分屏 Cmd+W,
// and panel-toggle shortcuts — shared by the application menu and
// before-input-event.
const menuActions: DesktopMenuActions = {
  nextSession: () => {
    void host?.activateAdjacentSession(1);
  },
  prevSession: () => {
    void host?.activateAdjacentSession(-1);
  },
  newSession: () => host?.newSessionInFocusedPane(),
  newSessionInPane: () => {
    void host?.newSessionInNewPane();
  },
  closePane: () => host?.closeFocusedPane(),
  togglePanel: (kind) => {
    host?.toggleFocusedPanePanel(kind);
  },
};

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  void app.whenReady().then(() => {
    // Dev launches the bare Electron binary, whose default atom icon shows in
    // the Dock — swap in the brand icon (packaged apps get it from the icns).
    if (!app.isPackaged) {
      app.dock?.setIcon(
        nativeImage.createFromPath(
          path.join(__dirname, "../../assets/icon.png"),
        ),
      );
    }

    const configStore = new ConfigStore();
    host = new DesktopHost(configStore);
    host.onMenuStateChange = updateMenuState;
    installApplicationMenu(menuActions);
    // 面板 menu checkboxes mirror the focused pane's toggle state.
    host.onPanelStateChanged = (checked) =>
      installApplicationMenu(menuActions, checked);

    ipcMain.on(WEBVIEW_CHANNEL, (_event, message: Record<string, unknown>) => {
      void host?.handleWebviewMessage(message).catch((error) => {
        console.error(
          "[Wave Desktop] Failed to handle webview message:",
          error,
        );
      });
    });

    // Sync theme lookup for the preload: applied to <html data-theme> before
    // first paint so the initial frame matches the persisted preference (FR-019).
    ipcMain.on("wave:get-initial-theme", (event) => {
      event.returnValue = host?.getInitialEffectiveTheme() ?? "dark";
    });

    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("before-quit", (event) => {
    // Never fire-and-forget the dispose: quitting before the destroy RPC
    // reaches the agent would orphan the wave --stdio child (the other half
    // of the fix is stdioServer's stdin-EOF self-exit). Hold the quit, await
    // dispose bounded by a timeout, then exit explicitly. app.exit() skips the
    // quit events, so this handler can't re-enter.
    if (quitting) return;
    quitting = true;
    if (!host) return;
    event.preventDefault();
    void Promise.race([
      host.dispose(),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
    ]).finally(() => app.exit(0));
  });
}

const SHUTDOWN_TIMEOUT_MS = 5_000;
let quitting = false;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: "Wave",
    backgroundColor: "#1e1e1e",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The preview pane renders local dev servers in a <webview>.
      webviewTag: true,
    },
  });

  host?.setMainWindow(mainWindow);
  attachDesktopShortcutKeys(mainWindow.webContents, menuActions);

  // External links always open in the system browser (FR-008).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Clicking an <a href> navigates the whole window away from the chat UI —
  // block every non-file navigation (file: is the bundled index.html itself).
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    event.preventDefault();
    if (/^https?:/.test(url)) {
      void shell.openExternal(url);
    }
  });

  // Lock down any <webview> the page attaches: the preview pane is the only
  // consumer and it must stay sandboxed + localhost-only.
  mainWindow.webContents.on(
    "will-attach-webview",
    (event, webPreferences, params) => {
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      if (!isLocalhostUrl(params.src)) {
        console.warn(
          "[Wave Desktop] Blocked <webview> attach with non-localhost src:",
          params.src,
        );
        event.preventDefault();
      }
    },
  );

  mainWindow.webContents.on("did-attach-webview", (_event, guest) => {
    // The session-switch/panel-toggle keys must also work while the preview
    // pane has focus.
    attachDesktopShortcutKeys(guest, menuActions);
    // Guest pages must never spawn windows — open them externally instead.
    // (The <webview> `new-window` DOM event was removed in Electron 39.)
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) {
        void shell.openExternal(url);
      }
      return { action: "deny" };
    });
    // The preview pane is localhost-only: divert in-guest navigation
    // to external sites into the system browser instead of loading them here.
    guest.on("will-navigate", (event, url) => {
      if (isLocalhostUrl(url)) return;
      event.preventDefault();
      if (/^https?:/.test(url)) {
        void shell.openExternal(url);
      }
    });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // webview/ lives at the package root (synced by scripts/syncWebview.mjs);
  // dist/main → ../.. reaches the package root both in dev and inside app.asar.
  void mainWindow.loadFile(
    path.join(__dirname, "..", "..", "webview", "index.html"),
  );
}
