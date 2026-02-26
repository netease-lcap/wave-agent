import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaskManager } from "@/services/taskManager.js";
import { Agent } from "@/agent.js";
import { readFile } from "fs/promises";
import type { PermissionCallback } from "@/types/permissions.js";
import type { ToolManager } from "@/managers/toolManager.js";
import type { MessageManager } from "@/managers/messageManager.js";
import type { PermissionManager } from "@/managers/permissionManager.js";
import type { TextBlock } from "@/types/messaging.js";

interface AgentInternal {
  messageManager: MessageManager;
  permissionManager: PermissionManager;
  taskManager: TaskManager;
  toolManager: ToolManager;
}

// Mock fs/promises
vi.mock("fs/promises");

describe("ExitPlanMode Clear Context", () => {
  const originalEnv = process.env;
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

  afterEach(() => {
    process.env = originalEnv;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    vi.restoreAllMocks();
  });

  it("should clear context and add plan as user message when clearContext is true", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan content";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
      clearContext: true,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Add some initial messages
    agent.sendMessage("Initial message");
    expect(agent.messages.length).toBeGreaterThan(0);

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockResolvedValue(planContent);

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(true);
    expect(agent.getPermissionMode()).toBe("acceptEdits");

    // Verify messages are cleared and plan is added
    expect(agent.messages.length).toBe(1);
    expect(agent.messages[0].role).toBe("user");
    const textBlock = agent.messages[0].blocks.find(
      (b) => b.type === "text",
    ) as TextBlock;
    expect(textBlock).toBeDefined();
    const content = textBlock.content;
    expect(content).toContain(planContent);
    expect(content).toContain("Implement the following plan:");
  });

  it("should NOT clear context if ExitPlanMode fails before permission check", async () => {
    const workdir = "/test/workdir";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
      clearContext: true,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Add some initial messages
    await agent.sendMessage("Initial message");
    const initialMessageCount = agent.messages.length;
    expect(initialMessageCount).toBeGreaterThan(0);

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockRejectedValue(new Error("Read error"));

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read plan file");

    // Messages should NOT be cleared because checkPermission was never called
    expect(agent.messages.length).toBe(initialMessageCount);
  });

  it("should clear messages but not add plan if reading plan file fails during context clearing", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan content";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
      clearContext: true,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Add some initial messages
    await agent.sendMessage("Initial message");
    expect(agent.messages.length).toBeGreaterThan(0);

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    // First call (in ExitPlanMode) succeeds, second call (in setupAgentContainer) fails
    vi.mocked(readFile)
      .mockResolvedValueOnce(planContent)
      .mockRejectedValueOnce(new Error("Read error during clearing"));

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(true);

    // Messages should be cleared (because clearMessages() is called before readFile())
    // but plan should not be added because readFile() failed
    expect(agent.messages.length).toBe(0);
  });

  it("should clear messages but not add plan if planFilePath is undefined", async () => {
    const workdir = "/test/workdir";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
      clearContext: true,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Add some initial messages
    await agent.sendMessage("Initial message");
    expect(agent.messages.length).toBeGreaterThan(0);

    // Manually clear plan file path in permission manager
    (agent as unknown as AgentInternal).permissionManager.setPlanFilePath(
      undefined,
    );

    // Execute ExitPlanMode tool - it will fail because planFilePath is missing
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Plan file path is not set");

    // Messages should NOT be cleared because ExitPlanMode failed before checkPermission
    expect(agent.messages.length).toBeGreaterThan(0);
  });

  it("should handle newPermissionMode and newPermissionRule in decision", async () => {
    const workdir = "/test/workdir";
    const planContent = "My plan content";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      newPermissionMode: "acceptEdits",
      newPermissionRule: "Bash(cat)",
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "plan",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Wait for plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    vi.mocked(readFile).mockResolvedValue(planContent);

    // Execute ExitPlanMode tool
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute("ExitPlanMode", {}, { workdir, taskManager });

    expect(result.success).toBe(true);
    expect(agent.getPermissionMode()).toBe("acceptEdits");
    // The rule might be expanded or slightly different depending on how expandBashRule works
    const allowedRules = agent.getAllowedRules();
    expect(allowedRules.some((r) => r.includes("Bash(cat"))).toBe(true);
  });

  it("should clear messages but not add plan if planFilePath is undefined during tool execution", async () => {
    const workdir = "/test/workdir";

    const mockCallback = vi.fn().mockResolvedValue({
      behavior: "allow",
      clearContext: true,
    });

    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
      canUseTool: mockCallback as PermissionCallback,
    });

    // Add some initial messages
    await agent.sendMessage("Initial message");
    expect(agent.messages.length).toBeGreaterThan(0);

    // Ensure plan file path is undefined
    (agent as unknown as AgentInternal).permissionManager.setPlanFilePath(
      undefined,
    );

    vi.mocked(readFile).mockResolvedValue("some content");

    const messageManager = (agent as unknown as AgentInternal).messageManager;
    const clearSpy = vi.spyOn(messageManager, "clearMessages");

    // Execute Write tool (which is restricted and doesn't use spawn)
    const taskManager = (agent as unknown as AgentInternal).taskManager;
    const result = await (
      agent as unknown as AgentInternal
    ).toolManager.execute(
      "Write",
      { file_path: "test.txt", content: "test" },
      { workdir, taskManager },
    );

    expect(result.success).toBe(true);
    expect(mockCallback).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();

    // Messages should be cleared but plan not added
    expect(agent.messages.length).toBe(0);
  });
});
