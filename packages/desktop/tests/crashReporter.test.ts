import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import { app, crashReporter } from "electron";
import { hostLog, LOG_DIR } from "../src/main/hostLog.js";
import { startLocalCrashReporter } from "../src/main/crashReporter.js";

const DUMPS_DIR = path.resolve("/fake/userData/Crashpad");
const COMPLETED_DIR = path.join(DUMPS_DIR, "completed");

// Only the dump-directory scan is mocked; everything else in `fs` (hostLog's
// own writes) stays real.
const mockFs = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { default: { ...actual, ...mockFs }, ...actual, ...mockFs };
});

/** A directory entry as `readdirSync(..., { withFileTypes: true })` yields it. */
function dirent(name: string) {
  return { name, isFile: () => true } as unknown as Awaited<
    ReturnType<typeof import("fs").readdirSync>
  >[number];
}

/** `statSync(...).mtime` for a dump file at `iso`. */
function statWith(iso: string) {
  return { mtime: new Date(iso) } as unknown as Awaited<
    ReturnType<typeof import("fs").statSync>
  >;
}

describe("startLocalCrashReporter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockImplementation((name: string) =>
      name === "crashDumps" ? DUMPS_DIR : "/tmp/wave-desktop-test-userData",
    );
    // Default: Crashpad has written no dump files.
    mockFs.readdirSync.mockReturnValue([]);
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

  it("does not report a metadata-less stub as a crash when no file backs it", () => {
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});
    const warn = vi.spyOn(hostLog, "warn").mockImplementation(() => {});
    // What Crashpad left behind on 2026-10-30 (13 startups): id empty, date 0.
    vi.mocked(crashReporter.getLastCrashReport).mockReturnValue({
      id: "",
      date: 0,
    });

    startLocalCrashReporter();

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[desktop] no crash dump from a previous run",
    );
    info.mockRestore();
    warn.mockRestore();
  });

  it("names the dump files when the report metadata cannot be read", () => {
    const warn = vi.spyOn(hostLog, "warn").mockImplementation(() => {});
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});
    vi.mocked(crashReporter.getLastCrashReport).mockReturnValue({
      id: "",
      date: 0,
    });
    mockFs.readdirSync.mockReturnValue([
      dirent("old.dmp"),
      dirent("notes.txt"), // not a dump — must not be counted
      dirent("new.dmp"),
    ]);
    mockFs.statSync.mockImplementation((p: string) =>
      p === path.join(COMPLETED_DIR, "old.dmp")
        ? statWith("2026-10-30T04:00:00.000Z")
        : statWith("2026-10-30T04:20:00.000Z"),
    );

    startLocalCrashReporter();

    // No id/date to print — the latest file and its mtime are the evidence.
    expect(warn).toHaveBeenCalledWith(
      `[desktop] previous run left 2 crash dump file(s) dir=${DUMPS_DIR} latest=new.dmp mtime=2026-10-30T04:20:00.000Z`,
    );
    info.mockRestore();
    warn.mockRestore();
  });

  it("treats an unreadable dump directory as a clean previous run", () => {
    const info = vi.spyOn(hostLog, "info").mockImplementation(() => {});
    const warn = vi.spyOn(hostLog, "warn").mockImplementation(() => {});
    vi.mocked(crashReporter.getLastCrashReport).mockReturnValue(null);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    startLocalCrashReporter();

    expect(warn).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "[desktop] no crash dump from a previous run",
    );
    info.mockRestore();
    warn.mockRestore();
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
