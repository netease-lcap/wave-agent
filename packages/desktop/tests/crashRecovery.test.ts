import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BrowserWindow } from "electron";
import { app, dialog, shell } from "electron";
import { LOG_DIR } from "../src/main/hostLog.js";
import {
  attachCrashRecovery,
  recoveryActions,
  recoveryMessage,
  shouldRecoverMainFrameLoadFailure,
} from "../src/main/crashRecovery.js";
import type { UnresponsiveSampler } from "../src/main/unresponsiveSampler.js";

type FakeWindow = {
  win: BrowserWindow;
  emitWindow: (event: string, ...args: unknown[]) => void;
  emitWebContents: (event: string, ...args: unknown[]) => void;
  webContents: { reload: ReturnType<typeof vi.fn>; getURL: () => string };
};

const createFakeWindow = (): FakeWindow => {
  const windowListeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const webContentsListeners = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();
  const webContents = {
    reload: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    getURL: vi.fn(() => "file:///app/webview/index.html"),
    mainFrame: { collectJavaScriptCallStack: vi.fn(async () => "at spin") },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      webContentsListeners.set(event, [
        ...(webContentsListeners.get(event) ?? []),
        cb,
      ]);
    }),
  };
  const win = {
    isDestroyed: vi.fn(() => false),
    webContents,
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      windowListeners.set(event, [...(windowListeners.get(event) ?? []), cb]);
      return win;
    }),
  };
  const fire =
    (listeners: Map<string, Array<(...args: unknown[]) => void>>) =>
    (event: string, ...args: unknown[]) => {
      for (const cb of listeners.get(event) ?? []) cb(...args);
    };
  return {
    win: win as unknown as BrowserWindow,
    webContents,
    emitWindow: fire(windowListeners),
    emitWebContents: fire(webContentsListeners),
  };
};

const createLog = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  block: vi.fn(),
});

const createSampler = () =>
  ({
    start: vi.fn(),
    stopAndFlush: vi.fn(() => true),
    isSampling: vi.fn(() => false),
  }) as unknown as UnresponsiveSampler & {
    start: ReturnType<typeof vi.fn>;
    stopAndFlush: ReturnType<typeof vi.fn>;
  };

/** The handlers are fire-and-forget (`void show(...)`); let their microtasks run. */
const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe("crashRecovery — pure decisions", () => {
  it("offers wait-for-it only when waiting could help", () => {
    expect(recoveryActions("crash").map((action) => action.id)).toEqual([
      "relaunch",
      "export-logs",
      "quit",
    ]);
    expect(recoveryActions("load-failed").map((action) => action.id)).toEqual([
      "relaunch",
      "export-logs",
      "quit",
    ]);
    expect(recoveryActions("unresponsive")).toEqual([
      { id: "relaunch", label: "重启应用" },
      { id: "export-logs", label: "导出日志" },
      { id: "keep-waiting", label: "继续等待" },
    ]);
  });

  it("skips subframe failures and aborted navigations", () => {
    expect(shouldRecoverMainFrameLoadFailure(true, -2)).toBe(true);
    expect(shouldRecoverMainFrameLoadFailure(true, -3)).toBe(false); // ERR_ABORTED
    expect(shouldRecoverMainFrameLoadFailure(false, -2)).toBe(false);
  });

  it("explains the crash, the evidence and why nothing reloads by itself", () => {
    const { message, detail } = recoveryMessage({
      kind: "crash",
      windowName: "main",
      url: "file:///app/webview/index.html",
      reason: "crashed",
      exitCode: 133,
      lastMemory: "renderer memory pid=1 workingSet=2048MB peak=4096MB",
    });

    expect(message).toBe("界面已崩溃");
    expect(detail).toContain("原因：crashed");
    expect(detail).toContain("退出码：133");
    expect(detail).toContain("workingSet=2048MB");
    expect(detail).toContain("不会自动重载");
    expect(detail).toContain(`日志目录：${LOG_DIR}`);
  });

  it("describes a load failure with the Chromium error", () => {
    const { message, detail } = recoveryMessage({
      kind: "load-failed",
      windowName: "main",
      url: "file:///app/webview/index.html",
      errorCode: -6,
      errorDescription: "FILE_NOT_FOUND",
    });

    expect(message).toBe("界面加载失败");
    expect(detail).toContain("-6 FILE_NOT_FOUND");
  });
});

