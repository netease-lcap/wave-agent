import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const listeners: Record<string, Array<(info: unknown) => void>> = {};
  const autoUpdater = {
    autoDownload: undefined as boolean | undefined,
    checkForUpdates: vi.fn(),
    setFeedURL: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, cb: (info: unknown) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
  };
  return {
    listeners,
    autoUpdater,
    checkForUpdates: autoUpdater.checkForUpdates,
    setFeedURL: autoUpdater.setFeedURL,
    quitAndInstall: autoUpdater.quitAndInstall,
    on: autoUpdater.on,
  };
});

vi.mock("electron-updater", () => ({
  autoUpdater: h.autoUpdater,
}));

import { AutoUpdaterService, feedUrlFor } from "../src/main/updateAutoUpdater";

function fire(event: string, info: unknown): void {
  for (const cb of h.listeners[event] ?? []) cb(info);
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(h.listeners)) delete h.listeners[key];
});

describe("feedUrlFor", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("uses the mac channel on darwin", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    expect(feedUrlFor("https://codechat.example.com")).toBe(
      "https://codechat.example.com/api/downloads/desktop/mac/",
    );
  });

  it("uses the win channel on win32", () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    expect(feedUrlFor("https://codechat.example.com")).toBe(
      "https://codechat.example.com/api/downloads/desktop/win/",
    );
  });

  it("strips trailing slashes from the serverUrl", () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });
    expect(feedUrlFor("https://codechat.example.com///")).toBe(
      "https://codechat.example.com/api/downloads/desktop/mac/",
    );
  });
});

describe("AutoUpdaterService.checkForUpdates", () => {
  it('points the generic provider at the codechat feed and returns "update" for a newer version', async () => {
    vi.mocked(h.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });

    const outcome = await service.checkForUpdates(
      "https://codechat.example.com",
    );

    expect(outcome).toBe("update");
    expect(h.setFeedURL).toHaveBeenCalledWith({
      provider: "generic",
      url: `https://codechat.example.com/api/downloads/desktop/${
        process.platform === "win32" ? "win" : "mac"
      }/`,
    });
    expect(h.checkForUpdates).toHaveBeenCalledTimes(1);
  });
  it('returns "no-update" when the feed version equals the running version', async () => {
    // electron mock app.getVersion() is 0.19.7
    vi.mocked(h.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.19.7", files: [], path: "wave-0.19.7.dmg" },
      isUpdateAvailable: false,
    } as never);
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });

    expect(await service.checkForUpdates("https://codechat.example.com")).toBe(
      "no-update",
    );
  });

  it('returns "error" when the check rejects', async () => {
    vi.mocked(h.checkForUpdates).mockRejectedValue(new Error("ECONNREFUSED"));
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });

    expect(await service.checkForUpdates("https://codechat.example.com")).toBe(
      "error",
    );
  });

  it("enables autoDownload so an update downloads in the background without confirmation", async () => {
    vi.mocked(h.checkForUpdates).mockResolvedValue({
      updateInfo: { version: "0.20.0", files: [], path: "wave-0.20.0.dmg" },
      isUpdateAvailable: true,
    } as never);
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });

    await service.checkForUpdates("https://codechat.example.com");

    expect(h.autoUpdater.autoDownload).toBe(true);
  });
});

describe("AutoUpdaterService events and quitAndInstall", () => {
  it("fires onUpdateAvailable when the update-available event arrives", () => {
    const onUpdateAvailable = vi.fn();
    const service = new AutoUpdaterService({
      onUpdateAvailable,
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });
    service.checkForUpdates("https://codechat.example.com");

    fire("update-available", { version: "0.20.0" });
    expect(onUpdateAvailable).toHaveBeenCalledWith({ version: "0.20.0" });
  });

  it("fires onUpdateDownloaded when the update-downloaded event arrives", () => {
    const onUpdateDownloaded = vi.fn();
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded,
      onError: vi.fn(),
    });
    service.checkForUpdates("https://codechat.example.com");

    fire("update-downloaded", { version: "0.20.0" });
    expect(onUpdateDownloaded).toHaveBeenCalledWith({ version: "0.20.0" });
  });

  it("fires onError when the error event arrives", () => {
    const onError = vi.fn();
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError,
    });
    service.checkForUpdates("https://codechat.example.com");

    fire("error", new Error("download failed"));
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it("registers each event listener only once across repeated checks", async () => {
    vi.mocked(h.checkForUpdates).mockResolvedValue(null);
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });
    await service.checkForUpdates("https://codechat.example.com");
    await service.checkForUpdates("https://codechat.example.com");

    const registered = Object.values(h.listeners);
    expect(registered.length).toBe(3); // update-available + update-downloaded + error
    expect(h.on).toHaveBeenCalledTimes(3);
  });

  it("forwards quitAndInstall with silent + force-run to electron-updater", () => {
    const service = new AutoUpdaterService({
      onUpdateAvailable: vi.fn(),
      onUpdateDownloaded: vi.fn(),
      onError: vi.fn(),
    });
    service.quitAndInstall();
    expect(h.quitAndInstall).toHaveBeenCalledTimes(1);
    // isSilent / isForceRunAfter: /S hides the wizard, --force-run makes the
    // assisted NSIS installer relaunch the app after the silent install.
    expect(h.quitAndInstall).toHaveBeenCalledWith(true, true);
  });
});
