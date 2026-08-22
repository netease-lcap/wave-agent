import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync, promises as fs } from "fs";
import { join } from "path";
import {
  DEFAULT_CLEANUP_PERIOD_DAYS,
  cleanupOldSessionFiles,
  resolveCleanupPeriodDays,
  runSessionCleanupInBackground,
} from "../../src/utils/sessionCleanup.js";
import { SESSION_DIR } from "../../src/services/session.js";
import { loadMergedWaveConfig } from "../../src/services/configurationService.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  promises: {
    readdir: vi.fn(),
    stat: vi.fn(),
    unlink: vi.fn(),
    rmdir: vi.fn(),
  },
}));

vi.mock(
  "../../src/services/configurationService.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../src/services/configurationService.js")
      >();
    return {
      ...actual,
      loadMergedWaveConfig: vi.fn(),
    };
  },
);

vi.mock("../../src/utils/configPaths.js", () => ({
  getUserConfigPaths: vi.fn(() => ["/mock/user/settings.json"]),
  getProjectConfigPaths: vi.fn(() => [
    "/mock/project/settings.local.json",
    "/mock/project/settings.json",
  ]),
}));

// Dirent-shaped stand-in for fs.readdir withFileTypes results
function dirent(
  name: string,
  isFile: boolean,
): Awaited<ReturnType<typeof fs.readdir>>[number] {
  return {
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
  } as unknown as Awaited<ReturnType<typeof fs.readdir>>[number];
}

const daysAgo = (days: number): Date =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000);

describe("cleanupOldSessionFiles", () => {
  beforeEach(() => {
    vi.mocked(loadMergedWaveConfig).mockReset();
    vi.mocked(fs.readdir).mockReset();
    vi.mocked(fs.stat).mockReset();
    vi.mocked(fs.unlink).mockReset();
    vi.mocked(fs.rmdir).mockReset();
  });

  it("deletes expired jsonl files (main + subagent) and keeps fresh ones", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("project1", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("abc.jsonl", true),
      dirent("subagent-def.jsonl", true),
      dirent("fresh.jsonl", true),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.stat).mockImplementation(async (filePath) => {
      const age = String(filePath).includes("fresh") ? 1 : 40;
      return { mtime: daysAgo(age) } as Awaited<ReturnType<typeof fs.stat>>;
    });

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 2, errors: 0 });
    expect(fs.unlink).toHaveBeenCalledWith(
      join(SESSION_DIR, "project1", "abc.jsonl"),
    );
    expect(fs.unlink).toHaveBeenCalledWith(
      join(SESSION_DIR, "project1", "subagent-def.jsonl"),
    );
    expect(fs.unlink).not.toHaveBeenCalledWith(
      join(SESSION_DIR, "project1", "fresh.jsonl"),
    );
  });

  it("preserves memory/ subdirectories and never touches their contents", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("project1", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("old.jsonl", true),
      dirent("memory", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: daysAgo(40),
    } as Awaited<ReturnType<typeof fs.stat>>);
    // Project dir still holds memory/ → rmdir fails, swallowed silently
    vi.mocked(fs.rmdir).mockRejectedValueOnce(
      Object.assign(new Error("ENOTEMPTY"), { code: "ENOTEMPTY" }),
    );

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 1, errors: 0 });
    expect(fs.unlink).toHaveBeenCalledTimes(1);
    expect(fs.rmdir).toHaveBeenCalledWith(join(SESSION_DIR, "project1"));
  });

  it("removes project directories left empty after cleanup", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("empty1", false),
      dirent("empty2", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);
    vi.mocked(fs.readdir).mockResolvedValueOnce([]);

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 0, errors: 0 });
    expect(fs.rmdir).toHaveBeenCalledWith(join(SESSION_DIR, "empty1"));
    expect(fs.rmdir).toHaveBeenCalledWith(join(SESSION_DIR, "empty2"));
  });

  it("silently no-ops when the projects dir does not exist", async () => {
    vi.mocked(fs.readdir).mockRejectedValueOnce(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 0, errors: 0 });
    expect(fs.unlink).not.toHaveBeenCalled();
    expect(fs.rmdir).not.toHaveBeenCalled();
  });

  it("counts errors for unreadable project dirs", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("broken", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readdir).mockRejectedValueOnce(new Error("EACCES"));

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 0, errors: 1 });
  });

  it("counts errors when stat fails on a session file", async () => {
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("project1", false),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      dirent("abc.jsonl", true),
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT"));

    const result = await cleanupOldSessionFiles(30);

    expect(result).toEqual({ deleted: 0, errors: 1 });
  });
});

describe("resolveCleanupPeriodDays", () => {
  beforeEach(() => {
    vi.mocked(loadMergedWaveConfig).mockReset();
    vi.mocked(existsSync).mockReset();
  });

  it("returns the default 30 days when no settings files exist", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
    vi.mocked(existsSync).mockReturnValue(false);

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBe(
      DEFAULT_CLEANUP_PERIOD_DAYS,
    );
  });

  it("returns the configured cleanupPeriodDays", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue({ cleanupPeriodDays: 60 });

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBe(60);
  });

  it("returns 0 when cleanupPeriodDays is 0 (cleanup disabled)", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue({ cleanupPeriodDays: 0 });

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBe(0);
  });

  it("returns null (skip) when settings exist but cannot be parsed", () => {
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
    vi.mocked(existsSync).mockReturnValue(true);

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBeNull();
  });

  it("returns null (skip) when validation fails and cleanupPeriodDays was set", () => {
    // Negative value is invalid → validation errors + explicit key → guard
    vi.mocked(loadMergedWaveConfig).mockReturnValue({ cleanupPeriodDays: -5 });

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBeNull();
  });

  it("returns the default when validation fails but cleanupPeriodDays was not set", () => {
    // autoMemoryFrequency must be positive → validation errors, no explicit key
    vi.mocked(loadMergedWaveConfig).mockReturnValue({
      autoMemoryFrequency: -1,
    });

    expect(resolveCleanupPeriodDays("/mock/workdir")).toBe(
      DEFAULT_CLEANUP_PERIOD_DAYS,
    );
  });
});

describe("runSessionCleanupInBackground", () => {
  beforeEach(() => {
    vi.mocked(loadMergedWaveConfig).mockReset();
    vi.mocked(fs.readdir).mockReset();
  });

  it("is a no-op in test environment", () => {
    runSessionCleanupInBackground("/mock/workdir");

    expect(loadMergedWaveConfig).not.toHaveBeenCalled();
  });

  it("runs cleanup at most once per process", async () => {
    const oldEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    vi.mocked(loadMergedWaveConfig).mockReturnValue(null);
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(fs.readdir).mockResolvedValue(
      [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );

    try {
      runSessionCleanupInBackground("/mock/workdir");
      runSessionCleanupInBackground("/mock/other");

      await vi.waitFor(() => {
        expect(loadMergedWaveConfig).toHaveBeenCalledTimes(1);
      });
    } finally {
      process.env.NODE_ENV = oldEnv;
    }
  });
});
