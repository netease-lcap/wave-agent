import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "child_process";

vi.mock("child_process", () => ({ spawn: vi.fn() }));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
  clearGlobalLogger: vi.fn(),
  isLoggerConfigured: vi.fn(),
}));

import { spawn } from "child_process";
import { killProcessTree } from "../../src/utils/killProcessTree.js";
import { logger } from "../../src/utils/globalLogger.js";

const mockSpawn = vi.mocked(spawn);
const REAL_PLATFORM = process.platform;

/** `process.platform` is a configurable own property — stub it per test. */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

interface FakeTaskkill extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
}

/**
 * A taskkill stand-in: emits its streams and a close code on the next tick
 * (after the utility has attached its listeners).
 */
function fakeTaskkill(options: {
  code: number | null;
  stderr?: Buffer;
  stdout?: Buffer;
  error?: Error;
}): FakeTaskkill {
  const child = new EventEmitter() as FakeTaskkill;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  process.nextTick(() => {
    if (options.error) {
      child.emit("error", options.error);
      return;
    }
    if (options.stdout) child.stdout.emit("data", options.stdout);
    if (options.stderr) child.stderr.emit("data", options.stderr);
    child.emit("close", options.code);
  });

  return child;
}

/** GBK bytes for `错误` — what taskkill actually writes on zh-CN Windows. */
const GBK_ERROR_PREFIX = Buffer.from([0xb4, 0xed, 0xce, 0xf3]);

describe("killProcessTree", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    killSpy = vi
      .spyOn(process, "kill")
      .mockImplementation((() => true) as never);
  });

  afterEach(() => {
    killSpy.mockRestore();
    setPlatform(REAL_PLATFORM);
  });

  describe("POSIX", () => {
    beforeEach(() => {
      setPlatform("linux");
    });

    it("kills the process group (negative pid) with the requested signal", async () => {
      await killProcessTree(4321, "SIGTERM");

      expect(killSpy).toHaveBeenCalledWith(-4321, "SIGTERM");
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("sent SIGTERM to process group 4321"),
      );
    });

    it("passes SIGKILL through unchanged for the forced phase", async () => {
      await killProcessTree(4321, "SIGKILL");

      expect(killSpy).toHaveBeenCalledWith(-4321, "SIGKILL");
    });

    it("reports not-found (debug only) when the group is already gone", async () => {
      const esrch: NodeJS.ErrnoException = new Error("kill ESRCH");
      esrch.code = "ESRCH";
      killSpy.mockImplementation((() => {
        throw esrch;
      }) as never);

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("not-found");
      // The old code treated ESRCH as success and logged nothing (issue #2742):
      // a *systematic* ESRCH (Windows) was therefore invisible. It must at
      // least leave a debug line now.
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("already gone"),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("reports failed and logs an error for any other kill error", async () => {
      const eperm: NodeJS.ErrnoException = new Error("kill EPERM");
      eperm.code = "EPERM";
      killSpy.mockImplementation((() => {
        throw eperm;
      }) as never);

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("failed to send SIGTERM to process group 4321"),
        eperm,
      );
    });
  });

  describe("Windows", () => {
    beforeEach(() => {
      setPlatform("win32");
    });

    it("runs taskkill /PID <pid> /T /F instead of process.kill", async () => {
      killSpy.mockImplementation((() => true) as never); // existence probe
      mockSpawn.mockReturnValue(
        fakeTaskkill({ code: 0 }) as unknown as ChildProcess,
      );

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("killed");
      expect(mockSpawn).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "4321", "/T", "/F"],
        expect.objectContaining({ windowsHide: true }),
      );
      // Only the existence probe used process.kill — never a negative pid.
      expect(killSpy).toHaveBeenCalledTimes(1);
      expect(killSpy).toHaveBeenCalledWith(4321, 0);
    });

    it("treats SIGTERM and SIGKILL as the same force kill", async () => {
      killSpy.mockImplementation((() => true) as never);
      mockSpawn.mockReturnValue(
        fakeTaskkill({ code: 0 }) as unknown as ChildProcess,
      );

      await killProcessTree(4321, "SIGKILL");

      expect(mockSpawn).toHaveBeenCalledWith(
        "taskkill",
        ["/PID", "4321", "/T", "/F"],
        expect.anything(),
      );
    });

    it("skips taskkill and reports not-found when the pid is already gone", async () => {
      const esrch: NodeJS.ErrnoException = new Error("kill ESRCH");
      esrch.code = "ESRCH";
      killSpy.mockImplementation((() => {
        throw esrch;
      }) as never);

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("not-found");
      expect(mockSpawn).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("already gone"),
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("decodes taskkill's GBK stderr and reports not-found on exit code 128", async () => {
      killSpy.mockImplementation((() => true) as never);
      mockSpawn.mockReturnValue(
        fakeTaskkill({
          code: 128,
          stderr: GBK_ERROR_PREFIX,
        }) as unknown as ChildProcess,
      );

      const result = await killProcessTree(999999, "SIGTERM");

      expect(result).toBe("not-found");
      expect(mockSpawn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      // GBK round-trip: the message must not be mojibake in the log.
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining("错误"),
      );
    });

    it("reports failed and logs an error for a non-zero, non-128 exit code", async () => {
      killSpy.mockImplementation((() => true) as never);
      mockSpawn.mockReturnValue(
        fakeTaskkill({ code: 1 }) as unknown as ChildProcess,
      );

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("taskkill /T /F failed for pid 4321"),
      );
    });

    it("does not throw when taskkill cannot be spawned", async () => {
      killSpy.mockImplementation((() => true) as never);
      mockSpawn.mockReturnValue(
        fakeTaskkill({
          code: null,
          error: Object.assign(new Error("spawn taskkill ENOENT"), {
            code: "ENOENT",
          }),
        }) as unknown as ChildProcess,
      );

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("could not run"),
        expect.objectContaining({ code: "ENOENT" }),
      );
    });

    it("does not throw when spawn itself throws", async () => {
      killSpy.mockImplementation((() => true) as never);
      mockSpawn.mockImplementation(() => {
        throw new Error("boom");
      });

      const result = await killProcessTree(4321, "SIGTERM");

      expect(result).toBe("failed");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("failed to spawn taskkill"),
        expect.any(Error),
      );
    });
  });

  describe("invalid pid", () => {
    it("never signals the caller's own process group for pid 0", async () => {
      // `process.kill(-0, sig)` === `process.kill(0, sig)` → own group.
      const result = await killProcessTree(0, "SIGTERM");

      expect(result).toBe("not-found");
      expect(killSpy).not.toHaveBeenCalled();
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
