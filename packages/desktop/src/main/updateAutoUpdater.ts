/**
 * AutoUpdaterService — electron-updater wrapper for logged-in (serverUrl)
 * installs. The update feed is the codechat downloads endpoint served in
 * electron-builder metadata format (latest-mac.yml / latest.yml), NOT GitHub
 * Releases. Hosts the update-available / update-downloaded callbacks so the
 * desktop host can surface them as chat system messages.
 */

import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

export interface AutoUpdaterCallbacks {
  /** A newer version was found and the background download has started. */
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

  /** Point the generic provider at the codechat feed and check for updates. */
  async checkForUpdates(serverUrl: string): Promise<UpdateCheckOutcome> {
    this.attachListeners();
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
    autoUpdater.quitAndInstall();
  }
}
