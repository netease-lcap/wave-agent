import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  TEMP_DIR_ENV,
  resolveTempDir,
  probeTempDir,
  resetTempDirProbeCache,
  readDiskPressure,
  describeTempDirFailure,
  describeDiskPressure,
} from "../../src/utils/tempDir.js";

const baseTestDir = path.join(os.tmpdir(), `wave-tempdir-test-${randomUUID()}`);
const writableDir = path.join(baseTestDir, "writable");
const fileNotDir = path.join(baseTestDir, "not-a-dir");

describe("tempDir", () => {
  beforeEach(() => {
    resetTempDirProbeCache();
    fs.mkdirSync(writableDir, { recursive: true });
    fs.writeFileSync(fileNotDir, "");
    delete process.env[TEMP_DIR_ENV];
  });

  afterEach(() => {
    delete process.env[TEMP_DIR_ENV];
    fs.rmSync(baseTestDir, { recursive: true, force: true });
  });

  describe("resolveTempDir", () => {
    it("falls back to the OS temp dir", () => {
      expect(resolveTempDir()).toBe(os.tmpdir());
    });

    it("prefers the override variable", () => {
      process.env[TEMP_DIR_ENV] = writableDir;
      expect(resolveTempDir()).toBe(writableDir);
    });

    it("ignores a blank override", () => {
      process.env[TEMP_DIR_ENV] = "   ";
      expect(resolveTempDir()).toBe(os.tmpdir());
    });
  });

  describe("probeTempDir", () => {
    it("reports a writable directory and leaves no probe file behind", () => {
      expect(probeTempDir(writableDir)).toEqual({ writable: true });
      expect(fs.readdirSync(writableDir)).toEqual([]);
    });

    it("caches the yes answer", () => {
      expect(probeTempDir(writableDir)).toEqual({ writable: true });
      // The directory is gone now — a fresh probe would have to recreate it,
      // and the cached answer short-circuits before that.
      fs.rmSync(writableDir, { recursive: true, force: true });
      expect(probeTempDir(writableDir)).toEqual({ writable: true });
      expect(fs.existsSync(writableDir)).toBe(false);
    });

    it("reports the errno when the directory cannot be created", () => {
      // A regular file in the way makes mkdir fail with ENOTDIR — the same
      // shape as a volume refusing new directories.
      const result = probeTempDir(path.join(fileNotDir, "child"));
      expect(result.writable).toBe(false);
      expect(result.code).toBe("ENOTDIR");
    });

    it("does not cache a failure", () => {
      const blocked = path.join(fileNotDir, "child");
      expect(probeTempDir(blocked).writable).toBe(false);
      fs.unlinkSync(fileNotDir);
      fs.mkdirSync(fileNotDir, { recursive: true });
      expect(probeTempDir(blocked)).toEqual({ writable: true });
    });
  });

  describe("readDiskPressure", () => {
    it("reads free space and inodes for an existing directory", () => {
      const pressure = readDiskPressure(writableDir);
      expect(pressure.freeBytes).toBeGreaterThanOrEqual(0);
      if (process.platform === "win32") {
        // NTFS keeps no inode table, so statfs reports ffree as 0 — treat that
        // as unknown, not as "none left", or every failed command gets a bogus
        // inode warning attached.
        expect(pressure.freeInodes).toBeUndefined();
      } else {
        expect(pressure.freeInodes).toBeGreaterThan(0);
      }
    });

    it("returns nothing when the path cannot be stat'ed", () => {
      expect(readDiskPressure(path.join(baseTestDir, "missing"))).toEqual({});
    });
  });

  describe("describeTempDirFailure", () => {
    it("names the directory, the errno and the way out", () => {
      const text = describeTempDirFailure("/scratch/tmp", "EDQUOT");
      expect(text).toContain("/scratch/tmp");
      expect(text).toContain("EDQUOT");
      expect(text).toContain("disk quota");
      expect(text).toContain(`${TEMP_DIR_ENV}=/var/tmp/wave`);
    });

    it("explains a permission failure", () => {
      expect(describeTempDirFailure("/scratch/tmp", "EACCES")).toContain(
        "permission denied",
      );
    });
  });

  describe("describeDiskPressure", () => {
    it("warns about a nearly full volume", () => {
      const text = describeDiskPressure("/scratch/tmp", {
        freeBytes: 2 * 1024 * 1024,
      });
      expect(text).toContain("Disk nearly full");
      expect(text).toContain("2 MB free");
    });

    it("warns about running out of inodes", () => {
      const text = describeDiskPressure("/scratch/tmp", {
        freeBytes: 10 * 1024 * 1024 * 1024,
        freeInodes: 12,
      });
      expect(text).toContain("Nearly out of inodes");
      expect(text).toContain("12");
    });

    it("says nothing when there is room", () => {
      expect(
        describeDiskPressure("/scratch/tmp", {
          freeBytes: 5 * 1024 * 1024 * 1024,
          freeInodes: 100_000,
        }),
      ).toBeUndefined();
    });
  });
});
