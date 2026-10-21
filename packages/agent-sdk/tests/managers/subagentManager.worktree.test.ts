import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "path";
import { Container } from "../../src/utils/container.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

const worktreeMocks = vi.hoisted(() => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  countWorktreeChanges: vi.fn(),
  performPostCreationSetup: vi.fn(),
  getHeadCommit: vi.fn(),
  generateWorktreeName: vi.fn(),
  getGitMainRepoRoot: vi.fn(),
  resolveGitDir: vi.fn(),
  hasWorktreeCreateHook: vi.fn(),
  hasWorktreeRemoveHook: vi.fn(),
  executeWorktreeCreateHook: vi.fn(),
  executeWorktreeRemoveHook: vi.fn(),
  messageManagerOptions: [] as Record<string, unknown>[],
  permissionManagerOptions: [] as Record<string, unknown>[],
}));

vi.mock("../../src/utils/worktreeUtils.js", () => ({
  createWorktree: worktreeMocks.createWorktree,
  removeWorktree: worktreeMocks.removeWorktree,
  countWorktreeChanges: worktreeMocks.countWorktreeChanges,
  performPostCreationSetup: worktreeMocks.performPostCreationSetup,
  getHeadCommit: worktreeMocks.getHeadCommit,
  generateWorktreeName: worktreeMocks.generateWorktreeName,
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  getGitMainRepoRoot: worktreeMocks.getGitMainRepoRoot,
  resolveGitDir: worktreeMocks.resolveGitDir,
}));

vi.mock("../../src/services/worktreeHooks.js", () => ({
  hasWorktreeCreateHook: worktreeMocks.hasWorktreeCreateHook,
  hasWorktreeRemoveHook: worktreeMocks.hasWorktreeRemoveHook,
  executeWorktreeCreateHook: worktreeMocks.executeWorktreeCreateHook,
  executeWorktreeRemoveHook: worktreeMocks.executeWorktreeRemoveHook,
}));

vi.mock("../../src/managers/messageManager.js", () => ({
  MessageManager: vi.fn().mockImplementation(function (
    _container: unknown,
    options: Record<string, unknown>,
  ) {
    worktreeMocks.messageManagerOptions.push(options);
    return {
      addUserMessage: vi.fn(),
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "done" }] },
        ]),
      getLatestTotalTokens: vi.fn(() => 0),
    };
  }),
}));

vi.mock("../../src/managers/toolManager.js", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return { initializeBuiltInTools: vi.fn() };
  }),
}));

vi.mock("../../src/managers/permissionManager.js", () => ({
  PermissionManager: vi.fn().mockImplementation(function (
    _container: unknown,
    options: Record<string, unknown>,
  ) {
    worktreeMocks.permissionManagerOptions.push(options);
    return {
      addTemporaryRules: vi.fn(),
    };
  }),
}));

vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockResolvedValue(undefined),
      abortAIMessage: vi.fn(),
    };
  }),
}));

const REPO_ROOT = path.resolve("/fake/repo");
const WORKTREE_PATH = path.join(
  REPO_ROOT,
  ".wave",
  "worktrees",
  "swift-fox-123",
);
const WORKTREE_BRANCH = "worktree-swift-fox-123";
const HOOK_WORKTREE_PATH = path.resolve("/fake/hook-worktree");

const config: SubagentConfiguration = {
  name: "general-purpose",
  description: "General-purpose agent",
  systemPrompt: "You are an agent",
  filePath: "<builtin:general-purpose>",
  scope: "builtin",
  priority: 3,
};

