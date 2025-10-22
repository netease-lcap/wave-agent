import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  bashTool,
  bashOutputTool,
  killBashTool,
} from "../../src/tools/bashTool.js";
import { BackgroundBashManager } from "../../src/managers/backgroundBashManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { ChildProcess } from "child_process";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

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
  let backgroundBashManager: BackgroundBashManager;
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    backgroundBashManager = new BackgroundBashManager({
      workdir: "/test/workdir",
    });
    context = {
      backgroundBashManager,
      workdir: "/test/workdir",
    };
  });

  afterEach(() => {
    // Clean up any background processes
    backgroundBashManager.cleanup();
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
        /Command started in background with ID: bash_\d+/,
      );
      expect(result.content).toContain("bash_id=");
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
        backgroundBashManager,
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
      expect(result2).toBe("echo hello background");
    });
  });

  describe("BashOutput tool", () => {
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
      const bashId = bashResult.content.match(/bash_(\d+)/)?.[0];
      expect(bashId).toBeDefined();

      // Wait a bit for output to accumulate
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Get output
      const outputResult = await bashOutputTool.execute(
        {
          bash_id: bashId!,
        },
        context,
      );

      expect(outputResult.success).toBe(true);
      expect(outputResult.content).toBe("output from bg process");
    });

    it("should handle non-existent shell ID", async () => {
      const result = await bashOutputTool.execute(
        {
          bash_id: "bash_999",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Background shell with ID bash_999 not found");
    });

    it("should validate bash_id parameter", async () => {
      const result = await bashOutputTool.execute({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "bash_id parameter is required and must be a string",
      );
    });

    it("should format compact params correctly", () => {
      const params1 = { bash_id: "bash_1" };
      const result1 = bashOutputTool.formatCompactParams?.(params1, context);
      expect(result1).toBe("bash_1");

      const params2 = { bash_id: "bash_1", filter: "error" };
      const result2 = bashOutputTool.formatCompactParams?.(params2, context);
      expect(result2).toBe("bash_1 filtered: error");
    });
  });

  describe("KillBash tool", () => {
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

      const bashId = bashResult.content.match(/bash_(\d+)/)?.[0];
      expect(bashId).toBeDefined();

      // Kill the process
      const killResult = await killBashTool.execute(
        {
          shell_id: bashId!,
        },
        context,
      );

      expect(killResult.success).toBe(true);
      expect(killResult.content).toBe(
        `Background shell ${bashId} has been killed`,
      );
    });

    it("should handle non-existent shell ID", async () => {
      const result = await killBashTool.execute(
        {
          shell_id: "bash_999",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Background shell with ID bash_999 not found");
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

      const bashId = bashResult.content.match(/bash_(\d+)/)?.[0];
      expect(bashId).toBeDefined();

      // Wait for process to complete
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Try to kill completed process
      const killResult = await killBashTool.execute(
        {
          shell_id: bashId!,
        },
        context,
      );

      expect(killResult.success).toBe(false);
      expect(killResult.error).toContain("is not running");
    });

    it("should validate shell_id parameter", async () => {
      const result = await killBashTool.execute({}, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "shell_id parameter is required and must be a string",
      );
    });

    it("should format compact params correctly", () => {
      const params = { shell_id: "bash_1" };
      const result = killBashTool.formatCompactParams?.(params, context);
      expect(result).toBe("bash_1");
    });
  });
});
