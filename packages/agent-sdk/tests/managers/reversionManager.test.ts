import { Mocked } from "vitest";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import { ReversionManager } from "../../src/managers/reversionManager.js";
import { ReversionService } from "../../src/services/reversionService.js";

vi.mock("fs/promises");
vi.mock("../../src/services/reversionService.js");

describe("ReversionManager", () => {
  let reversionManager: ReversionManager;
  let mockReversionService: Mocked<ReversionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReversionService = {
      saveSnapshot: vi.fn(),
      readSnapshotContent: vi.fn(),
      deleteSessionHistory: vi.fn(),
    } as unknown as Mocked<ReversionService>;
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

    vi.mocked(mockReversionService.saveSnapshot).mockResolvedValue(
      "/snapshot/path",
    );
    await reversionManager.commitSnapshot(snapshotId);

    expect(mockReversionService.saveSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg1",
        filePath: "/path/to/file",
        content: "old content",
      }),
    );
    const committed = reversionManager.getAndClearCommittedSnapshots();
    expect(committed[0].snapshotPath).toBe("/snapshot/path");
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
        snapshotPath: "/snap1",
        timestamp: 100,
        operation: "modify",
      },
      {
        messageId: "msg2",
        filePath: "/file1",
        snapshotPath: "/snap2",
        timestamp: 200,
        operation: "modify",
      },
    ];

    const messages = [
      {
        id: "msg1",
        blocks: [{ type: "file_history", snapshots: [snapshots[0]] }],
      },
      {
        id: "msg2",
        blocks: [{ type: "file_history", snapshots: [snapshots[1]] }],
      },
    ];

    vi.mocked(mockReversionService.readSnapshotContent).mockImplementation(
      async (path) => {
        if (path === "/snap1") return "v1";
        if (path === "/snap2") return "v2";
        return null;
      },
    );

    const count = await reversionManager.revertTo(
      ["msg1", "msg2"],
      messages as unknown as import("../../src/types/index.js").Message[],
    );

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
  });

  it("should delete files that did not exist before", async () => {
    const snapshots = [
      {
        messageId: "msg1",
        filePath: "/newfile",
        snapshotPath: undefined,
        timestamp: 100,
        operation: "create",
      },
    ];

    const messages = [
      {
        id: "msg1",
        blocks: [{ type: "file_history", snapshots: [snapshots[0]] }],
      },
    ];

    await reversionManager.revertTo(
      ["msg1"],
      messages as unknown as import("../../src/types/index.js").Message[],
    );

    expect(fs.rm).toHaveBeenCalledWith("/newfile", { force: true });
  });
});
