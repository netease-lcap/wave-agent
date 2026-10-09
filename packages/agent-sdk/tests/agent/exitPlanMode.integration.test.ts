import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskManager } from "@/services/taskManager.js";
import { Agent } from "@/agent.js";
import { readFile } from "fs/promises";
import type { PermissionCallback } from "@/types/permissions.js";
import type { ToolManager } from "@/managers/toolManager.js";
import type { PermissionManager } from "@/managers/permissionManager.js";

interface AgentInternal {
  toolManager: ToolManager;
  permissionManager: PermissionManager;
}

// Mock fs/promises
vi.mock("fs/promises");

describe("ExitPlanMode Integration", () => {
  const originalEnv = process.env;
  let activeAgent: Agent | undefined;
  let mockStdout: typeof process.stdout.write;
  let mockStderr: typeof process.stderr.write;
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.WAVE_API_KEY = "test-api-key";
    process.env.WAVE_BASE_URL = "https://test-gateway.com/api";

    originalStdoutWrite = process.stdout.write;
    originalStderrWrite = process.stderr.write;
    mockStdout = vi.fn() as typeof process.stdout.write;
    mockStderr = vi.fn() as typeof process.stderr.write;
    process.stdout.write = mockStdout;
    process.stderr.write = mockStderr;
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
    process.env = originalEnv;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    vi.restoreAllMocks();
  });

  it("should keep both plan mode tools declared in all permission modes", async () => {
    const agent = await Agent.create({
      workdir: "/test/workdir",
      permissionMode: "default",
    });
    activeAgent = agent;

    const toolManager = (agent as unknown as AgentInternal).toolManager;

    // Both tools stay declared whatever the permission mode — the runtime guard,
    // not the tool list, validates the mode. They are deferred (Claude Code's
    // `shouldDefer: true` pair), so they are declared exactly once: inside the
    // Exec sandbox when that channel is open, flat in `tools[]` when it is
    // closed. The model must never see the same tool twice.
    const expectDeclaredOnce = () => {
      const flat = toolManager
        .getToolsConfig()
        .map((tool) => tool.function.name);
      const sandboxed = toolManager.getOnDemandToolNames() ?? [];
      for (const name of ["ExitPlanMode", "EnterPlanMode"]) {
        expect(flat.includes(name)).not.toBe(sandboxed.includes(name));
      }
    };

    expectDeclaredOnce();

    // Switch to plan mode — unchanged
    agent.setPermissionMode("plan");
    expectDeclaredOnce();

    // Switch back to default — unchanged
    agent.setPermissionMode("default");
    expectDeclaredOnce();
  });

  it("should transition to default mode when ExitPlanMode is approved with default", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "default",
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });
    activeAgent = agent;

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockResolvedValue(planContent);

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as { taskManager: TaskManager })
      .taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(true);
    expect(agent.getPermissionMode()).toBe("default");
    expect(mockCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ExitPlanMode",
        toolInput: {},
        planContent: planContent,
      }),
    );
  });

  it("should transition to acceptEdits mode when ExitPlanMode is approved with acceptEdits", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });
    activeAgent = agent;

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockResolvedValue(planContent);

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as { taskManager: TaskManager })
      .taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(true);
    expect(agent.getPermissionMode()).toBe("acceptEdits");
  });

  it("should remain in plan mode and return feedback when ExitPlanMode is denied", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan";
    const feedback = "Needs more work";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "deny",
      message: feedback,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });
    activeAgent = agent;

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockResolvedValue(planContent);

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as { taskManager: TaskManager })
      .taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      `The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\n${feedback}`,
    );
    expect(agent.getPermissionMode()).toBe("plan");
  });
});
