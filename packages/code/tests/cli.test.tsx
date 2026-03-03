import { describe, it, expect, vi, beforeEach } from "vitest";
import { startCli } from "../src/cli.js";
import { render } from "ink";
import { removeWorktree } from "../src/utils/worktree.js";

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
      path: "/repo/root/.wave/worktrees/test",
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
});
