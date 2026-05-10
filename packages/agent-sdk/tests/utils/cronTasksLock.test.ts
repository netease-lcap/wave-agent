import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
  registerSchedulerLockCleanup,
} from "@/utils/cronTasksLock.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("crypto", () => ({
  randomUUID: () => "test-uuid-123",
}));

const MOCK_DIR = "/mock/project";
const WAVE_DIR = `${MOCK_DIR}/.wave`;

import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  unlinkSync,
} from "fs";

function makeEexistError(): Error {
  const err = new Error("file already exists") as Error & { code: string };
  err.code = "EEXIST";
  return err;
}

describe("cronTasksLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("tryAcquireSchedulerLock", () => {
    it("acquires lock when no existing file", async () => {
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        // First call succeeds (no EEXIST)
      });
      vi.mocked(renameSync).mockImplementation(() => {});

      const result = await tryAcquireSchedulerLock({
        dir: MOCK_DIR,
        sessionId: "test-session",
      });

      expect(result).toBe(true);
      expect(mkdirSync).toHaveBeenCalledWith(WAVE_DIR, { recursive: true });
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("returns false when lock held by alive process", async () => {
      const eexist = makeEexistError();
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw eexist;
      });

      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          sessionId: "other",
          pid: process.pid,
          acquiredAt: Date.now(),
        }),
      );

      const result = await tryAcquireSchedulerLock({
        dir: MOCK_DIR,
        sessionId: "test-session",
      });

      expect(result).toBe(false);
    });

    it("acquires lock after stale recovery", async () => {
      // First call fails with EEXIST
      const eexist = makeEexistError();
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw eexist;
      });

      // Lock has dead PID
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          sessionId: "dead-session",
          pid: 999999,
          acquiredAt: Date.now() - 100000,
        }),
      );

      // process.kill should fail (PID dead)
      vi.spyOn(process, "kill").mockImplementationOnce(() => {
        throw new Error("ESRCH");
      });

      // Second write succeeds
      vi.mocked(writeFileSync).mockImplementationOnce(() => {});
      vi.mocked(renameSync).mockImplementation(() => {});

      const result = await tryAcquireSchedulerLock({
        dir: MOCK_DIR,
        sessionId: "test-session",
      });

      expect(result).toBe(true);
      expect(unlinkSync).toHaveBeenCalled(); // stale lock removed

      // Restore
      vi.mocked(process.kill).mockRestore();
    });

    it("returns false on non-EEXIST error", async () => {
      const err = new Error("permission denied") as Error & { code: string };
      err.code = "EACCES";
      vi.mocked(writeFileSync).mockImplementationOnce(() => {
        throw err;
      });

      const result = await tryAcquireSchedulerLock({
        dir: MOCK_DIR,
        sessionId: "test-session",
      });

      expect(result).toBe(false);
    });

    it("uses defaults when options not provided", async () => {
      vi.mocked(writeFileSync).mockImplementationOnce(() => {});
      vi.mocked(renameSync).mockImplementation(() => {});

      const result = await tryAcquireSchedulerLock();

      expect(result).toBe(true);
    });
  });

  describe("releaseSchedulerLock", () => {
    it("releases lock when process is owner", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          sessionId: "test",
          pid: process.pid,
          acquiredAt: Date.now(),
        }),
      );

      await releaseSchedulerLock({ dir: MOCK_DIR, sessionId: "test" });

      expect(unlinkSync).toHaveBeenCalled();
    });

    it("does nothing when process is not owner", async () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          sessionId: "other",
          pid: 12345,
          acquiredAt: Date.now(),
        }),
      );

      await releaseSchedulerLock({ dir: MOCK_DIR, sessionId: "test" });

      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it("does nothing when lock file does not exist", async () => {
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      await releaseSchedulerLock({ dir: MOCK_DIR, sessionId: "test" });

      expect(unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe("registerSchedulerLockCleanup", () => {
    afterEach(() => {
      // Clean up any registered process listeners to prevent MaxListenersExceededWarning
      vi.restoreAllMocks();
    });

    it("registers exit handlers", () => {
      const onSpy = vi.spyOn(process, "on");
      const offSpy = vi.spyOn(process, "off");

      const dispose = registerSchedulerLockCleanup({
        dir: MOCK_DIR,
        sessionId: "test",
      });

      expect(onSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

      // Dispose removes the handlers
      dispose();

      expect(offSpy).toHaveBeenCalledWith("exit", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
      expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    });
  });
});
