/**
 * Electron main-process entry.
 *
 * Single instance → ConfigStore + DesktopHost → BrowserWindow (CSP via
 * syncWebview-generated index.html) → IPC wiring. All agent communication
 * happens inside DesktopHost via the shared StdioClient.
 */

import { app, BrowserWindow, ipcMain, nativeImage, shell } from "electron";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { hostLog } from "./hostLog";
import { WEBVIEW_CHANNEL } from "./channels";
import { ConfigStore } from "./configStore";
import { DesktopHost } from "./desktopHost";
import { isLocalhostUrl } from "./isLocalhostUrl";
import {
  attachDesktopShortcutKeys,
  attachImageContextMenu,
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
function resolveGitBashPath(): string | undefined {
  // Priority (mirrors the agent-sdk shell resolver):
  // 1. WAVE_GIT_BASH_PATH env var
  if (process.env.WAVE_GIT_BASH_PATH) {
    return process.env.WAVE_GIT_BASH_PATH;
  }
  // 2. Infer from `where git`: <git>/cmd/git.exe → <git>/bin/bash.exe
  try {
    const gitExe = execFileSync("where", ["git"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 3000,
    })
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim());
    if (gitExe) {
      const bashPath = path.win32.resolve(
        gitExe,
        "..",
        "..",
        "bin",
        "bash.exe",
      );
      if (fs.existsSync(bashPath)) {
        return bashPath;
      }
    }
  } catch {
    // not installed via git
  }
  // 3. Common install paths
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  if (process.env.LOCALAPPDATA) {
    candidates.push(
      path.win32.join(
        process.env.LOCALAPPDATA,
        "Programs",
        "Git",
        "bin",
        "bash.exe",
      ),
    );
  }
  return candidates.find((p) => fs.existsSync(p));
}

function adoptLoginShellPath(): void {
  if (process.platform === "win32") {
    // Git Bash: GUI-launched processes never source the profile, so bash
    // commands would miss PATH additions from ~/.bashrc. Probe the login PATH
    // once and convert it back to Windows form via cygpath so cmd.exe and
    // Node subprocesses can still resolve tools.
    const gitBashPath = resolveGitBashPath();
    if (!gitBashPath) return;
    try {
      // execFileSync, NOT execSync: with execSync the command goes through
      // cmd.exe which would expand `$PATH` BEFORE bash sources the profile,
      // defeating the whole probe.
      const probed = execFileSync(
        gitBashPath,
        ["-lic", 'cygpath -pw "$PATH"'],
        {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .trim()
        .split("\n")
        .pop()
        ?.trim();
      if (probed) process.env.PATH = probed;
    } catch {
      // keep the default PATH — the resolver will surface its usual errors
    }
    return;
  }
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

// Host-side error logging: the wave --stdio children already write cli.log via
// the CLI logger; these handlers cover the Electron main process itself
// (desktop.log). uncaughtException keeps the existing crash semantics (log,
// then exit) — registering a handler otherwise suppresses Node's default
// termination.
process.on("uncaughtException", (error) => {
  hostLog.error("[Wave Desktop] uncaughtException:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  hostLog.error("[Wave Desktop] unhandledRejection:", reason);
});

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
  openPermissionModeMenu: () => {
    host?.openPermissionModeMenu();
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
        hostLog.error(
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
    title: "Codewave IDE",
    backgroundColor: "#1e1e1e",
    // macOS: hide the system title bar (VS Code/Slack style) — content fills
    // the window and the native traffic lights float over the webview's top
    // left. The webview reserves a 44px sidebar drag row / collapsed-header
    // gutter under those lights (spec「macOS 隐藏标题栏」). Windows/Linux keep
    // the native frame, so the option stays darwin-only.
    //
    // trafficLightPosition: Electron anchors y to the NSButton frame's top
    // edge, and that frame carries transparent padding, so the 12px dot's
    // visual center lands at y + ~7 (not y + 6) — y=15 centers the lights on
    // the 44px row's centerline (22px), level with the flex-centered collapse
    // button, with no CSS-side compensation. Don't "fix" the 15 back to 16
    // without re-checking against a real Mac.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hidden" as const,
          trafficLightPosition: { x: 20, y: 15 },
        }
      : {}),
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
  // macOS 全屏时系统红绿灯随系统隐藏：通知 webview 收起红绿灯让位（侧边栏窗口
  // 行按钮左移/收起态顶栏让位段收起），退出全屏还原 (spec「macOS 隐藏标题栏」
  // 场景 7)。Windows/Linux 无此行为，事件不会触发。局部捕获让闭包逃过
  // TS18047（模块级 let 在延迟回调里无法收窄）。
  const win = mainWindow;
  win.on("enter-full-screen", () => host?.notifyFullScreen(win.isFullScreen()));
  win.on("leave-full-screen", () => host?.notifyFullScreen(win.isFullScreen()));
  attachDesktopShortcutKeys(mainWindow.webContents, menuActions);
  // Right-click an image (file panel preview, message image) → 复制图片.
  attachImageContextMenu(mainWindow.webContents);

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
    // Preview pages get the same image right-click copy as the main window.
    attachImageContextMenu(guest);
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
  void mainWindow
    .loadFile(path.join(__dirname, "..", "..", "webview", "index.html"))
    .catch((error) => {
      // A failed webview load is otherwise silent — surface it to desktop.log.
      console.error("[Wave Desktop] Failed to load webview:", error);
      hostLog.error("[Wave Desktop] Failed to load webview:", error);
    });
}
