import { Mocked } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import { ReversionService } from "../../src/services/reversionService.js";
import { FileSnapshot } from "../../src/types/reversion.js";

vi.mock("fs/promises");
vi.mock("../../src/services/reversionService.js");

describe("ReversionManager", () => {
  let reversionManager: ReversionManager;
  let mockReversionService: Mocked<ReversionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReversionService = new ReversionService(
      "test.jsonl",
    ) as Mocked<ReversionService>;
    reversionManager = new ReversionManager(mockReversionService);
  });

  it("should record a snapshot and return a snapshotId", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("old content");

    const snapshotId = await reversionManager.recordSnapshot(
      "msg1",
      "/path/to/file",
      "modify",
    );

    expect(snapshotId).toContain("msg1-/path/to/file");
    expect(fs.readFile).toHaveBeenCalledWith("/path/to/file", "utf-8");
  });

  it("should commit a snapshot to the service", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("old content");
    const snapshotId = await reversionManager.recordSnapshot(
      "msg1",
      "/path/to/file",
      "modify",
    );

    await reversionManager.commitSnapshot(snapshotId);

    expect(mockReversionService.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg1",
        filePath: "/path/to/file",
        content: "old content",
      }),
    );
  });

  it("should discard a snapshot from the buffer", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("old content");
    const snapshotId = await reversionManager.recordSnapshot(
      "msg1",
      "/path/to/file",
      "modify",
    );

    reversionManager.discardSnapshot(snapshotId);
    await reversionManager.commitSnapshot(snapshotId);

    expect(mockReversionService.saveSnapshot).not.toHaveBeenCalled();
  });

  it("should revert files in reverse chronological order", async () => {
    const snapshots = [
      {
        messageId: "msg1",
        filePath: "/file1",
        content: "v1",
        timestamp: 100,
        operation: "modify",
      },
      {
        messageId: "msg2",
        filePath: "/file1",
        content: "v2",
        timestamp: 200,
        operation: "modify",
      },
    ];

    mockReversionService.getSnapshotsForMessages.mockResolvedValue(
      snapshots as FileSnapshot[],
    );

    const count = await reversionManager.revertTo(["msg1", "msg2"]);

    expect(count).toBe(2);
    // Should write v2 (latest) then v1 (earliest)
    expect(vi.mocked(fs.writeFile).mock.calls[0]).toEqual([
      "/file1",
      "v2",
      "utf-8",
    ]);
    expect(vi.mocked(fs.writeFile).mock.calls[1]).toEqual([
      "/file1",
      "v1",
      "utf-8",
    ]);
    expect(
      mockReversionService.deleteSnapshotsForMessages,
    ).toHaveBeenCalledWith(["msg1", "msg2"]);
  });

  it("should delete files that did not exist before", async () => {
    const snapshots = [
      {
        messageId: "msg1",
        filePath: "/newfile",
        content: null,
        timestamp: 100,
        operation: "create",
      },
    ];

    mockReversionService.getSnapshotsForMessages.mockResolvedValue(
      snapshots as FileSnapshot[],
    );

    await reversionManager.revertTo(["msg1"]);

    expect(fs.rm).toHaveBeenCalledWith("/newfile", { force: true });
  });
});
