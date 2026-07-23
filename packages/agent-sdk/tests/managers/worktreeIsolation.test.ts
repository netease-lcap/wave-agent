import { describe, it, expect } from "vitest";
import { AIManager } from "../../src/managers/aiManager.js";
import { Container } from "../../src/utils/container.js";
import type { WorktreeSession } from "../../src/utils/worktreeSession.js";

/**
 * User Story 8 - stdio multi-agent concurrent worktree session isolation.
 *
 * In the stdio backend a single process multiplexes multiple sessions, each
 * holding an independent Agent + DI Container. These tests verify that
 * worktree session state (now stored per-container) and workdir do not leak
 * across sessions, and that setWorkdir() does not mutate process.cwd().
 */

/** Build a minimal AIManager with its own isolated container. */
function createManager(workdir: string): AIManager {
  const container = new Container();
  container.register("Workdir", workdir);
  container.register<WorktreeSession | null>("WorktreeSession", null);
  return new AIManager(container, { workdir });
}

const sessionA: WorktreeSession = {
  originalCwd: "/repo",
  worktreePath: "/repo/.wave/worktrees/feat-a",
  worktreeBranch: "wave-feat-a",
  worktreeName: "feat-a",
  isNew: true,
  repoRoot: "/repo",
};

const sessionB: WorktreeSession = {
  originalCwd: "/repo",
  worktreePath: "/repo/.wave/worktrees/feat-b",
  worktreeBranch: "wave-feat-b",
  worktreeName: "feat-b",
  isNew: true,
  repoRoot: "/repo",
};

describe("worktree multi-session isolation (User Story 8)", () => {
  it("scenario 1: A enters worktree, B's workdir and session stay unchanged", () => {
    const a = createManager("/repo");
    const b = createManager("/repo");

    // A enters a worktree
    a.setWorktreeSession(sessionA);
    a.setWorkdir(sessionA.worktreePath);

    // B is unaffected
    expect(b.getWorkdir()).toBe("/repo");
    expect(b.getWorktreeSession()).toBeNull();
    expect(a.getWorktreeSession()).toEqual(sessionA);
    expect(a.getWorkdir()).toBe(sessionA.worktreePath);
  });

  it("scenario 2: A in worktree, B can still enter its own (not rejected)", () => {
    const a = createManager("/repo");
    const b = createManager("/repo");

    // A is already in a worktree
    a.setWorktreeSession(sessionA);
    a.setWorkdir(sessionA.worktreePath);

    // B reads its own session -> null, so EnterWorktree's "already in worktree"
    // guard must NOT reject B based on A's state.
    expect(b.getWorktreeSession()).toBeNull();

    // B enters its own worktree independently
    b.setWorktreeSession(sessionB);
    b.setWorkdir(sessionB.worktreePath);

    expect(b.getWorktreeSession()).toEqual(sessionB);
    expect(b.getWorkdir()).toBe(sessionB.worktreePath);
    // A still untouched
    expect(a.getWorktreeSession()).toEqual(sessionA);
    expect(a.getWorkdir()).toBe(sessionA.worktreePath);
  });

  it("scenario 3: both in worktrees, B exits -> only B affected, A intact", () => {
    const a = createManager("/repo");
    const b = createManager("/repo");

    a.setWorktreeSession(sessionA);
    a.setWorkdir(sessionA.worktreePath);
    b.setWorktreeSession(sessionB);
    b.setWorkdir(sessionB.worktreePath);

    // B exits its worktree (ExitWorktree clears session + restores workdir)
    b.setWorktreeSession(null);
    b.setWorkdir(b.getOriginalWorkdir());

    // B is restored
    expect(b.getWorktreeSession()).toBeNull();
    expect(b.getWorkdir()).toBe("/repo");
    // A is completely untouched
    expect(a.getWorktreeSession()).toEqual(sessionA);
    expect(a.getWorkdir()).toBe(sessionA.worktreePath);
  });

  it("scenario 4: only A in worktree, B (never entered) exits -> no-op, A intact", () => {
    const a = createManager("/repo");
    const b = createManager("/repo");

    a.setWorktreeSession(sessionA);
    a.setWorkdir(sessionA.worktreePath);

    // B never entered; ExitWorktree's no-op guard reads B's own session -> null
    expect(b.getWorktreeSession()).toBeNull();

    // B "exits" -> nothing to clear, must not touch A
    const bSessionBefore = b.getWorktreeSession();
    b.setWorktreeSession(null); // no-op
    b.setWorkdir(b.getOriginalWorkdir());

    expect(b.getWorktreeSession()).toBe(bSessionBefore); // still null
    expect(b.getWorkdir()).toBe("/repo");
    // A untouched
    expect(a.getWorktreeSession()).toEqual(sessionA);
    expect(a.getWorkdir()).toBe(sessionA.worktreePath);
  });

  it("FR-041: setWorkdir does not mutate process.cwd()", () => {
    const before = process.cwd();
    const a = createManager("/repo");

    a.setWorkdir("/repo/.wave/worktrees/feat-a");

    expect(a.getWorkdir()).toBe("/repo/.wave/worktrees/feat-a");
    expect(process.cwd()).toBe(before);
  });

  it("FR-042: setWorkdir triggers the onCwdChange callback (so worktree switches notify the host)", () => {
    const a = createManager("/repo");
    const calls: string[] = [];
    a.setOnCwdChange((cwd) => calls.push(cwd));

    a.setWorkdir("/repo/.wave/worktrees/feat-a");

    // Agent wires AIManager._onCwdChange → onWorkdirChange; without this
    // trigger the webview never learns that EnterWorktree/ExitWorktree moved
    // the working directory, so tool header paths stay stale.
    expect(calls).toEqual(["/repo/.wave/worktrees/feat-a"]);
    // Still no process.cwd() mutation.
    expect(process.cwd()).not.toBe("/repo/.wave/worktrees/feat-a");
  });

  it("FR-042: setWorkdir is safe without a registered onCwdChange callback", () => {
    const a = createManager("/repo");
    // No setOnCwdChange — _onCwdChange is undefined; must not throw.
    expect(() => a.setWorkdir("/repo/.wave/worktrees/feat-a")).not.toThrow();
    expect(a.getWorkdir()).toBe("/repo/.wave/worktrees/feat-a");
  });
});
