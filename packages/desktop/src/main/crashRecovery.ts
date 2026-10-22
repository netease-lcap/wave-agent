/**
 * Renderer crash / freeze recovery: what the user sees, and the evidence we
 * keep before they pick.
 *
 * Context (real incident): after ~53h uptime the whole window went black while
 * the agent tasks kept running in the `wave --stdio` children. The renderer was
 * gone — a native V8 crash in `cppgc` (see crashReporter.ts) — so the window was
 * still there, just painting `backgroundColor: "#1e1e1e"` with nothing in it.
 *
 * Two rules this module encodes:
 *
 * 1. **No automatic reload.** A reload wipes the crash scene (JS heap, console,
 *    the DOM state that led there) and resets the session the user was looking
 *    at. We surface the failure and let the user choose. This is the one place
 *    we deliberately differ from "just reload and move on" designs.
 * 2. **Recovery means relaunch, not reopen.** Closing the window runs
 *    before-quit → `host.dispose()`, which kills the very tasks that survived
 *    the crash. So the dialog offers relaunch/exit explicitly instead of
 *    pretending a new window would help.
 */

import { app, dialog, shell } from "electron";
import type { BrowserWindow } from "electron";
import { hostLog, LOG_DIR } from "./hostLog";
import { exportDiagnostics } from "./exportDiagnostics";
import { createUnresponsiveSampler } from "./unresponsiveSampler";
import type { UnresponsiveSampler } from "./unresponsiveSampler";

type RecoveryLog = typeof hostLog;

/** Chromium's net::ERR_ABORTED — a normal navigation cancellation, not a fault. */
export const NET_ERR_ABORTED = -3;

export type RecoveryKind = "crash" | "load-failed" | "unresponsive";

export type RecoveryActionId =
  | "relaunch"
  | "export-logs"
  | "quit"
  | "keep-waiting";

export type RecoveryAction = { id: RecoveryActionId; label: string };

/**
 * A dead renderer and a failed load have no "wait for it" option — nothing is
 * going to happen on its own. A freeze does, so that slot becomes 「继续等待」.
 */
const ACTIONS: Record<RecoveryKind, RecoveryAction[]> = {
  crash: [
    { id: "relaunch", label: "重启应用" },
    { id: "export-logs", label: "导出日志" },
    { id: "quit", label: "退出" },
  ],
  "load-failed": [
    { id: "relaunch", label: "重启应用" },
    { id: "export-logs", label: "导出日志" },
    { id: "quit", label: "退出" },
  ],
  unresponsive: [
    { id: "relaunch", label: "重启应用" },
    { id: "export-logs", label: "导出日志" },
    { id: "keep-waiting", label: "继续等待" },
  ],
};

export function recoveryActions(kind: RecoveryKind): RecoveryAction[] {
  return ACTIONS[kind];
}

/**
 * Subframe failures are routine (the preview pane's localhost dev server going
 * away) and −3 is Chromium cancelling its own navigation — neither means the UI
 * is gone, so neither deserves a modal dialog.
 */
export function shouldRecoverMainFrameLoadFailure(
  isMainFrame: boolean,
  errorCode: number,
): boolean {
  return isMainFrame && errorCode !== NET_ERR_ABORTED;
}

export type RecoveryInfo = {
  windowName: string;
  url: string;
  reason?: string;
  exitCode?: number;
  errorCode?: number;
  errorDescription?: string;
  lastMemory?: string;
};

/**
 * Dialog copy (Chinese, matching the app menu). Kept as a pure function so the
 * wording — which is the whole user-visible part of this feature — is testable.
 */
export function recoveryMessage(info: RecoveryInfo & { kind: RecoveryKind }): {
  message: string;
  detail: string;
} {
  const where = `窗口：${info.windowName}\n页面：${info.url}`;
  const logHint = `日志目录：${LOG_DIR}`;

  if (info.kind === "crash") {
    return {
      message: "界面已崩溃",
      detail: [
        `渲染进程已退出（原因：${info.reason ?? "未知"}，退出码：${info.exitCode ?? "未知"}）。`,
        where,
        ...(info.lastMemory ? [`崩溃前最后内存：${info.lastMemory}`] : []),
        "后台任务可能仍在运行；界面不会自动重载——重载会抹掉崩溃现场并重置当前会话，所以由你决定下一步。",
        "「重启应用」会结束正在运行的任务；想保留现场请先「导出日志」。",
        logHint,
      ].join("\n"),
    };
  }

  if (info.kind === "load-failed") {
    return {
      message: "界面加载失败",
      detail: [
        `错误：${info.errorCode ?? "未知"} ${info.errorDescription ?? ""}`.trim(),
        `页面：${info.url}`,
        "界面不会自动重载（重载会掩盖失败原因，也会重置当前会话）。",
        logHint,
      ].join("\n"),
    };
  }

  return {
    message: "界面无响应",
    detail: [
      where,
      "正在每秒采集一次 JS 调用栈并写入日志（最多 15 秒）；后台任务不受影响。",
      "若界面稍后恢复，应用会继续运行；「继续等待」后若再次卡住会再次提示。",
      logHint,
    ].join("\n"),
  };
}

export type CrashRecoveryOptions = {
  windowName?: string;
  log?: RecoveryLog;
  /** Defaults to the real archive export; injected in tests. */
  exportLogs?: () => Promise<string | undefined>;
  /** Last renderer memory reading, appended to the crash log. */
  lastMemory?: () => string | undefined;
  /** Injected in tests; otherwise created against `win`. */
  sampler?: UnresponsiveSampler;
};

