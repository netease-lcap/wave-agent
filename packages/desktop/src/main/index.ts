/**
 * Electron main-process entry.
 *
 * Single instance → ConfigStore + DesktopHost → BrowserWindow (CSP via
 * syncWebview-generated index.html) → IPC wiring. All agent communication
 * happens inside DesktopHost via the shared StdioClient.
 */

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  session,
  shell,
  type MessageBoxOptions,
} from "electron";
import * as path from "path";
import { pathToFileURL } from "url";
import { hostLog } from "./hostLog";
import { WEBVIEW_CHANNEL } from "./channels";
import { ConfigStore } from "./configStore";
import { DesktopHost } from "./desktopHost";
import { primeLoginShellEnv } from "./loginShellEnv";
import { isLocalhostUrl } from "./isLocalhostUrl";
import { attachNavigationGuards } from "./navigationGuard";
import { DEEP_LINK_SCHEME, findDeepLink } from "./deepLink";
import { startLocalCrashReporter } from "./crashReporter";
import { attachCrashRecovery } from "./crashRecovery";
import { createMemorySampler } from "./memorySampler";
import { createQuitHandler } from "./quitHandler";
import { createTrayController, TRAY_ICON_PATH } from "./tray";
import { JS_CALL_STACKS_DOCUMENT_POLICY } from "./unresponsiveSampler";
import {
  attachContextMenu,
  attachDesktopShortcutKeys,
  installApplicationMenu,
  updateMenuState,
  type DesktopMenuActions,
} from "./menu";

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

// userData 走 Electron 默认派生（appData + app 顶层 productName "CodeWave IDE"，
// 即 %APPDATA%\CodeWave IDE）。品牌改名是 clean break（客户手动卸载旧版重装，
// 见 f1feed70 决策）——不沿用 wave-desktop/Wave 旧目录，配置/会话索引全新开始；
// 卸载器默认不删 %APPDATA% 数据，旧数据若需清理由客户手动删。
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

/**
 * Windows only: closing the window hides it to the tray, so long-running work
 * (streaming, tools, terminal PTYs, remote sessions) survives a stray click on
 * X. It is created lazily on the first close — before that no icon sits in the
 * tray — and the close is only intercepted when creation succeeded
 * (see tray.ts / spec「Windows 关闭窗口最小化到托盘」).
 */
const trayController = createTrayController({
  iconPath: path.join(__dirname, TRAY_ICON_PATH),
  getWindow: () => mainWindow,
  quit: () => app.quit(),
});

/**
 * Brings the window back from minimized or hidden-to-tray. `show()` is what
 * undoes the tray hiding — `hide()` also removed the window from the taskbar,
 * and `focus()` alone does not put it back. Used by deep links, a plain second
 * launch, and crash recovery.
 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/**
 * 退出前问一次：还有本地会话在跑时先确认（spec desktop-shell.md「退出时保护
 * 运行中的会话」）。返回 false = 用户取消，本次退出作废。
 *
 * 计数取宿主里 agent 的**实时运行态**，不是侧栏快照；只看本地会话（远端会话
 * 跑在远端 daemon 上，退出应用不会打断它们）。没有会话在跑时直接放行——常规
 * 退出不该多一次点击。
 *
 * 窗口可能正缩在托盘里或已最小化：先把窗口叫回前台再弹框，否则对话框出现在
 * 用户看不见的地方（场景 7）。
 */
