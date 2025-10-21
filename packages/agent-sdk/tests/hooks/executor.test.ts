/**
 * Hook Executor Unit Tests
 *
 * Tests command execution with mocked child processes, timeout handling,
 * environment variable injection, and cross-platform compatibility.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockedFunction,
} from "vitest";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { HookExecutor } from "../../src/hooks/executor.js";
import type { HookExecutionContext } from "../../src/hooks/types.js";

// Mock child_process module
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

const mockSpawn = spawn as unknown as MockedFunction<
  (...args: Parameters<typeof spawn>) => MockChildProcess
>;

// Mock child process that extends EventEmitter
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  pid?: number;

  kill(signal?: string) {
    this.killed = true;
    // Simulate process termination
    setTimeout(() => this.emit("close", signal === "SIGKILL" ? -9 : -15), 10);
  }

  // Add other ChildProcess methods as no-ops to satisfy the interface
  disconnect() {}
  unref() {}
  ref() {}
}

describe("HookExecutor", () => {
  let executor: HookExecutor;
  let mockContext: HookExecutionContext;

  beforeEach(() => {
    executor = new HookExecutor();
    mockContext = {
      event: "PostToolUse",
      toolName: "Edit",
      projectDir: "/test/project",
      timestamp: new Date("2024-01-01T00:00:00Z"),
    };

    vi.clearAllMocks();
  });

  describe("command execution", () => {
    it("should execute successful command", async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      // Start execution
      const resultPromise = executor.executeCommand(
        'echo "hello"',
        mockContext,
      );

      // Simulate successful execution
      setTimeout(() => {
        mockProcess.stdout.emit("data", "hello\n");
        mockProcess.emit("close", 0);
      }, 10);

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBeUndefined();
      expect(result.timedOut).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
    });

    it("should handle command failure", async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executor.executeCommand("false", mockContext);

      setTimeout(() => {
        mockProcess.stderr.emit("data", "command failed\n");
        mockProcess.emit("close", 1);
      }, 10);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toBe("command failed");
      expect(result.timedOut).toBe(false);
    });

    it("should handle process errors", async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executor.executeCommand(
        "nonexistent-command",
        mockContext,
      );

      setTimeout(() => {
        mockProcess.emit("error", new Error("Command not found"));
      }, 10);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.stderr).toBe("Command not found");
      expect(result.timedOut).toBe(false);
    });
  });

  describe("timeout handling", () => {
    it("should timeout long-running commands", async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executor.executeCommand("sleep 30", mockContext, {
        timeout: 100,
      });

      // Don't emit close event to simulate hanging process

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(mockProcess.killed).toBe(true);
    });

    it("should respect custom timeout values", async () => {
      const mockProcess = new MockChildProcess();
      mockSpawn.mockReturnValue(mockProcess);

      const startTime = Date.now();
      const resultPromise = executor.executeCommand("sleep 1", mockContext, {
        timeout: 50,
      });

      const result = await resultPromise;
      const duration = Date.now() - startTime;

      expect(result.timedOut).toBe(true);
      expect(duration).toBeLessThan(100); // Should timeout quickly
    });

    it("should use default timeout when not specified", async () => {
      const stats = executor.getExecutionStats();
      expect(stats.defaultTimeout).toBe(10000);
      expect(stats.maxTimeout).toBe(300000);
    });
  });

  describe("command safety validation", () => {
    it("should allow safe commands", () => {
      expect(executor.isCommandSafe('echo "hello"')).toBe(true);
      expect(executor.isCommandSafe("ls -la")).toBe(true);
      expect(executor.isCommandSafe("npm test")).toBe(true);
      expect(executor.isCommandSafe("eslint --fix src/")).toBe(true);
      expect(executor.isCommandSafe("prettier --write .")).toBe(true);
    });

    it("should reject dangerous commands", () => {
      expect(executor.isCommandSafe("rm -rf /")).toBe(false);
      expect(executor.isCommandSafe("rm -rf ~")).toBe(false);
      expect(executor.isCommandSafe("rm -rf *")).toBe(false);
      expect(executor.isCommandSafe("dd if=/dev/zero")).toBe(false);
      expect(executor.isCommandSafe(":(){ :|:& };:")).toBe(false); // Fork bomb
      expect(executor.isCommandSafe("eval $(malicious)")).toBe(false);
      expect(executor.isCommandSafe("exec dangerous")).toBe(false);
    });

    it("should reject invalid command inputs", () => {
      expect(executor.isCommandSafe("")).toBe(false);
      expect(executor.isCommandSafe("   ")).toBe(false);
      // Test with invalid input - these should be safe by design
      expect(executor.isCommandSafe("")).toBe(false);
      expect(executor.isCommandSafe(" ")).toBe(false);
    });
  });

  describe("environment variables", () => {
    it("should inject required environment variables", async () => {
      const mockProcess = new MockChildProcess();
      let spawnEnv: NodeJS.ProcessEnv | undefined;

      mockSpawn.mockImplementation((command, args, options) => {
        spawnEnv = options?.env;
        return mockProcess;
      });

      const resultPromise = executor.executeCommand(
        "echo $WAVE_PROJECT_DIR",
        mockContext,
      );

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await resultPromise;

      expect(spawnEnv).toBeDefined();
      expect(spawnEnv!.WAVE_PROJECT_DIR).toBe("/test/project");
      expect(spawnEnv!.WAVE_HOOK_EVENT).toBe("PostToolUse");
      expect(spawnEnv!.WAVE_TOOL_NAME).toBe("Edit");
      expect(spawnEnv!.WAVE_TIMESTAMP).toBe("2024-01-01T00:00:00.000Z");
    });

    it("should resolve environment variables in commands", async () => {
      const mockProcess = new MockChildProcess();
      let actualCommand: string | undefined;

      mockSpawn.mockImplementation((shell, args) => {
        actualCommand = args?.[1]; // Command is typically the second argument
        return mockProcess;
      });

      const resultPromise = executor.executeCommand(
        'ls "$WAVE_PROJECT_DIR"/src',
        mockContext,
      );

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await resultPromise;

      expect(actualCommand).toContain('"/test/project"/src');
    });

    it("should handle context without tool name", async () => {
      const mockProcess = new MockChildProcess();
      let spawnEnv: NodeJS.ProcessEnv | undefined;

      mockSpawn.mockImplementation((command, args, options) => {
        spawnEnv = options?.env;
        return mockProcess;
      });

      const contextWithoutTool: HookExecutionContext = {
        ...mockContext,
        toolName: undefined,
      };

      const resultPromise = executor.executeCommand(
        "echo test",
        contextWithoutTool,
      );

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await resultPromise;

      expect(spawnEnv!.WAVE_TOOL_NAME).toBe("");
    });
  });

  describe("multiple commands execution", () => {
    it("should execute multiple commands in sequence", async () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const resultPromise = executor.executeCommands(
        ['echo "first"', 'echo "second"'],
        mockContext,
      );

      // Simulate first command success
      setTimeout(() => {
        mockProcess1.stdout.emit("data", "first\n");
        mockProcess1.emit("close", 0);
      }, 10);

      // Simulate second command success
      setTimeout(() => {
        mockProcess2.stdout.emit("data", "second\n");
        mockProcess2.emit("close", 0);
      }, 20);

      const results = await resultPromise;

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].stdout).toBe("first");
      expect(results[1].success).toBe(true);
      expect(results[1].stdout).toBe("second");
    });

    it("should stop on first command failure", async () => {
      const mockProcess1 = new MockChildProcess();

      mockSpawn.mockReturnValueOnce(mockProcess1);

      const resultPromise = executor.executeCommands(
        ["false", 'echo "should not run"'],
        mockContext,
      );

      setTimeout(() => {
        mockProcess1.emit("close", 1);
      }, 10);

      const results = await resultPromise;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(mockSpawn).toHaveBeenCalledTimes(1); // Second command should not be executed
    });
  });

  describe("cross-platform support", () => {
    it("should use correct shell for Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      const mockProcess = new MockChildProcess();
      let spawnArgs: Parameters<typeof spawn> | undefined;

      mockSpawn.mockImplementation((...args) => {
        spawnArgs = args as Parameters<typeof spawn>;
        return mockProcess;
      });

      const resultPromise = executor.executeCommand("echo test", mockContext);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await resultPromise;

      expect(spawnArgs).toBeDefined();
      expect(spawnArgs![0]).toBe("cmd.exe");
      expect(spawnArgs![1]).toEqual(["/c", "echo test"]);

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("should use correct shell for Unix systems", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux" });

      const mockProcess = new MockChildProcess();
      let spawnArgs: Parameters<typeof spawn> | undefined;

      mockSpawn.mockImplementation((...args) => {
        spawnArgs = args as Parameters<typeof spawn>;
        return mockProcess;
      });

      const resultPromise = executor.executeCommand("echo test", mockContext);

      setTimeout(() => {
        mockProcess.emit("close", 0);
      }, 10);

      await resultPromise;

      expect(spawnArgs).toBeDefined();
      expect(spawnArgs![0]).toBe("/bin/sh");
      expect(spawnArgs![1]).toEqual(["-c", "echo test"]);

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("utility methods", () => {
    it("should provide execution statistics", () => {
      const stats = executor.getExecutionStats();

      expect(stats).toHaveProperty("platform");
      expect(stats).toHaveProperty("defaultTimeout");
      expect(stats).toHaveProperty("maxTimeout");
      expect(typeof stats.platform).toBe("string");
      expect(typeof stats.defaultTimeout).toBe("number");
      expect(typeof stats.maxTimeout).toBe("number");
    });

    it("should report platform support", () => {
      expect(executor.isSupported()).toBe(true);
    });
  });
});
