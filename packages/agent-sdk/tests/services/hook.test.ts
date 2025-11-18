/**
 * Hook Services Unit Tests
 *
 * Consolidated tests for hook execution and settings functionality.
 * Tests command execution, configuration loading, and service integration.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockedFunction,
} from "vitest";
import { spawn } from "child_process";
import { EventEmitter } from "events";
import { existsSync, readFileSync } from "fs";

import {
  executeCommand,
  executeCommands,
  isCommandSafe,
  loadHooksConfigFromFile,
  loadMergedHooksConfig,
} from "../../src/services/hook.js";
import type {
  HookExecutionContext,
  HookConfiguration,
} from "../../src/types/hooks.js";

// Mock child_process module
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock fs module to enable selective control in tests
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const mockSpawn = spawn as unknown as MockedFunction<
  (...args: Parameters<typeof spawn>) => MockChildProcess
>;

const mockExistsSync = existsSync as MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as MockedFunction<typeof readFileSync>;

// Mock child process that extends EventEmitter
class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = new EventEmitter();
  killed = false;
  pid?: number;

  kill(signal?: string) {
    this.killed = true;
    // Simulate process termination immediately
    setImmediate(() => this.emit("close", signal === "SIGKILL" ? -9 : -15));
  }

  // Add other ChildProcess methods as no-ops to satisfy the interface
  disconnect() {}
  unref() {}
  ref() {}
}

// Mock stdin that can be written to and ended
class MockStdin extends EventEmitter {
  write() {
    return true;
  }
  end() {
    return;
  }
}

describe("Hook Services", () => {
  let mockContext: HookExecutionContext;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Enable hooks execution testing in this test suite
    process.env.TEST_HOOK_EXECUTION = "true";

    mockContext = {
      event: "PostToolUse",
      toolName: "Edit",
      projectDir: "/test/project",
      timestamp: new Date("2024-01-01T00:00:00Z"),
    };

    // Mock console.warn to prevent stderr output
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up environment variable
    delete process.env.TEST_HOOK_EXECUTION;

    // Restore console.warn
    consoleWarnSpy?.mockRestore();
  });

  describe("command execution", () => {
    it("should execute successful command", async () => {
      const mockStartTime = 1000;
      const mockEndTime = 1050; // 50ms duration

      // Mock Date.now to control timing
      const mockDateNow = vi.spyOn(Date, "now");
      mockDateNow
        .mockReturnValueOnce(mockStartTime) // Called at start
        .mockReturnValueOnce(mockEndTime); // Called at end

      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      mockSpawn.mockReturnValue(mockProcess);

      // Start execution
      const resultPromise = executeCommand('echo "hello"', mockContext);

      // Simulate successful execution immediately
      setImmediate(() => {
        mockProcess.stdout.emit("data", "hello\n");
        mockProcess.emit("close", 0);
      });

      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("");
      expect(result.timedOut).toBe(false);
      expect(result.duration).toBe(50);

      mockDateNow.mockRestore();
    });

    it("should handle command failure", async () => {
      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executeCommand("false", mockContext);

      setImmediate(() => {
        mockProcess.stderr.emit("data", "command failed\n");
        mockProcess.emit("close", 1);
      });

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("command failed");
      expect(result.timedOut).toBe(false);
    });

    it("should handle process errors", async () => {
      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executeCommand("nonexistent-command", mockContext);

      setImmediate(() => {
        mockProcess.emit("error", new Error("Command not found"));
      });

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.stderr).toBe("Command not found");
      expect(result.timedOut).toBe(false);
    });

    it("should return mock result when execution is skipped", async () => {
      // Clean up the execution flag to test skip behavior
      delete process.env.TEST_HOOK_EXECUTION;

      const result = await executeCommand("echo test", mockContext);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.duration).toBe(0);
      expect(result.timedOut).toBe(false);
    });
  });

  describe("timeout handling", () => {
    it("should timeout long-running commands", async () => {
      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      mockSpawn.mockReturnValue(mockProcess);

      const resultPromise = executeCommand("sleep 30", mockContext, {
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
      mockProcess.stdin = new MockStdin();
      mockSpawn.mockReturnValue(mockProcess);

      const startTime = Date.now();
      const resultPromise = executeCommand("sleep 1", mockContext, {
        timeout: 50,
      });

      const result = await resultPromise;
      const duration = Date.now() - startTime;

      expect(result.timedOut).toBe(true);
      expect(duration).toBeLessThan(100); // Should timeout quickly
    });
  });

  describe("command safety validation", () => {
    it("should allow safe commands", () => {
      expect(isCommandSafe('echo "hello"')).toBe(true);
      expect(isCommandSafe("ls -la")).toBe(true);
      expect(isCommandSafe("npm test")).toBe(true);
      expect(isCommandSafe("eslint --fix src/")).toBe(true);
      expect(isCommandSafe("prettier --write .")).toBe(true);
    });

    it("should reject dangerous commands", () => {
      expect(isCommandSafe("rm -rf /")).toBe(false);
      expect(isCommandSafe("sudo rm")).toBe(false);
      expect(isCommandSafe("> /dev/sda")).toBe(false);
      expect(isCommandSafe("dd if=/dev/zero of=/dev/sda")).toBe(false);
      expect(isCommandSafe("mkfs")).toBe(false);
      expect(isCommandSafe("fdisk")).toBe(false);
      expect(isCommandSafe("format c:")).toBe(false);
    });

    it("should handle empty commands", () => {
      expect(isCommandSafe("")).toBe(true);
      expect(isCommandSafe("   ")).toBe(true);
    });
  });

  describe("environment variables", () => {
    it("should inject required environment variables", async () => {
      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      let spawnEnv: NodeJS.ProcessEnv | undefined;

      mockSpawn.mockImplementation((command, args, options) => {
        spawnEnv = options?.env;
        return mockProcess;
      });

      const resultPromise = executeCommand(
        "echo $HOOK_PROJECT_DIR",
        mockContext,
      );

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      await resultPromise;

      expect(spawnEnv).toBeDefined();
      expect(spawnEnv!.HOOK_EVENT).toBe("PostToolUse");
      expect(spawnEnv!.HOOK_TOOL_NAME).toBe("Edit");
      expect(spawnEnv!.HOOK_PROJECT_DIR).toBe("/test/project");
    });

    it("should handle context without tool name", async () => {
      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();

      mockSpawn.mockImplementation(() => {
        return mockProcess;
      });

      const contextWithoutTool: HookExecutionContext = {
        ...mockContext,
        toolName: undefined,
      };

      const resultPromise = executeCommand("echo test", contextWithoutTool);

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      const result = await resultPromise;

      expect(result.success).toBe(true);
    });
  });

  describe("multiple commands execution", () => {
    it("should execute multiple commands in sequence", async () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      mockProcess1.stdin = new MockStdin();
      mockProcess2.stdin = new MockStdin();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const resultPromise = executeCommands(
        ['echo "first"', 'echo "second"'],
        mockContext,
      );

      // Simulate first command success
      setImmediate(() => {
        mockProcess1.stdout.emit("data", "first\n");
        mockProcess1.emit("close", 0);
      });

      // Simulate second command success
      setImmediate(() => {
        mockProcess2.stdout.emit("data", "second\n");
        mockProcess2.emit("close", 0);
      });

      const results = await resultPromise;

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[0].stdout).toBe("first");
      expect(results[1].success).toBe(true);
      expect(results[1].stdout).toBe("second");
    });

    it("should stop on first command failure", async () => {
      const mockProcess1 = new MockChildProcess();
      mockProcess1.stdin = new MockStdin();

      mockSpawn.mockReturnValueOnce(mockProcess1);

      const resultPromise = executeCommands(
        ["false", 'echo "should not run"'],
        mockContext,
      );

      setImmediate(() => {
        mockProcess1.emit("close", 1);
      });

      const results = await resultPromise;

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(mockSpawn).toHaveBeenCalledTimes(1); // Second command should not be executed
    });

    it("should continue on failure when continueOnFailure is set", async () => {
      const mockProcess1 = new MockChildProcess();
      const mockProcess2 = new MockChildProcess();
      mockProcess1.stdin = new MockStdin();
      mockProcess2.stdin = new MockStdin();

      mockSpawn
        .mockReturnValueOnce(mockProcess1)
        .mockReturnValueOnce(mockProcess2);

      const resultPromise = executeCommands(
        ["false", 'echo "should run"'],
        mockContext,
        { continueOnFailure: true },
      );

      setImmediate(() => {
        mockProcess1.emit("close", 1);
      });

      setImmediate(() => {
        mockProcess2.stdout.emit("data", "should run\n");
        mockProcess2.emit("close", 0);
      });

      const results = await resultPromise;

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true);
      expect(results[1].stdout).toBe("should run");
    });
  });

  describe("cross-platform support", () => {
    it("should use correct shell for Windows", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32" });

      const mockProcess = new MockChildProcess();
      mockProcess.stdin = new MockStdin();
      let spawnArgs: Parameters<typeof spawn> | undefined;

      mockSpawn.mockImplementation((...args) => {
        spawnArgs = args as Parameters<typeof spawn>;
        return mockProcess;
      });

      const resultPromise = executeCommand("echo test", mockContext);

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

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
      mockProcess.stdin = new MockStdin();
      let spawnArgs: Parameters<typeof spawn> | undefined;

      mockSpawn.mockImplementation((...args) => {
        spawnArgs = args as Parameters<typeof spawn>;
        return mockProcess;
      });

      const resultPromise = executeCommand("echo test", mockContext);

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      await resultPromise;

      expect(spawnArgs).toBeDefined();
      expect(spawnArgs![0]).toBe("/bin/sh");
      expect(spawnArgs![1]).toEqual(["-c", "echo test"]);

      // Restore original platform
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });
  });

  describe("configuration file loading", () => {
    beforeEach(() => {
      // Reset fs mocks for this test block
      mockExistsSync.mockReset();
      mockReadFileSync.mockReset();
    });

    it("should return null for non-existent file", () => {
      mockExistsSync.mockReturnValue(false);

      const config = loadHooksConfigFromFile("/non/existent/path.json");
      expect(config).toBeNull();
    });

    it("should load valid configuration file", () => {
      const testConfig: HookConfiguration = {
        hooks: {
          PreToolUse: [],
          PostToolUse: [
            {
              matcher: "Edit",
              hooks: [{ type: "command", command: 'echo "test"' }],
            },
          ],
          UserPromptSubmit: [],
          Stop: [],
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(testConfig, null, 2));

      const configFile = "/test/test-settings.json";
      const loaded = loadHooksConfigFromFile(configFile);
      expect(loaded).toEqual(testConfig.hooks);
    });

    it("should handle invalid JSON gracefully", () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("{ invalid json }");

      const configFile = "/test/invalid.json";
      expect(() => loadHooksConfigFromFile(configFile)).toThrow();
    });

    it("should handle invalid configuration structure", () => {
      const invalidConfig = { notHooks: "invalid" };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(invalidConfig));

      const configFile = "/test/invalid-structure.json";
      expect(() => loadHooksConfigFromFile(configFile)).toThrow(
        "Invalid hooks configuration structure",
      );
    });
  });

  describe("merged configuration loading", () => {
    beforeEach(() => {
      // Override fs functions for these specific tests
      mockExistsSync.mockReset();
      mockReadFileSync.mockReset();
    });

    it("should return null when no configurations exist", () => {
      // Mock file system to return false for all file existence checks
      mockExistsSync.mockReturnValue(false);

      const merged = loadMergedHooksConfig("/nonexistent/workdir");
      expect(merged).toBeNull();
    });

    it("should return user config when only user config exists", () => {
      const userConfig = {
        hooks: {
          Stop: [{ type: "command" as const, command: "echo user" }],
        },
      };

      mockExistsSync.mockImplementation((path) => {
        // Return true only for user config path (contains home directory)
        const pathStr = path.toString();
        return (
          pathStr.includes(".wave/settings.json") &&
          pathStr.includes(process.env.HOME || "/home")
        );
      });

      mockReadFileSync.mockReturnValue(JSON.stringify(userConfig));

      const merged = loadMergedHooksConfig("/nonexistent/workdir");
      expect(merged).toEqual(userConfig.hooks);
    });

    it("should return project config when only project config exists", () => {
      const projectConfig = {
        hooks: {
          Stop: [{ type: "command" as const, command: "echo project" }],
        },
      };

      mockExistsSync.mockImplementation((path) => {
        // Return true only for project config path
        const pathStr = path.toString();
        return pathStr.includes("/test/workdir/.wave/settings.json");
      });

      mockReadFileSync.mockReturnValue(JSON.stringify(projectConfig));

      const merged = loadMergedHooksConfig("/test/workdir");
      expect(merged).toEqual(projectConfig.hooks);
    });

    it("should merge configurations with project taking precedence", () => {
      const userConfig = {
        hooks: {
          Stop: [{ type: "command" as const, command: "echo user" }],
          UserPromptSubmit: [
            { type: "command" as const, command: "echo user prompt" },
          ],
        },
      };
      const projectConfig = {
        hooks: {
          Stop: [{ type: "command" as const, command: "echo project" }],
        },
      };

      // Mock both user and project configs exist
      mockExistsSync.mockReturnValue(true);

      mockReadFileSync.mockImplementation((path) => {
        const pathStr = path.toString();
        if (pathStr.includes(process.env.HOME || "/home")) {
          return JSON.stringify(userConfig);
        } else {
          return JSON.stringify(projectConfig);
        }
      });

      const merged = loadMergedHooksConfig("/test/workdir");
      expect(merged).toEqual({
        Stop: [
          { type: "command", command: "echo user" },
          { type: "command", command: "echo project" },
        ],
        UserPromptSubmit: [{ type: "command", command: "echo user prompt" }],
      });
    });
  });

  describe("JSON input handling", () => {
    it("should send JSON input to stdin for extended context", async () => {
      const mockProcess = new MockChildProcess();
      const mockStdin = new MockStdin();
      let stdinData = "";

      vi.spyOn(mockStdin, "write").mockImplementation(
        (_data?: string | Buffer | Uint8Array) => {
          if (_data) {
            stdinData += _data.toString();
          }
          return true;
        },
      );

      mockProcess.stdin = mockStdin;
      mockSpawn.mockReturnValue(mockProcess);

      const extendedContext = {
        ...mockContext,
        sessionId: "test-session-123",
        transcriptPath: "/path/to/transcript.md",
        cwd: "/test/cwd",
        userPrompt: "test prompt",
      };

      const resultPromise = executeCommand("echo test", extendedContext);

      setImmediate(() => {
        mockProcess.emit("close", 0);
      });

      await resultPromise;

      expect(stdinData).toBeTruthy();
      const parsedInput = JSON.parse(stdinData);
      expect(parsedInput.session_id).toBe("test-session-123");
      expect(parsedInput.transcript_path).toBe("/path/to/transcript.md");
      expect(parsedInput.cwd).toBe("/test/cwd");
      expect(parsedInput.hook_event_name).toBe("PostToolUse");
    });
  });
});
