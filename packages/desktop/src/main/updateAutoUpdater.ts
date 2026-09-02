/**
 * AutoUpdaterService — electron-updater wrapper for logged-in (serverUrl)
 * installs. The update feed is the codechat downloads endpoint served in
 * electron-builder metadata format (latest-mac.yml / latest.yml), NOT GitHub
 * Releases.
 *
 * The host drives the S0–S6 update button state machine (spec
 * desktop-account-card-and-panel-tabs.md「更新按钮状态机」): a check only
 * *announces* an update (`update-available` → status idle, the card shows the
 * 更新 button); the download starts only after the user confirms in the S2
 * dialog (`startDownload`, which the host precedes by pushing status
 * "downloading"). `update-downloaded` maps to the "ready" push, and errors
 * reset the state to idle so the user can retry — no toasts, no auto-download,
 * no auto-restart.
 */

import { app } from "electron";
import { autoUpdater, type UpdateInfo } from "electron-updater";

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
   *  autoDownload=false: finding an update only announces it (S1 更新 button) —
   *  the host calls startDownload() once the user confirms in the S2 dialog. */
  async checkForUpdates(serverUrl: string): Promise<UpdateCheckOutcome> {
    this.attachListeners();
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
