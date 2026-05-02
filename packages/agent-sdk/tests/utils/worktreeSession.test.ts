import { describe, it, expect, beforeEach } from "vitest";
import {
  getCurrentWorktreeSession,
  setCurrentWorktreeSession,
  type WorktreeSession,
} from "@/utils/worktreeSession.js";

describe("worktreeSession", () => {
  beforeEach(() => {
    // Reset session state before each test
    setCurrentWorktreeSession(null);
  });

  it("getCurrentWorktreeSession returns null initially", () => {
    setCurrentWorktreeSession(null);
    expect(getCurrentWorktreeSession()).toBeNull();
  });

  it("setCurrentWorktreeSession stores and retrieves session", () => {
    const session: WorktreeSession = {
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      worktreeName: "test",
      isNew: true,
      repoRoot: "/repo",
      originalHeadCommit: "abc123",
    };

    setCurrentWorktreeSession(session);
    expect(getCurrentWorktreeSession()).toEqual(session);
  });

  it("setCurrentWorktreeSession(null) clears the session", () => {
    const session: WorktreeSession = {
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      worktreeName: "test",
      isNew: true,
      repoRoot: "/repo",
    };

    setCurrentWorktreeSession(session);
    expect(getCurrentWorktreeSession()).not.toBeNull();

    setCurrentWorktreeSession(null);
    expect(getCurrentWorktreeSession()).toBeNull();
  });
});
