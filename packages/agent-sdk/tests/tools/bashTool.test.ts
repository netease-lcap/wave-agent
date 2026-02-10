import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { bashTool } from "../../src/tools/bashTool.js";
import { taskOutputTool } from "../../src/tools/taskOutputTool.js";
import { taskStopTool } from "../../src/tools/taskStopTool.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { ChildProcess } from "child_process";

// Mock child_process
vi.mock("child_process");

// Mock logger
vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { spawn } from "child_process";
const mockSpawn = vi.mocked(spawn);

describe("bashTool", () => {
  let backgroundTaskManager: BackgroundTaskManager;
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    backgroundTaskManager = new BackgroundTaskManager({
      workdir: "/test/workdir",
    });
    context = {
      backgroundTaskManager,
      workdir: "/test/workdir",
    };
  });

  afterEach(() => {
    // Clean up any background processes
    backgroundTaskManager.cleanup();
  });

  describe("Bash tool", () => {
    it("should execute command in foreground by default", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(() => callback(Buffer.from("test output")), 10);
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === "exit") {
            setTimeout(() => callback(0), 20);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await bashTool.execute(
        {
          command: "echo hello",
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("test output");
      expect(mockSpawn).toHaveBeenCalledWith("echo hello", {
        shell: true,
        stdio: "pipe",
        cwd: "/test/workdir",
        env: expect.any(Object),
      });
    });

    it("should handle background execution", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await bashTool.execute(
        {
          command: "long-running-command",
          run_in_background: true,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toMatch(
        /Command started in background with ID: task_\d+/,
      );
      expect(result.content).toContain("task_id=");
    });

    it("should validate command parameter", async () => {
      const result = await bashTool.execute({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "Command parameter is required and must be a string",
      );
    });

    it("should validate timeout parameter", async () => {
      const result = await bashTool.execute(
        {
          command: "echo hello",
          timeout: 700000, // Exceeds max timeout
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "Timeout must be a number between 0 and 600000 milliseconds",
      );
    });

    it("should handle command failure", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(() => callback(Buffer.from("error message")), 10);
            }
          }),
        },
        on: vi.fn((event, callback) => {
          if (event === "exit") {
            setTimeout(() => callback(1), 20);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await bashTool.execute(
        {
          command: "false",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.content).toBe("\nerror message");
      expect(result.error).toBe("Command failed with exit code: 1");
    });

    it("should handle abort signal", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const abortController = new AbortController();
      const testContext: ToolContext = {
        abortSignal: abortController.signal,
        backgroundTaskManager,
        workdir: "/test/workdir",
      };

      // Start the command execution
      const promise = bashTool.execute(
        {
          command: "sleep 10",
        },
        testContext,
      );

      // Abort immediately
      abortController.abort();

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command execution was aborted");
    });

    it("should format compact params correctly", () => {
      const params1 = { command: "echo hello" };
      const result1 = bashTool.formatCompactParams?.(params1, context);
      expect(result1).toBe("echo hello");

      const params2 = { command: "echo hello", run_in_background: true };
      const result2 = bashTool.formatCompactParams?.(params2, context);
      expect(result2).toBe("echo hello (background)");

      const params3 = { command: "echo hello", description: "say hello" };
      const result3 = bashTool.formatCompactParams?.(params3, context);
      expect(result3).toBe("say hello");
    });

    it("should handle command timeout", async () => {
      vi.useFakeTimers();
      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const promise = bashTool.execute(
        {
          command: "sleep 10",
          timeout: 1000,
        },
        context,
      );

      vi.advanceTimersByTime(1001);
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command timed out");
      vi.useRealTimers();
    });

    it("should handle large output truncation", async () => {
      const largeOutput = "a".repeat(30001);
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(() => callback(Buffer.from(largeOutput)), 10);
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === "exit") {
            setTimeout(() => callback(0), 20);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await bashTool.execute(
        { command: "large-output" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content.length).toBeLessThanOrEqual(30000 + 24); // 30000 + "\n\n... (output truncated)".length
      expect(result.content).toContain("... (output truncated)");
    });

    it("should handle permission denial", async () => {
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi
          .fn()
          .mockResolvedValue({ behavior: "deny", message: "No way" }),
      };
      const testContext = {
        ...context,
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      };

      const result = await bashTool.execute({ command: "ls" }, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("operation denied, reason: No way");
    });

    it("should handle permission check failure", async () => {
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi.fn().mockRejectedValue(new Error("Check failed")),
      };
      const testContext = {
        ...context,
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      };

      const result = await bashTool.execute({ command: "ls" }, testContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission check failed");
    });

    it("should handle background adoption", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      let backgroundHandler: (() => Promise<void>) | undefined;
      const mockForegroundTaskManager = {
        registerForegroundTask: vi.fn(({ backgroundHandler: handler }) => {
          backgroundHandler = handler;
        }),
        unregisterForegroundTask: vi.fn(),
      };
      const mockBackgroundTaskManager = {
        adoptProcess: vi.fn().mockReturnValue("task_adopted"),
      };

      const testContext = {
        ...context,
        foregroundTaskManager:
          mockForegroundTaskManager as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager:
          mockBackgroundTaskManager as unknown as ToolContext["backgroundTaskManager"],
      };

      const executePromise = bashTool.execute({ command: "long" }, testContext);

      // Trigger backgrounding
      await backgroundHandler!();

      const result = await executePromise;
      expect(result.success).toBe(true);
      expect(result.content).toContain(
        "Command moved to background with ID: task_adopted",
      );
      expect(mockBackgroundTaskManager.adoptProcess).toHaveBeenCalled();
    });

    it("should handle spawn error", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event, callback) => {
          if (event === "error") {
            setTimeout(() => callback(new Error("spawn failed")), 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const result = await bashTool.execute({ command: "fail" }, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Failed to execute command: spawn failed");
    });
  });

  describe("TaskOutput tool", () => {
    it("should retrieve output from background shell", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(
                () => callback(Buffer.from("output from bg process")),
                10,
              );
            }
          }),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === "exit") {
            setTimeout(() => callback(0), 50);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      // Start background process
      const bashResult = await bashTool.execute(
        {
          command: "echo hello",
          run_in_background: true,
        },
        context,
      );

      expect(bashResult.success).toBe(true);
      const taskId = bashResult.content.match(/task_(\d+)/)?.[0];
      expect(taskId).toBeDefined();

      // Wait a bit for output to accumulate
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Get output
      const outputResult = await taskOutputTool.execute(
        {
          task_id: taskId!,
        },
        context,
      );

      expect(outputResult.success).toBe(true);
      expect(outputResult.content).toBe("output from bg process");
    });

    it("should handle non-existent task ID", async () => {
      const result = await taskOutputTool.execute(
        {
          task_id: "task_999",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Task with ID task_999 not found");
    });

    it("should validate task_id parameter", async () => {
      const result = await taskOutputTool.execute({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "task_id parameter is required and must be a string",
      );
    });

    it("should format compact params correctly", () => {
      const params1 = { task_id: "task_1" };
      const result1 = taskOutputTool.formatCompactParams?.(params1, context);
      expect(result1).toBe("task_1");

      const params2 = { task_id: "task_1", block: true };
      const result2 = taskOutputTool.formatCompactParams?.(params2, context);
      expect(result2).toBe("task_1 (blocking)");
    });
  });

  describe("TaskStop tool", () => {
    it("should kill running background shell", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      // Start background process
      const bashResult = await bashTool.execute(
        {
          command: "sleep 100",
          run_in_background: true,
        },
        context,
      );

      const taskId = bashResult.content.match(/task_(\d+)/)?.[0];
      expect(taskId).toBeDefined();

      // Kill the process
      const stopResult = await taskStopTool.execute(
        {
          task_id: taskId!,
        },
        context,
      );

      expect(stopResult.success).toBe(true);
      expect(stopResult.content).toBe(`Task ${taskId} has been stopped`);
    });

    it("should handle non-existent task ID", async () => {
      const result = await taskStopTool.execute(
        {
          task_id: "task_999",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Task with ID task_999 not found");
    });

    it("should handle already completed shell", async () => {
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn(),
        },
        stderr: {
          on: vi.fn(),
        },
        on: vi.fn((event, callback) => {
          if (event === "exit") {
            setTimeout(() => callback(0), 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };

      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      // Start background process that completes quickly
      const bashResult = await bashTool.execute(
        {
          command: "echo hello",
          run_in_background: true,
        },
        context,
      );

      const taskId = bashResult.content.match(/task_(\d+)/)?.[0];
      expect(taskId).toBeDefined();

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Try to kill completed process
      const stopResult = await taskStopTool.execute(
        {
          task_id: taskId!,
        },
        context,
      );

      expect(stopResult.success).toBe(false);
      expect(stopResult.error).toContain("Failed to stop task");
    });

    it("should validate task_id parameter", async () => {
      const result = await taskStopTool.execute({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "task_id parameter is required and must be a string",
      );
    });

    it("should format compact params correctly", () => {
      const params = { task_id: "task_1" };
      const result = taskStopTool.formatCompactParams?.(params, context);
      expect(result).toBe("task_1");
    });
  });
});
