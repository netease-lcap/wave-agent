import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "../../src/managers/aiManager.js";
import { Container } from "../../src/utils/container.js";
import type { WorktreeSession } from "../../src/utils/worktreeSession.js";

// Mock node:fs so tests control directory existence without touching the filesystem
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
}));

import * as fs from "node:fs";

const existsSyncMock = vi.mocked(fs.existsSync);

/**
 * User Story — 手动删除 worktree 后会话自动恢复.
 *
 * When the session's workdir is deleted behind wave's back (manual
 * `git worktree remove`), getWorkdir() must auto-recover to the original
 * workdir so spawn-based tools (Bash/Grep/background tasks) stop failing
 * with ENOENT.
 */
const worktreeSession: WorktreeSession = {
  originalCwd: "/repo",
  worktreePath: "/repo/.wave/worktrees/feat-a",
  worktreeBranch: "wave-feat-a",
  worktreeName: "feat-a",
  isNew: true,
  repoRoot: "/repo",
};

function createManager(
  workdir: string,
  originalWorkdir: string = "/repo",
): AIManager {
  const container = new Container();
  container.register("Workdir", workdir);
  container.register<WorktreeSession | null>("WorktreeSession", null);
  // Real scenario: the Agent is created in the main repo; EnterWorktree only
  // changes the container "Workdir" to the worktree path, originalWorkdir
  // stays at the main repo root.
  return new AIManager(container, { workdir: originalWorkdir });
}

describe("AIManager workdir auto-recovery (manual worktree removal)", () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false); // default: nothing exists
  });

  it("recovers to the original workdir when the stored workdir is gone and the original exists", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");
    existsSyncMock.mockImplementation((p) => p === "/repo");

    expect(manager.getWorkdir()).toBe("/repo");
  });

  it("consumeCwdRecovery returns the notice exactly once", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");
    existsSyncMock.mockImplementation((p) => p === "/repo");

    manager.getWorkdir();
    expect(manager.consumeCwdRecovery()).toEqual({
      from: "/repo/.wave/worktrees/feat-a",
      to: "/repo",
    });
    expect(manager.consumeCwdRecovery()).toBeNull();
  });

  it("clears the stale worktree session when the removed dir is the session's worktree", () => {
    const container = new Container();
    container.register("Workdir", "/repo/.wave/worktrees/feat-a");
    container.register("WorktreeSession", worktreeSession);
    const manager = new AIManager(container, { workdir: "/repo" });
    existsSyncMock.mockImplementation((p) => p === "/repo");

    manager.getWorkdir();
    expect(manager.getWorkdir()).toBe("/repo");
    expect(manager.getWorktreeSession()).toBeNull();
  });

  it("keeps the worktree session when the missing dir is not the session's worktree", () => {
    const container = new Container();
    container.register("Workdir", "/repo/.wave/worktrees/other");
    container.register("WorktreeSession", worktreeSession);
    const manager = new AIManager(container, { workdir: "/repo" });
    existsSyncMock.mockImplementation((p) => p === "/repo");

    manager.getWorkdir();
    expect(manager.getWorktreeSession()).toEqual(worktreeSession);
  });

  it("keeps the stale value when the original workdir is also missing", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");

    expect(manager.getWorkdir()).toBe("/repo/.wave/worktrees/feat-a");
    expect(manager.consumeCwdRecovery()).toBeNull();
  });

  it("does not recover when the stored workdir still exists", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");
    existsSyncMock.mockReturnValue(true);

    expect(manager.getWorkdir()).toBe("/repo/.wave/worktrees/feat-a");
    expect(manager.consumeCwdRecovery()).toBeNull();
  });

  it("notifies the host via onCwdChange exactly once and stays stable on subsequent calls", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");
    existsSyncMock.mockImplementation((p) => p === "/repo");
    const calls: string[] = [];
    manager.setOnCwdChange((cwd) => calls.push(cwd));

    expect(manager.getWorkdir()).toBe("/repo");
    expect(manager.getWorkdir()).toBe("/repo");

    // Host notified once (first call recovered; later calls short-circuit).
    expect(calls).toEqual(["/repo"]);
  });

  it("is safe without a registered onCwdChange callback", () => {
    const manager = createManager("/repo/.wave/worktrees/feat-a");
    existsSyncMock.mockImplementation((p) => p === "/repo");

    expect(() => manager.getWorkdir()).not.toThrow();
    expect(manager.getWorkdir()).toBe("/repo");
  });
});
