import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("fs", () => ({
  promises: {
    writeFile: vi.fn(),
    rename: vi.fn(),
    unlink: vi.fn(),
  },
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { promises as fsp, writeFileSync, renameSync, unlinkSync } from "fs";
import { atomicWriteFile, atomicWriteFileSync } from "@/utils/atomicWrite.js";

/**
 * Temp-file-then-rename write. The contract that matters for the memory /
 * fs-tool write paths: the target path is only ever produced by a `rename`, and
 * a failure in either step leaves no temp file behind.
 */
describe("atomicWrite", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsp.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsp.rename).mockResolvedValue(undefined);
    vi.mocked(fsp.unlink).mockResolvedValue(undefined);
  });

  describe("atomicWriteFile", () => {
    it("writes a temp file then renames it onto the target", async () => {
      await atomicWriteFile("/dir/file.txt", "content");

      expect(fsp.writeFile).toHaveBeenCalledTimes(1);
      const [tmpPath, data, encoding] = vi.mocked(fsp.writeFile).mock.calls[0];
      expect(data).toBe("content");
      expect(encoding).toBe("utf-8");
      // Same directory as the target, so rename stays on one filesystem.
      expect(tmpPath).toMatch(/^\/dir\/file\.txt\.tmp\.\d+\.[0-9a-f-]{36}$/);

      expect(fsp.rename).toHaveBeenCalledWith(tmpPath, "/dir/file.txt");
      expect(fsp.unlink).not.toHaveBeenCalled();
    });

    it("never writes the target path directly", async () => {
      await atomicWriteFile("/dir/file.txt", "content");

      const writtenPaths = vi
        .mocked(fsp.writeFile)
        .mock.calls.map((call) => call[0]);
      expect(writtenPaths).not.toContain("/dir/file.txt");
    });

    it("uses a distinct temp path per call", async () => {
      await atomicWriteFile("/dir/file.txt", "a");
      await atomicWriteFile("/dir/file.txt", "b");

      const [first, second] = vi
        .mocked(fsp.writeFile)
        .mock.calls.map((call) => call[0]);
      expect(first).not.toBe(second);
    });

    it("removes the temp file and rethrows when the write fails", async () => {
      const failure = new Error("ENOSPC");
      vi.mocked(fsp.writeFile).mockRejectedValue(failure);

      await expect(atomicWriteFile("/dir/file.txt", "content")).rejects.toThrow(
        "ENOSPC",
      );

      const tmpPath = vi.mocked(fsp.writeFile).mock.calls[0][0];
      expect(fsp.unlink).toHaveBeenCalledWith(tmpPath);
      // The target is never touched, so no half-written file is observable.
      expect(fsp.rename).not.toHaveBeenCalled();
    });

    it("removes the temp file and rethrows when the rename fails", async () => {
      const failure = new Error("EXDEV");
      vi.mocked(fsp.rename).mockRejectedValue(failure);

      await expect(atomicWriteFile("/dir/file.txt", "content")).rejects.toThrow(
        "EXDEV",
      );

      const tmpPath = vi.mocked(fsp.writeFile).mock.calls[0][0];
      expect(fsp.unlink).toHaveBeenCalledWith(tmpPath);
    });

    it("rethrows the original error even when cleanup also fails", async () => {
      vi.mocked(fsp.writeFile).mockRejectedValue(new Error("ENOSPC"));
      vi.mocked(fsp.unlink).mockRejectedValue(new Error("ENOENT"));

      await expect(atomicWriteFile("/dir/file.txt", "content")).rejects.toThrow(
        "ENOSPC",
      );
    });
  });

  describe("atomicWriteFileSync", () => {
    it("writes a temp file then renames it onto the target", () => {
      atomicWriteFileSync("/dir/file.txt", "content");

      const [tmpPath, data, encoding] = vi.mocked(writeFileSync).mock.calls[0];
      expect(data).toBe("content");
      expect(encoding).toBe("utf-8");
      expect(renameSync).toHaveBeenCalledWith(tmpPath, "/dir/file.txt");
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it("removes the temp file and rethrows when the write fails", () => {
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error("ENOSPC");
      });

      expect(() => atomicWriteFileSync("/dir/file.txt", "content")).toThrow(
        "ENOSPC",
      );

      const tmpPath = vi.mocked(writeFileSync).mock.calls[0][0];
      expect(unlinkSync).toHaveBeenCalledWith(tmpPath);
      expect(renameSync).not.toHaveBeenCalled();
    });
  });
});
