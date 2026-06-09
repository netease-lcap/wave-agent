import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import { bashTool } from "../../src/tools/bashTool.js";
import { taskStopTool } from "../../src/tools/taskStopTool.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { ChildProcess } from "child_process";
import { createMockTaskManager } from "../helpers/mockFactories.js";
import { Container } from "../../src/utils/container.js";

// Mock child_process
vi.mock("child_process");

// Mock fs and os
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    accessSync: vi.fn(),
    constants: { F_OK: 0 },
  };
});

vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  };
});

// Mock logger (legacy path — may not intercept actual globalLogger import)
vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock globalLogger — the actual module used by bashTool.ts
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
  clearGlobalLogger: vi.fn(),
  isLoggerConfigured: vi.fn(),
}));

import { spawn } from "child_process";
import { logger } from "../../src/utils/globalLogger.js";
const mockSpawn = vi.mocked(spawn);

describe("bashTool", () => {
  let backgroundTaskManager: BackgroundTaskManager;
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    backgroundTaskManager = new BackgroundTaskManager(container, {
      workdir: "/test/workdir",
    });
    context = {
      backgroundTaskManager,
      workdir: "/test/workdir",
      taskManager: createMockTaskManager(),
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
      expect(result.shortResult).toBe("test output");
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const spawnCallArgs = mockSpawn.mock.calls[0];
      expect(typeof spawnCallArgs[0]).toBe("string");
      expect(spawnCallArgs[0]).toContain("echo hello");
      expect(spawnCallArgs[0]).toContain("pwd -P");
      expect(spawnCallArgs[1]).toMatchObject({
        shell: true,
        stdio: "pipe",
        cwd: "/test/workdir",
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
        /Command started in background with ID: task_\d+_\d+/,
      );
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
      expect(result.shortResult).toBe("error message");
      expect(result.error).toBe("Command failed with exit code: 1");
    });

    it("should handle abort signal and persist large output", async () => {
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
        taskManager: createMockTaskManager(),
      };

      // Start the command execution
      const promise = bashTool.execute(
        {
          command: "sleep 10",
        },
        testContext,
      );

      // Wait for some output to accumulate
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Abort
      abortController.abort();

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toBe("Command execution was aborted");
      expect(result.content).toContain("<persisted-output>");
      expect(result.content).toContain("Full output saved to:");
      expect(result.content).toContain("</persisted-output>");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("wave-tool-results"),
        largeOutput,
        "utf8",
      );
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

    it("should auto-background on timeout for allowed commands", async () => {
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
          command: "long-build",
          timeout: 1000,
        },
        context,
      );

      vi.advanceTimersByTime(1001);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.content).toContain("timed out after 1 seconds");
      expect(result.content).toContain("moved to background");
      expect(result.shortResult).toContain("auto-backgrounded (timeout)");
      vi.useRealTimers();
    });

    it("should kill on timeout for sleep commands (not auto-backgrounded)", async () => {
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
      expect(result.content).toBe("Command timed out");
      vi.useRealTimers();
    });

    it("should auto-background on timeout with existing output", async () => {
      vi.useFakeTimers();
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(() => callback(Buffer.from("some output")), 10);
            }
          }),
        },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        killed: false,
      };
      mockSpawn.mockReturnValue(mockProcess as unknown as ChildProcess);

      const promise = bashTool.execute(
        {
          command: "long-build",
          timeout: 1000,
        },
        context,
      );

      // Trigger the stdout callback
      vi.advanceTimersByTime(50);

      vi.advanceTimersByTime(1001);
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.content).toContain("moved to background");
      vi.useRealTimers();
    });

    it("should handle large output truncation and persistence", async () => {
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
      expect(result.content).toContain("<persisted-output>");
      expect(result.content).toContain("Full output saved to:");
      expect(result.content).toContain("</persisted-output>");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("wave-tool-results"),
        largeOutput,
        "utf8",
      );
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
      expect(result.error).toContain(
        "operation denied by user, reason: No way",
      );
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
        getTask: vi.fn().mockReturnValue({ outputPath: "/tmp/test.log" }),
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

    it("should format shortResult with last 3 lines and summary for long output", async () => {
      const longOutput = "line1\nline2\nline3\nline4\nline5";
      const mockProcess = {
        pid: 1234,
        stdout: {
          on: vi.fn((event, callback) => {
            if (event === "data") {
              setTimeout(() => callback(Buffer.from(longOutput)), 10);
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
        { command: "long-output" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.shortResult).toBe("... +2 lines\nline3\nline4\nline5");
    });
  });

  describe("CWD reset when outside safe zone", () => {
    const createMockProcess = (exitCode: number, newCwd: string) => {
      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn((event: string, callback: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => {
              // Simulate the temp CWD file being written
              vi.mocked(fs.existsSync).mockReturnValue(true);
              vi.mocked(fs.readFileSync).mockReturnValue(newCwd + "\n");
              callback(exitCode);
            }, 10);
          }
        }),
        kill: vi.fn(),
        killed: false,
      };
      return mockProcess;
    };

    it("should accept CWD when inside safe zone", async () => {
      const mockOnCwdChange = vi.fn();
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
        isPathInSafeZone: vi.fn().mockReturnValue(true),
      };
      const testContext: ToolContext = {
        ...context,
        onCwdChange: mockOnCwdChange,
        originalWorkdir: "/test/workdir",
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      };

      mockSpawn.mockReturnValue(
        createMockProcess(0, "/test/workdir/subdir") as unknown as ChildProcess,
      );

      const result = await bashTool.execute(
        { command: "cd subdir" },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(mockOnCwdChange).toHaveBeenCalledWith("/test/workdir/subdir");
      expect(result.content).not.toContain("Shell cwd was reset to");
    });

    it("should reset CWD to originalWorkdir when outside safe zone", async () => {
      const mockOnCwdChange = vi.fn();
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
        isPathInSafeZone: vi.fn().mockReturnValue(false),
      };
      const testContext: ToolContext = {
        ...context,
        onCwdChange: mockOnCwdChange,
        originalWorkdir: "/test/workdir",
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      };

      mockSpawn.mockReturnValue(
        createMockProcess(
          0,
          "/home/liuyiqi/other-dir",
        ) as unknown as ChildProcess,
      );

      const result = await bashTool.execute(
        { command: "cd /home/liuyiqi/other-dir" },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(mockOnCwdChange).toHaveBeenCalledWith("/test/workdir");
      expect(result.content).toContain("Shell cwd was reset to /test/workdir");
    });

    it("should accept CWD when no permissionManager (backward compatible)", async () => {
      const mockOnCwdChange = vi.fn();
      const testContext: ToolContext = {
        ...context,
        onCwdChange: mockOnCwdChange,
        originalWorkdir: "/test/workdir",
      };

      mockSpawn.mockReturnValue(
        createMockProcess(0, "/test/workdir/subdir") as unknown as ChildProcess,
      );

      const result = await bashTool.execute(
        { command: "cd subdir" },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(mockOnCwdChange).toHaveBeenCalledWith("/test/workdir/subdir");
    });

    it("should accept CWD when outside safe zone but no originalWorkdir", async () => {
      const mockOnCwdChange = vi.fn();
      const mockPermissionManager = {
        createContext: vi.fn().mockReturnValue({}),
        checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
        isPathInSafeZone: vi.fn().mockReturnValue(false),
      };
      const testContext: ToolContext = {
        ...context,
        onCwdChange: mockOnCwdChange,
        permissionManager:
          mockPermissionManager as unknown as ToolContext["permissionManager"],
      };

      mockSpawn.mockReturnValue(
        createMockProcess(0, "/some/other/dir") as unknown as ChildProcess,
      );

      const result = await bashTool.execute(
        { command: "cd /some/other/dir" },
        testContext,
      );

      expect(result.success).toBe(true);
      expect(mockOnCwdChange).toHaveBeenCalledWith("/some/other/dir");
      expect(result.content).not.toContain("Shell cwd was reset to");
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

      const taskId = bashResult.content.match(/task_\d+_\d+/)?.[0];
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

      const taskId = bashResult.content.match(/task_\d+_\d+/)?.[0];
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

  describe("ESRCH handling in force-kill timeout (abort path)", () => {
    let mockKill: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockKill = vi.spyOn(process, "kill").mockReturnValue(true as never);
    });

    afterEach(() => {
      mockKill.mockRestore();
    });

    it("should not log error when SIGKILL throws ESRCH after abort (process already exited)", async () => {
      vi.useFakeTimers();

      mockKill.mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === "SIGKILL") {
          const error: NodeJS.ErrnoException = new Error("kill ESRCH");
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }) as never);

      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
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
        taskManager: createMockTaskManager(),
      };

      const promise = bashTool.execute({ command: "sleep 10" }, testContext);

      // Abort triggers the force-kill path
      abortController.abort();

      // Advance past the 1-second force-kill timeout
      vi.advanceTimersByTime(1000);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it("should log error when SIGKILL throws a non-ESRCH error after abort", async () => {
      vi.useFakeTimers();

      mockKill.mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === "SIGKILL") {
          const error: NodeJS.ErrnoException = new Error("kill EPERM");
          error.code = "EPERM";
          throw error;
        }
        return true;
      }) as never);

      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
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
        taskManager: createMockTaskManager(),
      };

      const promise = bashTool.execute({ command: "sleep 10" }, testContext);

      abortController.abort();
      vi.advanceTimersByTime(1000);

      await promise;

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to force kill process:",
        expect.objectContaining({ code: "EPERM" }),
      );

      vi.useRealTimers();
    });

    it("should not log error when SIGKILL succeeds after abort (no throw)", async () => {
      vi.useFakeTimers();

      // Default mock — no throw, SIGKILL succeeds
      const mockProcess = {
        pid: 1234,
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
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
        taskManager: createMockTaskManager(),
      };

      const promise = bashTool.execute({ command: "sleep 10" }, testContext);

      abortController.abort();
      vi.advanceTimersByTime(1000);

      const result = await promise;
      expect(result.success).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
