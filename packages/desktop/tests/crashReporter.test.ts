import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import { app, crashReporter } from "electron";
import { hostLog, LOG_DIR } from "../src/main/hostLog.js";
import { startLocalCrashReporter } from "../src/main/crashReporter.js";

const DUMPS_DIR = path.resolve("/fake/userData/Crashpad");

describe("startLocalCrashReporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === "crashDumps" ? DUMPS_DIR : "/tmp/wave-desktop-test-userData",
    );
  });

  it("collects minidumps locally and never uploads them", () => {
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});

    startLocalCrashReporter();

    // The whole point: a dump on disk, no submitURL, no upload.
    expect(crashReporter.start).toHaveBeenCalledWith({
      uploadToServer: false,
      compress: true,
    });
    // Startup line names both real paths so support can ask for the files.
    expect(info).toHaveBeenCalledWith(
      `[desktop] crash evidence dirs dumps=${DUMPS_DIR} logs=${LOG_DIR}`,
    );
    info.mockRestore();
  });

  it("reports a dump left by a previous run (crash, not force-quit)", () => {
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});
    const warn = vi.spyOn(hostLog, "warn").mockImplementation(() => {});
    const date = new Date("2026-10-20T08:09:10.000Z");
    vi.mocked(crashReporter.getLastCrashReport).mockReturnValue({
      id: "abc-123",
      date,
    });

    startLocalCrashReporter();

    expect(warn).toHaveBeenCalledWith(
      `[desktop] previous run left a crash dump id=abc-123 date=${date.toISOString()} dir=${DUMPS_DIR}`,
    );
    info.mockRestore();
    warn.mockRestore();
  });

  it("says so when the previous run was clean", () => {
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});
    vi.mocked(crashReporter.getLastCrashReport).mockReturnValue(null);

    startLocalCrashReporter();

    expect(info).toHaveBeenCalledWith(
      "[desktop] no crash dump from a previous run",
    );
    info.mockRestore();
  });

  it("does not fail startup when the crash report cannot be read", () => {
    const warn = vi.spyOn(hostLog, "warn").mockImplementation(() => {});
    vi.mocked(crashReporter.getLastCrashReport).mockImplementation(() => {
      throw new Error("crashpad unavailable");
    });

    expect(() => startLocalCrashReporter()).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[desktop] failed to read last crash report:",
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
