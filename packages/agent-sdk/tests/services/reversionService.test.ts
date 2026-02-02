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

    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT")); // No versions file

    const snapshotPath = await service.saveSnapshot(
      snapshot as unknown as import("../../src/types/reversion.js").FileSnapshot,
    );

    expect(snapshotPath).toContain("v1");
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining("v1"),
      "c1",
      "utf-8",
    );
    expect(fs.appendFile).toHaveBeenCalledWith(
      expect.stringContaining("versions"),
      "1\n",
      "utf-8",
    );
  });

  it("should read snapshot content", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("snapshot content");

    const result = await service.readSnapshotContent("/some/path/v1");

    expect(result).toBe("snapshot content");
    expect(fs.readFile).toHaveBeenCalledWith("/some/path/v1", "utf-8");
  });

  it("should delete session history", async () => {
    await service.deleteSessionHistory();

    expect(fs.rm).toHaveBeenCalledWith(historyBaseDir, {
      recursive: true,
      force: true,
    });
  });
});
