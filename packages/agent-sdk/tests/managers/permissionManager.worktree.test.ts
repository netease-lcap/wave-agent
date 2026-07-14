import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";
import { setCurrentWorktreeSession } from "../../src/utils/worktreeSession.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("PermissionManager Worktree Safety", () => {
  const workdir = "/home/user/project/worktrees/feat-1";
  const mainRepoRoot = "/home/user/project";
  const worktreeName = "feat-1";

  function createWorktreeContainer(): Container {
    const c = new Container();
    c.register("Workdir", workdir);
    c.register("WorktreeName", worktreeName);
    c.register("MainRepoRoot", mainRepoRoot);
    return c;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorktreeSession(null);
  });

  afterEach(() => {
    setCurrentWorktreeSession(null);
  });

  it("should allow Write to a file inside the worktree", async () => {
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(workdir, "test.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });

  it("should auto-deny Write to a file in the main repo (outside worktree)", async () => {
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
    expect(result.message).toContain(worktreeName);
  });

  it("should auto-deny Edit to a file in the main repo (outside worktree)", async () => {
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Edit",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
  });

  it("should allow Write to the plan file outside the main repo in plan mode", async () => {
    const planFilePath = "/home/user/.wave/plans/plan.md";
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container, { planFilePath });
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "plan",
      toolInput: { file_path: planFilePath },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });

  it("should auto-deny Write to a non-plan file in the main repo in plan mode", async () => {
    const planFilePath = path.join(mainRepoRoot, "plan.md");
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container, { planFilePath });
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "plan",
      toolInput: { file_path: path.join(mainRepoRoot, "other.md") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
  });

  it("should deny Write to a file outside the main repo (Safe Zone check applies)", async () => {
    const container = createWorktreeContainer();
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: "/tmp/test.txt" },
    };

    const result = await manager.checkPermission(context);
    // /tmp is not in the Safe Zone (worktree dir), so falls through to normal check
    expect(result.behavior).toBe("deny");
    expect(result.message).not.toContain("worktree session");
  });

  it("should not auto-deny if not in a worktree session", async () => {
    const container = new Container();
    container.register("Workdir", mainRepoRoot);
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });
});

describe("PermissionManager Worktree Safety — EnterWorktree mid-session", () => {
  const originalCwd = "/home/user/project/src";
  const worktreePath = "/home/user/project/worktrees/feat-mid";
  const mainRepoRoot = "/home/user/project";
  const worktreeName = "feat-mid";

  beforeEach(() => {
    vi.clearAllMocks();
    setCurrentWorktreeSession({
      originalCwd,
      worktreePath,
      worktreeBranch: "worktree-feat-mid",
      worktreeName,
      isNew: true,
      repoRoot: mainRepoRoot,
      originalHeadCommit: "abc123",
    });
  });

  afterEach(() => {
    setCurrentWorktreeSession(null);
  });

  it("should auto-deny Write to main repo via module-level session (EnterWorktree path)", async () => {
    // Container has no WorktreeName/MainRepoRoot — simulates EnterWorktree mid-session
    const container = new Container();
    container.register("Workdir", worktreePath);
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("deny");
    expect(result.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
    expect(result.message).toContain(worktreeName);
  });

  it("should allow Write inside worktree via module-level session", async () => {
    const container = new Container();
    container.register("Workdir", worktreePath);
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(worktreePath, "test.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });

  it("should not auto-deny after module-level session is cleared", async () => {
    setCurrentWorktreeSession(null);
    const container = new Container();
    container.register("Workdir", mainRepoRoot);
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });
});
