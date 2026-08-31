/**
 * AutoUpdaterService — electron-updater wrapper for logged-in (serverUrl)
 * installs. The update feed is the codechat downloads endpoint served in
 * electron-builder metadata format (latest-mac.yml / latest.yml), NOT GitHub
 * Releases. Updates download automatically in the background once an update is
 * found; the host surfaces 发现新版本 / 下载完成 via in-app toasts (spec
 * 「桌面端自动更新」场景 3-4). Download progress stays silent.
 */

import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

export interface AutoUpdaterCallbacks {
  /** An update was found and the background download has started. */
  onUpdateAvailable: (info: UpdateInfo) => void;
  /** The new version finished downloading — the host decides whether to install. */
  onUpdateDownloaded: (info: UpdateInfo) => void;
  /** The check or background download failed — the host degrades to the manual flow. */
  onError: (error: Error) => void;
}

export type UpdateCheckOutcome = "update" | "no-update" | "error";

export function feedUrlFor(serverUrl: string): string {
  const platform = process.platform === "win32" ? "win" : "mac";
  return `${serverUrl.replace(/\/+$/, "")}/api/downloads/desktop/${platform}/`;
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

  /** Point the generic provider at the codechat feed and check for updates.
   *  autoDownload=true: finding an update starts the background download right
   *  away (no user confirmation — the account card no longer offers a 更新
   *  button), then update-available fires the host's toast. */
  async checkForUpdates(serverUrl: string): Promise<UpdateCheckOutcome> {
    this.attachListeners();
    autoUpdater.autoDownload = true;
    autoUpdater.setFeedURL({ provider: "generic", url: feedUrlFor(serverUrl) });
    try {
      const result = await autoUpdater.checkForUpdates();
      const version = result?.updateInfo.version;
      return version && version !== app.getVersion() ? "update" : "no-update";
    } catch (error) {
      console.warn("[AutoUpdater] update check failed:", error);
      return "error";
    }
  }

  quitAndInstall(): void {
    // isSilent=true → NSIS installer runs with /S (no wizard UI);
    // isForceRunAfter=true → the installer gets --force-run, which is what
    // makes the assisted installer relaunch the app after a silent install.
    // Without it the update installs but the app never comes back.
    autoUpdater.quitAndInstall(true, true);
  }
}
