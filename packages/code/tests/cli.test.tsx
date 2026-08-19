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

vi.mock("../src/utils/worktree.js", () => ({
  removeWorktree: vi.fn(),
}));

vi.mock("../src/utils/logger.js", () => ({
  cleanupLogs: vi.fn().mockResolvedValue(undefined),
}));

describe("startCli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call process.chdir to repoRoot before removing worktree", async () => {
    const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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

    await expect(startCli({ worktreeSession })).rejects.toThrow(
      "process.exit called",
    );

    expect(chdirSpy).toHaveBeenCalledWith("/repo/root");
    expect(removeWorktree).toHaveBeenCalledWith(worktreeSession);

    chdirSpy.mockRestore();
    exitSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

  it("enables and disables bracketed paste when stdout is a TTY", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const stdoutWriteSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });

    await expect(startCli({})).rejects.toThrow("process.exit called");

    expect(stdoutWriteSpy).toHaveBeenCalledWith("\x1b[?2004h");
    expect(stdoutWriteSpy).toHaveBeenCalledWith("\x1b[?2004l");

    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    stdoutWriteSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    exitSpy.mockRestore();
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
