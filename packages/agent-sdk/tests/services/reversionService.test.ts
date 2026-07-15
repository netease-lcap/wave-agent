import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import { ReversionService } from "../../src/services/reversionService.js";
import { join } from "path";
import { homedir } from "os";

vi.mock("fs/promises");

describe("ReversionService", () => {
  const sessionId = "test-session";
  const historyBaseDir = join(homedir(), ".wave", "file-history", sessionId);
  let service: ReversionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReversionService(sessionId);
  });

  it("should save a snapshot to the file history directory", async () => {
    const snapshot = {
      messageId: "m1",
      filePath: "/path/to/f1",
      content: "c1",
      timestamp: 1,
      operation: "modify",
    };

    vi.mocked(fs.readdir).mockResolvedValue([]);

    const snapshotPath = await service.saveSnapshot(
      snapshot as unknown as import("../../src/types/reversion.js").FileSnapshot,
    );

    expect(snapshotPath).toContain("@v1");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("@v1"),
      "c1",
      "utf-8",
    );
  });

  it("should compute next version by scanning existing files", async () => {
    const snapshot = {
      messageId: "m1",
      filePath: "/path/to/f1",
      content: "c1",
      timestamp: 1,
      operation: "modify",
    };

    // Simulate an existing v3 snapshot for the same file
    const hash = service["getFilePathHash"]("/path/to/f1");
    const existingFiles = [`${hash}@v1`, `${hash}@v3`, "other@v2"];
    vi.mocked(fs.readdir).mockResolvedValue(
      existingFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>,
    );

    const snapshotPath = await service.saveSnapshot(
      snapshot as unknown as import("../../src/types/reversion.js").FileSnapshot,
    );

    expect(snapshotPath).toContain("@v4");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("@v4"),
      "c1",
      "utf-8",
    );
  });

  it("should return empty string for create operation", async () => {
    const snapshot = {
      messageId: "m1",
      filePath: "/path/to/newfile",
      content: null,
      timestamp: 1,
      operation: "create",
    };

    vi.mocked(fs.readdir).mockResolvedValue([]);

    const snapshotPath = await service.saveSnapshot(
      snapshot as unknown as import("../../src/types/reversion.js").FileSnapshot,
    );

    expect(snapshotPath).toBe("");
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it("should read snapshot content", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("snapshot content");

    const result = await service.readSnapshotContent("/some/path/hash@v1");

    expect(result).toBe("snapshot content");
    expect(fs.readFile).toHaveBeenCalledWith("/some/path/hash@v1", "utf-8");
  });

  it("should return null when snapshot file does not exist", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    const result = await service.readSnapshotContent("/some/path/missing");

    expect(result).toBeNull();
  });

  it("should delete session history", async () => {
    await service.deleteSessionHistory();

    expect(fs.rm).toHaveBeenCalledWith(historyBaseDir, {
      recursive: true,
      force: true,
    });
  });

  it("should cleanup old sessions and skip current session", async () => {
    const oldTime = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const recentTime = Date.now() - 1 * 24 * 60 * 60 * 1000;

    vi.mocked(fs.readdir).mockResolvedValue([
      "test-session",
      "old-session",
      "recent-session",
    ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

    vi.mocked(fs.stat).mockImplementation(async (path) => {
      const p = path as unknown as string;
      if (p.includes("old-session")) {
        return {
          isDirectory: () => true,
          mtimeMs: oldTime,
        } as unknown as Awaited<ReturnType<typeof fs.stat>>;
      }
      if (p.includes("recent-session")) {
        return {
          isDirectory: () => true,
          mtimeMs: recentTime,
        } as unknown as Awaited<ReturnType<typeof fs.stat>>;
      }
      return {
        isDirectory: () => true,
        mtimeMs: Date.now(),
      } as unknown as Awaited<ReturnType<typeof fs.stat>>;
    });

    await service.cleanupOldSessions(30);

    // old-session should be deleted
    expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining("old-session"), {
      recursive: true,
      force: true,
    });
    // recent-session should NOT be deleted
    expect(fs.rm).not.toHaveBeenCalledWith(
      expect.stringContaining("recent-session"),
      { recursive: true, force: true },
    );
    // current session should NOT be deleted
    expect(fs.rm).not.toHaveBeenCalledWith(
      expect.stringContaining("test-session"),
      { recursive: true, force: true },
    );
  });

  it("should handle missing parent directory gracefully", async () => {
    vi.mocked(fs.readdir).mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );

    await service.cleanupOldSessions(30);

    expect(fs.rm).not.toHaveBeenCalled();
  });
});
