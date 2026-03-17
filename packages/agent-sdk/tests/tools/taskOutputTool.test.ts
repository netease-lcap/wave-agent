import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskOutputTool } from "../../src/tools/taskOutputTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { BackgroundShell } from "../../src/types/processes.js";
import { Container } from "../../src/utils/container.js";

describe("TaskOutput Tool Improvements", () => {
  let backgroundTaskManager: BackgroundTaskManager;
  let context: ToolContext;
  const container = new Container();

  beforeEach(() => {
    backgroundTaskManager = new BackgroundTaskManager(container, {
      workdir: "/test/workdir",
    });
    context = {
      backgroundTaskManager,
      workdir: "/test/workdir",
      taskManager: new TaskManager(container, "test-session"),
    };
  });

  it("should include outputPath in content and metadata when truncated", async () => {
    const taskId = "test_task";
    const longOutput = "A".repeat(30001);
    const outputPath = "/tmp/test.log";

    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "completed",
      startTime: Date.now(),
      command: "echo long",
      stdout: longOutput,
      stderr: "",
      outputPath,
      process: { kill: vi.fn() } as unknown as BackgroundShell["process"],
    });

    const result = await taskOutputTool.execute(
      {
        task_id: taskId,
        block: false,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("... (output truncated)");
    expect(result.content).toContain(`Full output available at: ${outputPath}`);
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.outputPath).toBe(outputPath);
    expect(result.metadata?.status).toBe("completed");
    expect(result.metadata?.type).toBe("shell");
  });

  it("should include exit code in shortResult and metadata when failed", async () => {
    const taskId = "test_task";
    const exitCode = 127;

    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "failed",
      startTime: Date.now(),
      command: "invalid_command",
      stdout: "",
      stderr: "command not found",
      exitCode,
      process: { kill: vi.fn() } as unknown as BackgroundShell["process"],
    });

    const result = await taskOutputTool.execute(
      {
        task_id: taskId,
        block: false,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.shortResult).toBe(
      `${taskId}: failed (exit code: ${exitCode})`,
    );
    expect(result.metadata?.exitCode).toBe(exitCode);
  });

  it("should work with block=false for running tasks", async () => {
    const taskId = "test_task";

    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "running",
      startTime: Date.now(),
      command: "sleep 100",
      stdout: "still running",
      stderr: "",
      process: { kill: vi.fn() } as unknown as BackgroundShell["process"],
    });

    const result = await taskOutputTool.execute(
      {
        task_id: taskId,
        block: false,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("still running");
    expect(result.shortResult).toBe(`${taskId}: running`);
    expect(result.metadata?.status).toBe("running");
  });
});
