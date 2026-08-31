/**
 * AutoUpdaterService — electron-updater wrapper for logged-in (serverUrl)
 * installs. The update feed is the codechat downloads endpoint served in
 * electron-builder metadata format (latest-mac.yml / latest.yml), NOT GitHub
 * Releases. Hosts the update-downloaded / error callbacks so the desktop host
 * can surface them as chat system messages. Download progress stays silent.
 */

import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

export interface AutoUpdaterCallbacks {
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
    autoUpdater.on("update-downloaded", (info) =>
      this.callbacks.onUpdateDownloaded(info),
    );
    autoUpdater.on("error", (error) => this.callbacks.onError(error));
  }

  /** Point the generic provider at the codechat feed and check for updates. */
  async checkForUpdates(serverUrl: string): Promise<UpdateCheckOutcome> {
    this.attachListeners();
    // No silent background download: the update flow is user-confirmed (spec
    // 「账户卡片」场景 5). checkForUpdates only reports availability; the host
    // calls downloadUpdate() after the user confirms.
    autoUpdater.autoDownload = false;
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

  /** Download the available update (the user confirmed). Emits update-downloaded on success. */
  downloadUpdate(): void {
    void autoUpdater.downloadUpdate();
  }

  quitAndInstall(): void {
    // isSilent=true → NSIS installer runs with /S (no wizard UI);
    // isForceRunAfter=true → the installer gets --force-run, which is what
    // makes the assisted installer relaunch the app after a silent install.
    // Without it the update installs but the app never comes back.
    autoUpdater.quitAndInstall(true, true);
  }
}