describe("attachCrashRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0 });
  });

  it("records a crash with reason, exit code and memory, then relaunches on request", async () => {
    const { win, emitWebContents, webContents } = createFakeWindow();
    const log = createLog();
    const sampler = createSampler();

    attachCrashRecovery(win, {
      log,
      sampler,
      lastMemory: () => "renderer memory pid=42 workingSet=3000MB peak=3900MB",
    });

    emitWebContents(
      "render-process-gone",
      {},
      { reason: "crashed", exitCode: 133 },
    );
    await flush();

    expect(sampler.stopAndFlush).toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "reason=crashed exitCode=133 url=file:///app/webview/index.html lastMemory=renderer memory pid=42 workingSet=3000MB peak=3900MB",
      ),
    );
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        type: "warning",
        buttons: ["重启应用", "导出日志", "退出"],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
        message: "界面已崩溃",
      }),
    );

    // 「重启应用」: relaunch + exit, never quit (which would await host.dispose).
    expect(app.relaunch).toHaveBeenCalled();
    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.quit).not.toHaveBeenCalled();
    // The whole design refuses to auto-reload: it would erase the crash scene.
    expect(webContents.reload).not.toHaveBeenCalled();
  });

  it("keeps a single dialog for the cascade of events one crash emits", async () => {
    const { win, emitWebContents } = createFakeWindow();
    const log = createLog();
    let resolveDialog: (value: { response: number }) => void = () => {};
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(
      () => new Promise((resolve) => (resolveDialog = resolve)),
    );

    attachCrashRecovery(win, { log, sampler: createSampler() });

    emitWebContents(
      "render-process-gone",
      {},
      { reason: "crashed", exitCode: 133 },
    );
    await flush();
    emitWebContents(
      "render-process-gone",
      {},
      { reason: "crashed", exitCode: 133 },
    );
    emitWebContents(
      "did-fail-load",
      {},
      -6,
      "FILE_NOT_FOUND",
      "file:///x",
      true,
    );
    await flush();

    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1);

    resolveDialog({ response: 2 }); // 退出
    await flush();
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("logs every failed load but only asks the user about the main frame", async () => {
    const { win, emitWebContents } = createFakeWindow();
    const log = createLog();

    attachCrashRecovery(win, { log, sampler: createSampler() });

    emitWebContents(
      "did-fail-load",
      {},
      -105,
      "NAME_NOT_RESOLVED",
      "http://localhost:3000/",
      false,
    );
    emitWebContents(
      "did-fail-load",
      {},
      -3,
      "ABORTED",
      "file:///app/webview/index.html",
      true,
    );
    await flush();

    expect(log.error).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("errorCode=-105 description=NAME_NOT_RESOLVED"),
    );
    expect(vi.mocked(log.error).mock.calls[0][0]).toContain(
      "isMainFrame=false",
    );
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("asks about a main-frame load failure", async () => {
    const { win, emitWebContents } = createFakeWindow();
    const log = createLog();

    attachCrashRecovery(win, { log, sampler: createSampler() });

    emitWebContents(
      "did-fail-provisional-load",
      {},
      -6,
      "FILE_NOT_FOUND",
      "file:///app/webview/index.html",
      true,
    );
    await flush();

    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        message: "界面加载失败",
        buttons: ["重启应用", "导出日志", "退出"],
      }),
    );
  });

  it("samples while unresponsive, flushes on responsive, and re-offers the dialog after 继续等待", async () => {
    const { win, emitWindow } = createFakeWindow();
    const log = createLog();
    const sampler = createSampler();
    vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 2 }); // 继续等待

    attachCrashRecovery(win, { log, sampler });

    emitWindow("unresponsive");
    await flush();

    expect(sampler.start).toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        buttons: ["重启应用", "导出日志", "继续等待"],
        message: "界面无响应",
        cancelId: 2,
      }),
    );
    // 「继续等待」 must not relaunch; it starts a fresh sampling window.
    expect(app.relaunch).not.toHaveBeenCalled();
    expect(sampler.start).toHaveBeenCalledTimes(2);

    // Latch released → a second freeze raises a dialog again.
    emitWindow("unresponsive");
    await flush();
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);

    emitWindow("responsive");
    expect(sampler.stopAndFlush).toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining("renderer responsive again"),
    );
  });

  it("exports diagnostics, tells the user where the file is, then asks again", async () => {
    const { win, emitWebContents } = createFakeWindow();
    const log = createLog();
    const exportLogs = vi.fn(
      async () => "/Users/someone/Desktop/codewave-diagnostics-X.tar.gz",
    );
    vi.mocked(dialog.showMessageBox)
      .mockResolvedValueOnce({ response: 1 }) // 导出日志
      .mockResolvedValueOnce({ response: 0 }) // 成功提示「好」
      .mockResolvedValueOnce({ response: 2 }); // 退出

    attachCrashRecovery(win, { log, exportLogs, sampler: createSampler() });

    emitWebContents("render-process-gone", {}, { reason: "oom", exitCode: 9 });
    await flush();

    expect(exportLogs).toHaveBeenCalledTimes(1);
    expect(shell.showItemInFolder).toHaveBeenCalledWith(
      "/Users/someone/Desktop/codewave-diagnostics-X.tar.gz",
    );
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        message: "诊断日志已导出",
        detail: expect.stringContaining(
          "/Users/someone/Desktop/codewave-diagnostics-X.tar.gz",
        ),
      }),
    );
    // After exporting, the same broken window is still there → dialog returns.
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(3);
    expect(app.exit).toHaveBeenCalledWith(0);
  });

  it("reports an export failure instead of dying silently", async () => {
    const { win, emitWebContents } = createFakeWindow();
    const log = createLog();
    const exportLogs = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });
    vi.mocked(dialog.showMessageBox)
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 2 });

    attachCrashRecovery(win, { log, exportLogs, sampler: createSampler() });

    emitWebContents(
      "render-process-gone",
      {},
      { reason: "crashed", exitCode: 133 },
    );
    await flush();

    expect(log.error).toHaveBeenCalledWith(
      "[desktop] failed to export diagnostics:",
      expect.any(Error),
    );
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        message: "诊断日志导出失败",
        detail: expect.stringContaining("EACCES: permission denied"),
      }),
    );
  });

  it("leaves the dialog alone when the window is already gone", async () => {
    const { win, emitWebContents } = createFakeWindow();
    vi.mocked(win.isDestroyed).mockReturnValue(true);

    attachCrashRecovery(win, { log: createLog(), sampler: createSampler() });

    emitWebContents(
      "render-process-gone",
      {},
      { reason: "killed", exitCode: 0 },
    );
    await flush();

    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
