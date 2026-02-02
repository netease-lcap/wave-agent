import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import { ReversionService } from "../../src/services/reversionService.js";
import { FileSnapshot } from "../../src/types/reversion.js";

vi.mock("fs/promises");

describe("ReversionService", () => {
  const sessionPath = "/tmp/session.jsonl";
  const reversionPath = "/tmp/.reversion-session.jsonl";
  let service: ReversionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ReversionService(sessionPath);
  });

  it("should append a snapshot to the file", async () => {
    const snapshot = {
      messageId: "m1",
      filePath: "f1",
      content: "c1",
      timestamp: 1,
      operation: "modify",
    };

    await service.saveSnapshot(snapshot as FileSnapshot);

    expect(fs.appendFile).toHaveBeenCalledWith(
      reversionPath,
      JSON.stringify(snapshot) + "\n",
      "utf-8",
    );
  });

  it("should read snapshots for specific messages", async () => {
    const snapshots = [
      { messageId: "m1", filePath: "f1" },
      { messageId: "m2", filePath: "f2" },
    ];
    vi.mocked(fs.readFile).mockResolvedValue(
      snapshots.map((s) => JSON.stringify(s)).join("\n"),
    );

    const result = await service.getSnapshotsForMessages(["m1"]);

    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe("m1");
  });

  it("should delete snapshots for specific messages", async () => {
    const snapshots = [
      { messageId: "m1", filePath: "f1" },
      { messageId: "m2", filePath: "f2" },
    ];
    vi.mocked(fs.readFile).mockResolvedValue(
      snapshots.map((s) => JSON.stringify(s)).join("\n"),
    );

    await service.deleteSnapshotsForMessages(["m1"]);

    expect(fs.writeFile).toHaveBeenCalledWith(
      reversionPath,
      JSON.stringify(snapshots[1]) + "\n",
      "utf-8",
    );
  });
});