async function confirmQuitWithRunningSessions(): Promise<boolean> {
  // 更新重启（S4「立即重启」→ quitAndInstall）发起的退出不再问第二遍：用户刚刚
  // 在对话框里知情确认过会中断任务（spec desktop-shell.md 边界「确认框与更新重启
  // 同时到达：两者不得同时向用户提问」）。
  if (host?.consumeUpdateRestartQuit()) return true;
  const running = host?.countRunningLocalSessions() ?? 0;
  if (running === 0) return true;
  showMainWindow();
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const options: MessageBoxOptions = {
    type: "warning",
    buttons: ["取消", "仍然退出"],
    // 默认焦点与 Esc 都落在「取消」：一次误按回车不该把正在跑的一轮杀掉
    // （场景 2）。
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    message: `还有 ${running} 个会话正在运行`,
    detail: "退出会中断正在生成的内容、执行中的工具与后台命令。仍要退出吗？",
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 1;
}

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

/**
 * The one document the main window may ever show. `webview/` lives at the
 * package root (synced by scripts/syncWebview.mjs), so `dist/main → ../..`
 * reaches it both in dev and inside app.asar. The URL form is derived from the
 * same path `loadFile` gets, because `loadFile` is what turns it into the entry
 * URL the navigation guard compares against.
 */
const WEBVIEW_ENTRY_PATH = path.join(
  __dirname,
  "..",
  "..",
  "webview",
  "index.html",
);
const WEBVIEW_ENTRY_URL = pathToFileURL(WEBVIEW_ENTRY_PATH).href;

/**
 * Register `wave://` with the OS.
 *
 * electron-builder's `protocols` field only covers macOS (Info.plist) and Linux
 * (.desktop) — the NSIS installer writes no registry entry at all, so on Windows
 * this runtime call is the *only* thing that creates
 * `HKCU\Software\Classes\wave`. Consequence worth knowing: a freshly installed
 * app cannot be woken by a link until it has been launched once.
 */
function registerDeepLinkProtocol(): void {
  try {
    if (process.defaultApp) {
      // Dev launches the bare Electron binary, so the app entry script has to be
      // passed along — otherwise the protocol spawns an electron.exe that knows
      // nothing about this app.
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
          path.resolve(process.argv[1]),
        ]);
      }
    } else {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    }
  } catch (error) {
    // Never fatal — everything else works without the protocol.
    hostLog.error("[Wave Desktop] Failed to register wave:// protocol:", error);
  }
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  // Must be after the dev userData override above (crashDumps derives from it)
  // and before `whenReady` — Crashpad has to be up before the first renderer
  // spawns, or a launch-time renderer crash leaves no dump. Not in the doomed
  // second-instance process, which quits immediately. Local minidumps only,
  // no upload (crashReporter.ts).
  startLocalCrashReporter();

  /**
   * Links that arrive before the host exists. macOS delivers `open-url` before
   * the window is ready and a cold-start link rides in on argv; both would
   * otherwise be dropped. The host serializes them once handed over.
   */
  const pendingDeepLinks: string[] = [];

  const routeDeepLink = (url: string): void => {
    showMainWindow();
    if (host) {
      void host.handleDeepLink(url);
      return;
    }
    pendingDeepLinks.push(url);
  };

  // macOS: LaunchServices pushes the URL to the *running* instance as an Apple
  // Event. The listener must exist before `ready` — registering it inside
  // `whenReady()` is the classic way to lose a launch-triggering URL.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    routeDeepLink(url);
  });

  // Windows/Linux: a protocol URL starts a *new* process. The single-instance
  // lock makes that process hand its command line over and quit, and the URL is
  // somewhere inside it — never at a fixed position, since Chromium appends its
  // own switches to a second instance's argv.
  app.on("second-instance", (_event, commandLine) => {
    const url = findDeepLink(commandLine);
    if (url) {
      routeDeepLink(url);
      return;
    }
    // A plain second launch (no link) still just brings the window forward —
    // including out of the tray.
    showMainWindow();
  });

  void app.whenReady().then(() => {
    // Login-shell environment probe (spec `core/bash-tools.md`「登录 shell 环境
    // 注入」): fired here, fire-and-forget, so it overlaps with the CLI binary
    // sync instead of blocking launch — no window, frame or session waits for
    // it. `DesktopHost.ensureClient()` awaits the same promise right before it
    // spawns `wave --stdio`, which is the one place that needs the environment
    // complete (and by then it has almost always settled).
    void primeLoginShellEnv();

    registerDeepLinkProtocol();

    // `collectJavaScriptCallStack()` (the freeze sampler) refuses to hand out
    // stacks unless the document opted in via Document-Policy, and the webview
    // is loaded from file:// where no server can set a header. This session
    // hook is the only place to add it — verified against Electron 43: the
    // collector then returns a real stack for a frozen renderer.
    session.defaultSession.webRequest.onHeadersReceived(
      { urls: ["file://*/*"] },
      (details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Document-Policy": [JS_CALL_STACKS_DOCUMENT_POLICY],
          },
        });
      },
    );

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

    // Drain the links that arrived before the host was ready, plus this
    // process's own argv (a cold start on Windows/Linux).
    if (host) {
      const coldStartLink = findDeepLink(process.argv);
      if (coldStartLink) pendingDeepLinks.push(coldStartLink);
      for (const url of pendingDeepLinks.splice(0)) {
        void host.handleDeepLink(url);
      }
    }

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

  // Never fire-and-forget the dispose: quitting before the destroy RPC reaches
  // the agent would orphan the wave --stdio child (the other half of the fix is
  // stdioServer's stdin-EOF self-exit). The handler holds the quit, awaits
  // dispose bounded by a timeout, then finishes through `app.quit()` rather
  // than `app.exit()` — the ordinary sequence also reaps crashpad-handler,
  // which `exit()` strands as an orphan (see quitHandler.ts).
  const handleQuit = createQuitHandler({
    dispose: () => (host ? host.dispose() : Promise.resolve()),
    quit: () => app.quit(),
    exit: (code) => app.exit(code),
    onDisposeError: (error) => {
      hostLog.error("[desktop] host dispose failed during quit:", error);
    },
    // 有本地会话在跑时先问一次（spec「退出时保护运行中的会话」）。
    confirmQuit: () => confirmQuitWithRunningSessions(),
    // 确认之后才 latch「正在退出」：用户在确认框上点了取消时，这个 latch 若已
    // 置位，Windows 的「关窗即隐藏到托盘」会失效到下次重启为止。
    onQuitConfirmed: () => trayController.markQuitting(),
  });

  app.on("before-quit", (event) => {
    // Nothing to dispose yet (quit during startup): let Electron finish.
    if (!host) {
      trayController.markQuitting();
      return;
    }
    // Any real quit (tray 退出, menu 文件 → 退出, updater's quitAndInstall)
    // arrives here first; handleQuit latches the quitting state (see
    // onQuitConfirmed) so the window's `close` handler stops hiding the window
    // to the tray and lets the quit sequence continue.
    handleQuit(event);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: "CodeWave IDE",
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

  // Windows: 关闭窗口 = 最小化到托盘 (spec「Windows 关闭窗口最小化到托盘」).
  // `hide()` instead of letting the window be destroyed keeps the renderer —
  // and with it every streaming conversation, running tool and terminal PTY —
  // alive; the app only goes away through the tray menu 退出 / 文件 → 退出,
  // which latch `quitting` in before-quit so this handler passes them through.
  // The interception is conditional on a tray icon actually existing: without
  // one, a hidden window would be unreachable (tray.ts handles that fallback).
  win.on("close", (event) => trayController.handleClose(event, win));

  // Crash/freeze forensics (spec「桌面端渲染进程崩溃与卡死恢复」). Two evidence
  // streams that only make sense together: a memory reading every minute (silent
  // — it surfaces only in the crash log's `lastMemory=`), and JS stack samples
  // during a freeze. Neither reloads anything — recovery is the user's choice in
  // the dialog (see crashRecovery.ts).
  const memorySampler = createMemorySampler({
    // Message volume rides along so the curve can answer "is the heap driven by
    // conversation length?" (6-week sessions keep the UI display stream, and
    // compaction only folds the API context). The count comes from the renderer,
    // which is the only place that stream now exists.
    getMessageStats: () => host?.getMessageStats() ?? [],
  });
  memorySampler.start();
  attachCrashRecovery(win, { lastMemory: () => memorySampler.lastLine() });
  // The recovery dialog is modal on this window: a window hidden to the tray
  // would swallow it (the user sees "nothing happened"), so surface the window
  // before crash recovery gets to ask anything.
  win.on("unresponsive", showMainWindow);
  win.webContents.on("render-process-gone", showMainWindow);

  attachDesktopShortcutKeys(mainWindow.webContents, menuActions);
  // Right-click: 复制图片 on an image (file panel preview, message image), and on
  // text the native macOS 查词 + 复制/全选 (+ 剪切/粘贴 in the input box) menu.
  attachContextMenu(mainWindow.webContents);

  // External links always open in the system browser (FR-008).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) {
      void shell
        .openExternal(url)
        .catch((error) => host?.reportExternalOpenFailure(error));
    }
    return { action: "deny" };
  });

  // Clicking an <a href> navigates the whole window away from the chat UI. The
  // admission rule is "this is the very document we loaded", not "this is a
  // file: URL": a relative link in a markdown preview also resolves to file:,
  // and once it left the window Chromium swapped the whole UI for an error page.
  attachNavigationGuards(mainWindow.webContents, {
    entryUrl: WEBVIEW_ENTRY_URL,
    openExternal: (url) => {
      void shell
        .openExternal(url)
        .catch((error) => host?.reportExternalOpenFailure(error));
    },
    // desktop.log, not the console: in a packaged build nobody sees stdout, and
    // a blocked navigation is the first thing to look for when a link "does
    // nothing".
    log: (...args) => hostLog.warn(...args),
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
    // Preview pages get the same right-click menu (image copy + text menu) as
    // the main window.
    attachContextMenu(guest);
    // Guest pages must never spawn windows — open them externally instead.
    // (The <webview> `new-window` DOM event was removed in Electron 39.)
    guest.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) {
        void shell
          .openExternal(url)
          .catch((error) => host?.reportExternalOpenFailure(error));
      }
      return { action: "deny" };
    });
    // The preview pane is localhost-only: divert in-guest navigation
    // to external sites into the system browser instead of loading them here.
    guest.on("will-navigate", (event, url) => {
      if (isLocalhostUrl(url)) return;
      event.preventDefault();
      if (/^https?:/.test(url)) {
        void shell
          .openExternal(url)
          .catch((error) => host?.reportExternalOpenFailure(error));
      }
    });
  });

  mainWindow.on("closed", () => {
    // The renderer it was measuring is gone; the 60s timer must not outlive it.
    memorySampler.stop();
    mainWindow = null;
  });

  // webview/ lives at the package root (synced by scripts/syncWebview.mjs);
  // dist/main → ../.. reaches the package root both in dev and inside app.asar.
  void mainWindow.loadFile(WEBVIEW_ENTRY_PATH).catch((error) => {
    // A failed webview load is otherwise silent — surface it to desktop.log.
    console.error("[Wave Desktop] Failed to load webview:", error);
    hostLog.error("[Wave Desktop] Failed to load webview:", error);
  });
}
