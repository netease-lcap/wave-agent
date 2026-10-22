import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import { app, dialog } from "electron";
import { c as createTarArchive } from "tar";
import { LOG_DIR } from "../src/main/hostLog.js";
import {
  defaultDiagnosticsPath,
  diagnosticsFileName,
  exportDiagnostics,
} from "../src/main/exportDiagnostics.js";

vi.mock("fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/codewave-diag-test"),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  cpSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
  rmSync: vi.fn(),
}));

vi.mock("tar", () => ({ c: vi.fn(async () => undefined) }));

const fs = await import("fs");

const DUMPS_DIR = path.resolve("/fake/userData/Crashpad");
const STAGE = path.resolve("/tmp/codewave-diag-test");
const DESKTOP = path.resolve("/fake/home/Desktop");
const TARGET = path.join(DESKTOP, "chosen.tar.gz");

const dirent = (name: string, isFile = true) => ({
  name,
  isFile: () => isFile,
});

describe("exportDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(app.getPath).mockImplementation((name: string) => {
      if (name === "crashDumps") return DUMPS_DIR;
      if (name === "desktop") return DESKTOP;
      return "/tmp/wave-desktop-test-userData";
    });
    vi.mocked(fs.mkdtempSync).mockReturnValue(STAGE);
    vi.mocked(fs.readdirSync).mockReturnValue([
      dirent("desktop.log"),
      dirent("cli.log"),
      dirent("notes.txt"),
      dirent("nested", false),
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: false,
      filePath: TARGET,
    } as unknown as Awaited<ReturnType<typeof dialog.showSaveDialog>>);
  });

  it("names the archive with a local timestamp", () => {
    const date = new Date(2026, 9, 22, 15, 30, 12); // month is 0-based

    expect(diagnosticsFileName(date)).toBe(
      "codewave-diagnostics-20261022-153012.tar.gz",
    );
  });

  it("defaults the save dialog to the Desktop", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(defaultDiagnosticsPath(date)).toBe(
      path.join(DESKTOP, "codewave-diagnostics-20260102-030405.tar.gz"),
    );
  });

  it("falls back to the home directory when there is no Desktop path", () => {
    vi.mocked(app.getPath).mockImplementation(() => {
      throw new Error("no desktop");
    });

    expect(defaultDiagnosticsPath(new Date(2026, 0, 2, 3, 4, 5))).toBe(
      path.join(os.homedir(), "codewave-diagnostics-20260102-030405.tar.gz"),
    );
  });

  it("packs the text logs and the minidumps into one archive", async () => {
    const result = await exportDiagnostics();

    expect(result).toBe(TARGET);
    // Only *.log from the logs dir, copied under logs/ in the staging root.
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      path.join(LOG_DIR, "desktop.log"),
      path.join(STAGE, "logs", "desktop.log"),
    );
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      path.join(LOG_DIR, "cli.log"),
      path.join(STAGE, "logs", "cli.log"),
    );
    expect(fs.copyFileSync).not.toHaveBeenCalledWith(
      path.join(LOG_DIR, "notes.txt"),
      expect.anything(),
    );
    // Crashpad dumps ride along — they are the only native stack we will get.
    expect(fs.cpSync).toHaveBeenCalledWith(
      DUMPS_DIR,
      path.join(STAGE, "crash-dumps"),
      { recursive: true },
    );

    const [tarOptions, entries] = vi.mocked(createTarArchive).mock.calls[0] as [
      { gzip?: boolean; file?: string; cwd?: string },
      string[],
    ];
    expect(tarOptions).toMatchObject({
      gzip: true,
      file: TARGET,
      cwd: STAGE,
    });
    expect(entries).toEqual(["logs", "crash-dumps", "manifest.txt"]);

    const manifest = JSON.parse(
      vi
        .mocked(fs.writeFileSync)
        .mock.calls.find(
          ([file]) => file === path.join(STAGE, "manifest.txt"),
        )![1] as string,
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: "0.19.7",
      logsDir: LOG_DIR,
      crashDumpsDir: DUMPS_DIR,
      logFiles: ["cli.log", "desktop.log"],
    });
    // Staging directory is always cleaned up.
    expect(fs.rmSync).toHaveBeenCalledWith(STAGE, {
      recursive: true,
      force: true,
    });
  });

  it("writes nothing when the user cancels the save dialog", async () => {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({
      canceled: true,
      filePath: undefined,
    } as unknown as Awaited<ReturnType<typeof dialog.showSaveDialog>>);

    expect(await exportDiagnostics()).toBeUndefined();
    expect(createTarArchive).not.toHaveBeenCalled();
    expect(fs.mkdtempSync).not.toHaveBeenCalled();
  });

  it("survives a missing crash-dump directory (no crash yet)", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    await exportDiagnostics();

    expect(fs.cpSync).not.toHaveBeenCalled();
    const [, entries] = vi.mocked(createTarArchive).mock.calls[0] as [
      unknown,
      string[],
    ];
    expect(entries).toEqual(["logs", "manifest.txt"]);
  });

  it("cleans the staging directory even when archiving fails", async () => {
    vi.mocked(createTarArchive).mockRejectedValueOnce(
      new Error("EACCES: permission denied"),
    );

    await expect(exportDiagnostics()).rejects.toThrow("EACCES");

    expect(fs.rmSync).toHaveBeenCalledWith(STAGE, {
      recursive: true,
      force: true,
    });
  });
});