/**
 * Wires the four Chromium signals (two load-failure events, process-gone,
 * unresponsive/responsive) to logging + one modal dialog at a time.
 */
export function attachCrashRecovery(
  win: BrowserWindow,
  options: CrashRecoveryOptions = {},
): { sampler: UnresponsiveSampler } {
  const {
    windowName = "main",
    log = hostLog,
    exportLogs = exportDiagnostics,
    lastMemory = () => undefined,
  } = options;
  const sampler =
    options.sampler ?? createUnresponsiveSampler(win, { windowName, log });

  // One dialog at a time: a crash typically emits several events (unresponsive
  // → render-process-gone → load failure), and stacked modals are unusable.
  let showing = false;

  const currentUrl = (): string => {
    try {
      return win.isDestroyed() ? "destroyed" : win.webContents.getURL();
    } catch {
      return "unknown";
    }
  };

  const runExport = async (): Promise<void> => {
    try {
      const dest = await exportLogs();
      if (!dest) return; // user cancelled the save dialog
      log.info(`[desktop] diagnostics exported to ${dest}`);
      shell.showItemInFolder(dest);
      await dialog.showMessageBox(win, {
        type: "info",
        message: "诊断日志已导出",
        detail: `文件位置：${dest}\n请把该文件提供给支持人员。`,
        buttons: ["好"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    } catch (error) {
      log.error("[desktop] failed to export diagnostics:", error);
      await dialog.showMessageBox(win, {
        type: "error",
        message: "诊断日志导出失败",
        detail: [
          error instanceof Error ? error.message : String(error),
          `也可以手动打包：\n日志：${LOG_DIR}`,
        ].join("\n"),
        buttons: ["好"],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
    }
  };

  const show = async (
    kind: RecoveryKind,
    info: RecoveryInfo,
  ): Promise<void> => {
    if (showing || win.isDestroyed()) return;
    showing = true;
    try {
      // Loops only for 「导出日志」: the user came back to the same broken
      // window, so re-present the choice instead of dropping them into a dead UI.
      for (;;) {
        if (win.isDestroyed()) return;
        const actions = recoveryActions(kind);
        const { message, detail } = recoveryMessage({ kind, ...info });
        const { response } = await dialog.showMessageBox(win, {
          type: "warning",
          buttons: actions.map((action) => action.label),
          defaultId: 0,
          cancelId: actions.length - 1,
          noLink: true,
          message,
          detail,
        });
        const action = actions[response];
        if (!action) return;
        log.info(
          `[desktop] recovery dialog kind=${kind} action=${action.id} window=${windowName}`,
        );

        if (action.id === "export-logs") {
          await runExport();
          continue;
        }
        if (action.id === "relaunch") {
          relaunchApp(log);
          return;
        }
        if (action.id === "quit") {
          log.warn(
            `[desktop] user quit with a failed renderer window=${windowName}`,
          );
          app.exit(0);
          return;
        }
        // 「继续等待」: keep collecting evidence. The sampler stops itself after
        // its 15s window, so start a fresh one — if the renderer is still stuck
        // we want the next 15s too, not silence.
        sampler.start();
        return;
      }
    } finally {
      // Releasing the latch here is what lets a *second* freeze (after
      // 「继续等待」) raise a dialog again.
      showing = false;
    }
  };

  const handleLoadFailure = (
    event: string,
    errorCode: number,
    errorDescription: string,
    validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    log.error(
      `[desktop] renderer load failed event=${event} errorCode=${errorCode} description=${errorDescription} url=${validatedURL} isMainFrame=${isMainFrame}`,
    );
    if (!shouldRecoverMainFrameLoadFailure(isMainFrame, errorCode)) return;
    void show("load-failed", {
      windowName,
      url: validatedURL || currentUrl(),
      errorCode,
      errorDescription,
    });
  };

  win.webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      handleLoadFailure(
        "did-fail-load",
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      );
    },
  );
  win.webContents.on(
    "did-fail-provisional-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      handleLoadFailure(
        "did-fail-provisional-load",
        errorCode,
        errorDescription,
        validatedURL,
        isMainFrame,
      );
    },
  );

  win.webContents.on("render-process-gone", (_event, details) => {
    // Flush first: the samples taken while it was freezing are the most local
    // evidence we will ever get.
    sampler.stopAndFlush();
    const memory = lastMemory();
    log.error(
      `[desktop] renderer process gone reason=${details.reason} exitCode=${details.exitCode} url=${currentUrl()}${memory ? ` lastMemory=${memory}` : ""}`,
    );
    void show("crash", {
      windowName,
      url: currentUrl(),
      reason: details.reason,
      exitCode: details.exitCode,
      lastMemory: memory,
    });
  });

  win.on("unresponsive", () => {
    log.warn(`[desktop] renderer unresponsive url=${currentUrl()}`);
    sampler.start();
    void show("unresponsive", { windowName, url: currentUrl() });
  });

  win.on("responsive", () => {
    log.info(`[desktop] renderer responsive again url=${currentUrl()}`);
    sampler.stopAndFlush();
  });

  return { sampler };
}

/**
 * `app.exit`, never `app.quit`: quit runs before-quit, which awaits
 * `host.dispose()` under a 5s timeout — that turns 「重启应用」 into a five second
 * freeze on an already broken window. Skipping the quit events is safe because
 * the `wave --stdio` children exit on stdin EOF (the same guarantee the
 * force-quit path relies on); the crash/log evidence is already on disk.
 */
function relaunchApp(log: RecoveryLog): void {
  log?.warn("[desktop] relaunching app after renderer failure");
  app.relaunch();
  app.exit(0);
}
