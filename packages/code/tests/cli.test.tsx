import { describe, it, expect, vi, beforeEach } from "vitest";
import { startCli } from "../src/cli.js";
import { render } from "ink";
import { removeWorktree } from "../src/utils/worktree.js";
import { cleanupLogs } from "../src/utils/logger.js";

vi.mock("ink", () => ({
  render: vi.fn().mockReturnValue({
    unmount: vi.fn(),
    waitUntilExit: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Only the removal itself is stubbed: the survival wording is pure text, and
// stubbing it would let the output assertions below pass vacuously.
vi.mock("../src/utils/worktree.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/worktree.js")>();
  return { ...actual, removeWorktree: vi.fn() };
});

vi.mock("../src/utils/logger.js", () => ({
  cleanupLogs: vi.fn().mockResolvedValue(undefined),
}));

/**
 * Stands in for the teardown the unmount cleanup parks on the module.
 *
 * `null` means "no agent was ever created", which is the shape most cases here
 * have; the exit-ordering test below swaps in a promise it controls.
 */
const pendingDestroy = vi.hoisted(() => ({
  promise: null as Promise<void> | null,
}));

vi.mock("../src/contexts/useChat.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/contexts/useChat.js")>();
  return { ...actual, getPendingAgentDestroy: () => pendingDestroy.promise };
});

describe("startCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pendingDestroy.promise = null;
  });

  it("should call process.chdir to repoRoot before removing worktree", async () => {
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    // The removal path writes progress to stdout; keep it out of the suite
    // output (`testing.md`: a green run must stay quiet).
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });

    const worktreeSession = {
      name: "test",
      path: "/repo/root.worktrees/test",
      branch: "worktree-test",
      repoRoot: "/repo/root",
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: true,
    };

    // Mock render to call onExit with true
    vi.mocked(render).mockImplementationOnce((element: unknown) => {
      const { onExit } = (
        element as { props: { onExit: (shouldRemove: boolean) => void } }
      ).props;
      return {
        unmount: vi.fn(),
        waitUntilExit: async () => {
          onExit(true);
        },
      } as unknown as ReturnType<typeof render>;
    });

    // Removal succeeded, so the cleanup line stays quiet in this suite's output.
    vi.mocked(removeWorktree).mockResolvedValueOnce(true);

    await expect(startCli({ worktreeSession })).rejects.toThrow(
      "process.exit called",
    );

    expect(chdirSpy).toHaveBeenCalledWith("/repo/root");
    expect(removeWorktree).toHaveBeenCalledWith(worktreeSession);

    chdirSpy.mockRestore();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("shows deleting progress and done messages when removing worktree", async () => {
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const worktreeSession = {
      name: "test",
      path: "/repo/root.worktrees/test",
      branch: "worktree-test",
      repoRoot: "/repo/root",
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: true,
    };
    // Removal succeeded, which is what "Done." is allowed to mean.
    vi.mocked(removeWorktree).mockResolvedValueOnce(true);

    // Mock render to call onExit with true (Remove worktree)
    vi.mocked(render).mockImplementationOnce((element: unknown) => {
      const { onExit } = (
        element as { props: { onExit: (shouldRemove: boolean) => void } }
      ).props;
      return {
        unmount: vi.fn(),
        waitUntilExit: async () => {
          onExit(true);
        },
      } as unknown as ReturnType<typeof render>;
    });

    await expect(startCli({ worktreeSession })).rejects.toThrow(
      "process.exit called",
    );

    expect(stdoutSpy).toHaveBeenCalledWith("\nDeleting worktree ...\n");
    expect(stdoutSpy).toHaveBeenCalledWith("Done.\n");

    chdirSpy.mockRestore();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("reports a surviving worktree instead of claiming it was removed", async () => {
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const worktreeSession = {
      name: "test",
      path: "/repo/root.worktrees/test",
      branch: "worktree-test",
      repoRoot: "/repo/root",
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: true,
    };
    // Best-effort removal that failed: the directory and its branch are still
    // there, so "Done." would be a lie (issue #2763).
    vi.mocked(removeWorktree).mockResolvedValueOnce(false);

    vi.mocked(render).mockImplementationOnce((element: unknown) => {
      const { onExit } = (
        element as { props: { onExit: (shouldRemove: boolean) => void } }
      ).props;
      return {
        unmount: vi.fn(),
        waitUntilExit: async () => {
          onExit(true);
        },
      } as unknown as ReturnType<typeof render>;
    });

    await expect(startCli({ worktreeSession })).rejects.toThrow(
      "process.exit called",
    );

    const out = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(out).toContain(
      "Worktree directory survived at /repo/root.worktrees/test",
    );
    expect(out).toContain("git -C /repo/root branch -D worktree-test");
    expect(out).not.toContain("Done.");

    chdirSpy.mockRestore();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("exits cleanly without removing a worktree by default", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(startCli({})).rejects.toThrow("process.exit called");

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(removeWorktree).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("waits for the agent teardown before exiting", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    // A teardown that is still running: `process.exit` must not overtake it,
    // otherwise the detached bash process trees that `Agent.destroy()` was
    // about to signal survive as orphans.
    let finishTeardown!: () => void;
    pendingDestroy.promise = new Promise<void>((resolve) => {
      finishTeardown = resolve;
    });

    const cliRun = startCli({});
    const settled = vi.fn();
    void cliRun.then(settled, settled);

    // Flush the awaits ahead of the teardown wait (render / waitUntilExit).
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();

    finishTeardown();
    await expect(cliRun).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("logs and exits with code 1 when cleanup fails", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    vi.mocked(cleanupLogs).mockRejectedValueOnce(new Error("cleanup boom"));

    await expect(startCli({})).rejects.toThrow("process.exit called");

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Error during cleanup:",
      expect.any(Error),
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
