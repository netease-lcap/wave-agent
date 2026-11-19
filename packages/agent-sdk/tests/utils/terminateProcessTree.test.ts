import { ChildProcess } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../../src/utils/globalLogger.js";
import { killProcessTree } from "../../src/utils/killProcessTree.js";
import { terminateChildProcessTree } from "../../src/utils/terminateProcessTree.js";

// The tree kill itself is covered in killProcessTree.test.ts; what is asserted
// here is the escalation around it.
vi.mock("../../src/utils/killProcessTree.js", () => ({
  killProcessTree: vi.fn(async () => "killed"),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function child(pid?: number, killed = false) {
  return {
    pid,
    kill: vi.fn(),
    killed,
  } as unknown as ChildProcess;
}

describe("terminateChildProcessTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(killProcessTree).mockResolvedValue("killed");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends SIGTERM to the tree first, without touching the shell only", () => {
    const mockChild = child(1234);

    terminateChildProcessTree(mockChild);

    expect(killProcessTree).toHaveBeenCalledWith(1234, "SIGTERM");
    expect(killProcessTree).toHaveBeenCalledTimes(1);
    expect(mockChild.kill).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("follows with SIGKILL once the grace period ends", async () => {
    vi.useFakeTimers();
    const mockChild = child(1234);

    terminateChildProcessTree(mockChild);
    expect(killProcessTree).not.toHaveBeenCalledWith(1234, "SIGKILL");

    await vi.advanceTimersByTimeAsync(1000);

    expect(killProcessTree).toHaveBeenCalledWith(1234, "SIGKILL");
    expect(mockChild.kill).not.toHaveBeenCalled();
  });

  it("skips the forced phase when the child already reported itself killed", async () => {
    vi.useFakeTimers();
    const mockChild = child(1234, true);

    terminateChildProcessTree(mockChild);
    await vi.advanceTimersByTimeAsync(1000);

    expect(killProcessTree).toHaveBeenCalledTimes(1);
    expect(killProcessTree).toHaveBeenCalledWith(1234, "SIGTERM");
  });

  it("falls back to killing the shell when the tree kill fails", async () => {
    vi.mocked(killProcessTree).mockResolvedValue("failed");
    const mockChild = child(1234);

    terminateChildProcessTree(mockChild);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Failed to terminate the process tree of pid 1234",
      ),
    );
  });

  it("falls back to SIGKILL on the shell when the forced tree kill fails", async () => {
    vi.useFakeTimers();
    // SIGTERM works, SIGKILL does not: the forced phase must still try.
    vi.mocked(killProcessTree).mockImplementation(async (_, signal) =>
      signal === "SIGKILL" ? "failed" : "killed",
    );
    const mockChild = child(1234);

    terminateChildProcessTree(mockChild);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(0);

    expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kills the child directly when it never got a pid", () => {
    const mockChild = child(undefined);

    terminateChildProcessTree(mockChild);

    expect(killProcessTree).not.toHaveBeenCalled();
    expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("never throws when the direct kill does", () => {
    const mockChild = child(undefined);
    vi.mocked(mockChild.kill).mockImplementation(() => {
      throw new Error("ESRCH");
    });

    expect(() => terminateChildProcessTree(mockChild)).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(
      "Failed to kill child process:",
      expect.any(Error),
    );
  });
});
