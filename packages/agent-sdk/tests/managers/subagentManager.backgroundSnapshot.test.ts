import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { Container } from "../../src/utils/container.js";
import type { BackgroundTask } from "../../src/types/processes.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock the managers whose real implementations are not needed here — but keep
// the BackgroundTaskManager REAL: the regression under test is that finishing a
// background subagent must push a fresh snapshot (onBackgroundTasksChange) with
// the terminal status, exactly like shell tasks do on exit.
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockResolvedValue("Test response"),
      abortAIMessage: vi.fn(),
    };
  }),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

describe("SubagentManager - background task terminal snapshots", () => {
  let subagentManager: SubagentManager;
  let container: Container;
  let backgroundTaskManager: BackgroundTaskManager;
  let snapshots: BackgroundTask[][];
  let logFiles: string[] = [];

  const testConfig: SubagentConfiguration = {
    name: "TestAgent",
    description: "Test agent",
    systemPrompt: "System prompt",
    tools: ["Read"],
    model: "inherit",
    filePath: "/test/agent.md",
    scope: "user",
    priority: 1,
  };

  const captureStatusFor = (taskId: string): string | undefined => {
    const last = snapshots[snapshots.length - 1];
    return last?.find((t) => t.id === taskId)?.status;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    snapshots = [];
    logFiles = [];

    container = new Container();

    // Real BackgroundTaskManager whose snapshots are recorded. The task objects
    // it hands out are mutated in place by SubagentManager; only notifyTasksChange
    // pushes a snapshot to UI consumers (webview gate + hosts).
    backgroundTaskManager = new BackgroundTaskManager(container, {
      workdir: "/test",
      callbacks: {
        onBackgroundTasksChange: (tasks) => {
          // Deep-copy at push time: SubagentManager mutates the SAME task
          // objects in place, so retaining references would mask a missing
          // terminal notify (the in-map status flips without a snapshot).
          snapshots.push(tasks.map((t) => ({ ...t })));
        },
      },
    });
    container.register("BackgroundTaskManager", backgroundTaskManager);

    container.register("ToolManager", {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager);

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;
    container.register("TaskManager", taskManager);

    container.register("ConfigurationService", {
      resolveGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      resolveModelConfig: () => ({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => "en",
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
  });

  const createInstance = async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });
    // Stub the (auto-mocked) MessageManager to return a completed assistant
    // text message, which internalExecute turns into the background-task result.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);
    return instance;
  };

  afterEach(() => {
    for (const file of logFiles) {
      if (fs.existsSync(file)) {
        try {
          fs.unlinkSync(file);
        } catch {
          // best-effort cleanup
        }
      }
    }
  });

  it("pushes a completed snapshot when a backgrounded subagent finishes (regression)", async () => {
    const instance = await createInstance();
    const taskId = await subagentManager.backgroundInstance(
      instance.subagentId,
    );
    logFiles.push(backgroundTaskManager.getTask(taskId)!.outputPath!);

    // The running snapshot was pushed when the task was registered.
    expect(captureStatusFor(taskId)).toBe("running");

    // Run the (backgrounded) subagent to completion.
    await subagentManager.executeAgent(instance, "test prompt");

    // Without the fix the last snapshot still says "running", permanently
    // blocking IDE new-chat / history restore (hasRunningBackgroundTask).
    expect(captureStatusFor(taskId)).toBe("completed");
  });

  it("pushes a completed snapshot when a runInBackground subagent finishes (regression)", async () => {
    const instance = await createInstance();
    const taskId = await subagentManager.executeAgent(
      instance,
      "test prompt",
      undefined,
      true,
    );
    expect(taskId).toBeTruthy();
    logFiles.push(backgroundTaskManager.getTask(taskId)!.outputPath!);

    // executeAgent returns before the background run finishes — the terminal
    // snapshot must arrive once it does.
    await vi.waitFor(() => expect(captureStatusFor(taskId)).toBe("completed"));
  });

  it("pushes a failed snapshot when a backgrounded subagent errors (regression)", async () => {
    const instance = await createInstance();
    const taskId = await subagentManager.backgroundInstance(
      instance.subagentId,
    );
    logFiles.push(backgroundTaskManager.getTask(taskId)!.outputPath!);

    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("AI Error"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("AI Error");

    expect(captureStatusFor(taskId)).toBe("failed");
  });

  it("keeps a stopped subagent task as killed instead of overwriting with failed", async () => {
    const instance = await createInstance();
    const taskId = await subagentManager.backgroundInstance(
      instance.subagentId,
    );
    logFiles.push(backgroundTaskManager.getTask(taskId)!.outputPath!);

    // User stops the task: stopTask marks it killed and pushes a snapshot.
    expect(backgroundTaskManager.stopTask(taskId)).toBe(true);
    expect(captureStatusFor(taskId)).toBe("killed");

    // The in-flight AI run then aborts — surfaced as a thrown error inside
    // internalExecute — which must NOT flip the terminal state to "failed".
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("Aborted"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("Aborted");

    expect(captureStatusFor(taskId)).toBe("killed");
  });

  it("keeps a killed runInBackground subagent as killed after its run resolves", async () => {
    const instance = await createInstance();
    // Make the AI call complete only after the test has a chance to stop it.
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockImplementation(
      () => new Promise<void>((r) => setTimeout(() => r(), 40)),
    );

    const taskId = await subagentManager.executeAgent(
      instance,
      "test prompt",
      undefined,
      true,
    );
    logFiles.push(backgroundTaskManager.getTask(taskId)!.outputPath!);

    // User stops the task while it is still running.
    expect(backgroundTaskManager.stopTask(taskId)).toBe(true);

    // Once the in-flight run resolves, the terminal snapshot must still say
    // killed — neither the internalExecute completion nor the executeAgent
    // background wrapper may flip it back to "completed".
    await vi.waitFor(() => expect(captureStatusFor(taskId)).toBe("killed"));
    expect(backgroundTaskManager.getTask(taskId)?.status).toBe("killed");
  });
});
