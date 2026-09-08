/**
 * AutoUpdaterService — electron-updater wrapper for logged-in (serverUrl)
 * installs. The update feed is the codechat downloads endpoint served in
 * electron-builder metadata format (latest-mac.yml / latest.yml), NOT GitHub
 * Releases.
 *
 * The host drives the S0–S6 update button state machine (spec
 * desktop-account-and-settings.md「账户卡片 · 更新按钮状态机」): a check only
 * *announces* an update (`update-available` → status idle, the card shows the
 * 更新 button); the download starts only after the user confirms in the S2
 * dialog (`startDownload`, which the host precedes by pushing status
 * "downloading"). `update-downloaded` maps to the "ready" push, and errors
 * reset the state to idle so the user can retry — no toasts, no auto-download,
 * no auto-restart.
 */

import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";
import type { UpdateChannel } from "./configStore";
import { parseVersion, compareVersions } from "./version";

export interface AutoUpdaterCallbacks {
  /** A check found a newer version. The download does NOT auto-start — the
   *  host surfaces the 更新 button (S1) and waits for the user's S2 confirm. */
  onUpdateAvailable: (info: UpdateInfo) => void;
  /** The new version finished downloading — the host pushes status "ready". */
  onUpdateDownloaded: (info: UpdateInfo) => void;
  /** The check or background download failed — the host resets to idle (S1). */
  onError: (error: Error) => void;
}

export type UpdateCheckOutcome = "update" | "no-update" | "error";

/** Outcome plus the feed's latest version as reported by electron-updater.
 *  `feedVersion` is set whenever the provider answered (update or no-update) —
 *  the host compares it against the installed version to tell "正式未追平已装
 *  测试版" from "已是最新" (spec desktop-shell「接收 Beta 版更新」场景 5). */
export interface UpdateCheckResult {
  outcome: UpdateCheckOutcome;
  feedVersion?: string;
}

/** codechat 更新 feed 目录：stable = `/api/downloads/desktop/{platform}/`，
 *  beta = `/api/downloads/desktop-beta/{platform}/`（依赖 codechat #33）。 */
export function feedUrlFor(
  serverUrl: string,
  channel: UpdateChannel = "stable",
): string {
  const platform = process.platform === "win32" ? "win" : "mac";
  const bucket = channel === "beta" ? "desktop-beta" : "desktop";
  return `${serverUrl.replace(/\/+$/, "")}/api/downloads/${bucket}/${platform}/`;
}

export class AutoUpdaterService {
  private listenersAttached = false;

  constructor(private readonly callbacks: AutoUpdaterCallbacks) {}

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    autoUpdater.on("update-available", (info) =>
      this.callbacks.onUpdateAvailable(info),
    );
    autoUpdater.on("update-downloaded", (info) =>
      this.callbacks.onUpdateDownloaded(info),
    );
    autoUpdater.on("error", (error) => this.callbacks.onError(error));
  }

  /** Point the generic provider at the codechat feed (stable or beta per the
   *  current updateChannel) and check for updates.
   *  autoDownload=false: finding an update only announces it (S1 更新 button) —
   *  the host calls startDownload() once the user confirms in the S2 dialog. */
  async checkForUpdates(
    serverUrl: string,
    channel: UpdateChannel = "stable",
  ): Promise<UpdateCheckResult> {
    this.attachListeners();
    autoUpdater.autoDownload = false;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrlFor(serverUrl, channel),
    });
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo.version;
      // 语义比较：仅当 feed 版本高于已装版本才算 update。feed 版本低于/等于
      // 已装版本一律 no-update —— 曾接收测试版、正式 feed 尚未追平时返回
      // no-update + feedVersion，宿主据此提示「正式版发布后将自动更新」，绝不
      // 误报更新让用户降级（spec desktop-shell「接收 Beta 版更新」场景 5）。
      const installed = parseVersion(app.getVersion());
      const feed = version ? parseVersion(version) : null;
      if (version && installed && feed) {
        return compareVersions(feed, installed) > 0
          ? { outcome: "update", feedVersion: version }
          : { outcome: "no-update", feedVersion: version };
      }
      // 版本不可解析（极少见）——退化为字符串不等判定，保持旧行为。
      if (!version) return { outcome: "no-update" };
      return version !== app.getVersion()
        ? { outcome: "update", feedVersion: version }
        : { outcome: "no-update", feedVersion: version };
    } catch (error) {
      console.warn("[AutoUpdater] update check failed:", error);
      return { outcome: "error" };
    }
  }

  /** Start the background download (S2 确认后). Failures surface via the
   *  'error' event → the host resets status to idle so the user can retry. */
  async startDownload(): Promise<void> {
    this.attachListeners();
    await autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    // isSilent=true → NSIS installer runs with /S (no wizard UI);
    // isForceRunAfter=true → the installer gets --force-run, which is what
    // makes the assisted installer relaunch the app after a silent install.
    // Without it the update installs but the app never comes back.
    autoUpdater.quitAndInstall(true, true);
  }
}