describe("SubagentManager worktree isolation", () => {
  let manager: SubagentManager;

  function createContainer(): Container {
    const container = new Container();
    container.register("ToolManager", { initializeBuiltInTools: vi.fn() });
    container.register("ConfigurationService", {
      resolveWorktreeBaseRef: () => "fresh",
      getMergedEnv: () => ({}),
    });
    container.register("MessageManager", {
      getSessionId: () => "session-1",
      getTranscriptPath: () => path.join(REPO_ROOT, "session-1.jsonl"),
    });
    container.register("HookManager", { getConfiguration: () => ({}) });
    return container;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    worktreeMocks.messageManagerOptions.length = 0;
    worktreeMocks.permissionManagerOptions.length = 0;

    worktreeMocks.generateWorktreeName.mockReturnValue("swift-fox-123");
    worktreeMocks.getGitMainRepoRoot.mockReturnValue(REPO_ROOT);
    worktreeMocks.resolveGitDir.mockReturnValue(path.join(REPO_ROOT, ".git"));
    worktreeMocks.hasWorktreeCreateHook.mockReturnValue(false);
    worktreeMocks.hasWorktreeRemoveHook.mockReturnValue(false);
    worktreeMocks.getHeadCommit.mockReturnValue("worktree-base-head");
    worktreeMocks.performPostCreationSetup.mockResolvedValue(undefined);
    worktreeMocks.createWorktree.mockReturnValue({
      name: "swift-fox-123",
      path: WORKTREE_PATH,
      branch: WORKTREE_BRANCH,
      repoRoot: REPO_ROOT,
      isNew: true,
      originalHeadCommit: "parent-head",
    });
    worktreeMocks.countWorktreeChanges.mockReturnValue({
      changedFiles: 0,
      commits: 0,
    });

    manager = new SubagentManager(createContainer(), {
      workdir: REPO_ROOT,
      stream: false,
    });
  });

  it("creates a worktree and points the subagent managers at it", async () => {
    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    expect(worktreeMocks.createWorktree).toHaveBeenCalledWith(
      "swift-fox-123",
      REPO_ROOT,
      { baseRef: "fresh" },
    );
    expect(worktreeMocks.performPostCreationSetup).toHaveBeenCalledWith(
      WORKTREE_PATH,
      REPO_ROOT,
    );
    expect(worktreeMocks.getHeadCommit).toHaveBeenCalledWith(WORKTREE_PATH);
    expect(instance.worktree?.session.worktreePath).toBe(WORKTREE_PATH);
    expect(worktreeMocks.messageManagerOptions[0].workdir).toBe(WORKTREE_PATH);
  });

  it("does not create a worktree without isolation", async () => {
    await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
      },
      false,
    );

    expect(worktreeMocks.createWorktree).not.toHaveBeenCalled();
    expect(worktreeMocks.messageManagerOptions[0].workdir).toBe(REPO_ROOT);
  });

  it("denies EnterWorktree/ExitWorktree for an isolated subagent", async () => {
    await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const denied = worktreeMocks.permissionManagerOptions[0]
      .instanceDeniedRules as string[];
    expect(denied).toContain("EnterWorktree");
    expect(denied).toContain("ExitWorktree");
  });

  it("removes a clean worktree and reports it", async () => {
    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.countWorktreeChanges).toHaveBeenCalledWith(
      WORKTREE_PATH,
      "worktree-base-head",
    );
    expect(worktreeMocks.removeWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        path: WORKTREE_PATH,
        branch: WORKTREE_BRANCH,
      }),
    );
    expect(result).toContain("no changes, so the worktree was removed.");
    expect(instance.worktreeSummary).toContain(WORKTREE_PATH);
  });

  it("keeps a dirty worktree and reports its path, branch and changes", async () => {
    worktreeMocks.countWorktreeChanges.mockReturnValue({
      changedFiles: 2,
      commits: 1,
    });

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.removeWorktree).not.toHaveBeenCalled();
    expect(result).toContain(
      `ran in ${WORKTREE_PATH} on branch ${WORKTREE_BRANCH}`,
    );
    expect(result).toContain("2 changed file(s), 1 commit(s)");
    expect(result).toContain("NOT applied to the parent working directory");
  });

  it("keeps the worktree when changes cannot be determined", async () => {
    worktreeMocks.countWorktreeChanges.mockReturnValue(null);

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.removeWorktree).not.toHaveBeenCalled();
    expect(result).toContain("its changes could not be determined");
  });

  it("keeps a pre-existing worktree even when it is clean", async () => {
    worktreeMocks.createWorktree.mockReturnValue({
      name: "swift-fox-123",
      path: WORKTREE_PATH,
      branch: WORKTREE_BRANCH,
      repoRoot: REPO_ROOT,
      isNew: false,
      originalHeadCommit: "parent-head",
    });

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.performPostCreationSetup).not.toHaveBeenCalled();
    expect(worktreeMocks.removeWorktree).not.toHaveBeenCalled();
    expect(result).toContain("already existed, so it was left in place");
  });

  it("fails the delegation when there is no git repo and no WorktreeCreate hook", async () => {
    // `getGitMainRepoRoot` never reports "not a repo" (it falls back to the
    // cwd), so the check has to go through `resolveGitDir`.
    worktreeMocks.resolveGitDir.mockReturnValue(null);

    await expect(
      manager.createInstance(
        config,
        {
          description: "test",
          prompt: "do work",
          subagent_type: "general-purpose",
          worktreeIsolation: true,
        },
        false,
      ),
    ).rejects.toThrow(/not in a git repository/);
    expect(worktreeMocks.createWorktree).not.toHaveBeenCalled();
  });

  it("uses the WorktreeCreate hook when configured and cleans up through WorktreeRemove", async () => {
    worktreeMocks.hasWorktreeCreateHook.mockReturnValue(true);
    worktreeMocks.executeWorktreeCreateHook.mockResolvedValue({
      worktreePath: HOOK_WORKTREE_PATH,
    });
    worktreeMocks.hasWorktreeRemoveHook.mockReturnValue(true);

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    expect(worktreeMocks.createWorktree).not.toHaveBeenCalled();
    expect(worktreeMocks.messageManagerOptions[0].workdir).toBe(
      HOOK_WORKTREE_PATH,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.executeWorktreeRemoveHook).toHaveBeenCalledWith(
      HOOK_WORKTREE_PATH,
      {},
      expect.objectContaining({
        projectDir: REPO_ROOT,
        sessionId: "session-1",
      }),
    );
    expect(result).toContain("no changes, so the worktree was cleaned up.");
  });

  it("keeps a hook-based worktree when no WorktreeRemove hook is configured", async () => {
    worktreeMocks.hasWorktreeCreateHook.mockReturnValue(true);
    worktreeMocks.executeWorktreeCreateHook.mockResolvedValue({
      worktreePath: HOOK_WORKTREE_PATH,
    });
    worktreeMocks.hasWorktreeRemoveHook.mockReturnValue(false);

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
    expect(result).toContain("no WorktreeRemove hook is configured");
  });

  it("keeps a hook-based worktree that is not a git worktree", async () => {
    worktreeMocks.hasWorktreeCreateHook.mockReturnValue(true);
    worktreeMocks.executeWorktreeCreateHook.mockResolvedValue({
      worktreePath: HOOK_WORKTREE_PATH,
    });
    worktreeMocks.hasWorktreeRemoveHook.mockReturnValue(true);
    // A hook may create a plain directory (another VCS): no HEAD to diff.
    worktreeMocks.getHeadCommit.mockImplementation(() => {
      throw new Error("not a git repository");
    });

    const instance = await manager.createInstance(
      config,
      {
        description: "test",
        prompt: "do work",
        subagent_type: "general-purpose",
        worktreeIsolation: true,
      },
      false,
    );

    const result = await manager.executeAgent(instance, "do work");

    expect(worktreeMocks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
    expect(worktreeMocks.countWorktreeChanges).not.toHaveBeenCalled();
    expect(result).toContain("it is not a git worktree");
  });
});
