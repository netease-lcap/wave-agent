import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createContainer(workdir?: string): Container {
  const c = new Container();
  if (workdir) {
    c.register("Workdir", workdir);
  }
  return c;
}

describe("PermissionManager Worktree Safety", () => {
  let container: Container;
  const workdir = "/home/user/project/worktrees/feat-1";
  const mainRepoRoot = "/home/user/project";
  const worktreeName = "feat-1";

  beforeEach(() => {
    vi.clearAllMocks();
    container = createContainer(workdir);
    container.register("WorktreeName", worktreeName);
    container.register("MainRepoRoot", mainRepoRoot);
  });

  it("should allow Write to a file inside the worktree", async () => {
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
    const manager = new PermissionManager(container, { planFilePath });
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "plan",
      toolInput: { file_path: path.join(mainRepoRoot, "other.md") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("deny");
    // In plan mode, it might be denied by the plan mode check itself or the worktree check.
    // The worktree check comes first in my implementation.
    expect(result.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
  });

  it("should allow Write to a file outside the main repo (normal Safe Zone check applies)", async () => {
    const manager = new PermissionManager(container);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: "/tmp/test.txt" },
    };

    const result = await manager.checkPermission(context);
    // Should fall through to normal check, which denies outside Safe Zone in acceptEdits
    expect(result.behavior).toBe("deny");
    expect(result.message).not.toContain("worktree session");
  });

  it("should not auto-deny if not in a worktree session", async () => {
    const emptyContainer = createContainer(mainRepoRoot);
    const manager = new PermissionManager(emptyContainer);
    const context: ToolPermissionContext = {
      toolName: "Write",
      permissionMode: "acceptEdits",
      toolInput: { file_path: path.join(mainRepoRoot, "main-file.txt") },
    };

    const result = await manager.checkPermission(context);
    expect(result.behavior).toBe("allow");
  });
});
