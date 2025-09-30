import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock bashHistory utility
vi.mock("@/utils/bashHistory", () => ({
  addBashCommandToHistory: vi.fn(),
}));

import { BashManager, createBashManager } from "@/services/bashManager";
import type { Message } from "@/types";

const mockSpawn = vi.mocked(spawn);

// Mock ChildProcess
class MockChildProcess extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public kill = vi.fn();

  constructor() {
    super();
  }

  simulateExit(code: number | null, signal?: string) {
    this.emit("exit", code, signal);
  }

  simulateError(error: Error) {
    this.emit("error", error);
  }

  simulateStdout(data: string) {
    this.stdout.emit("data", Buffer.from(data));
  }

  simulateStderr(data: string) {
    this.stderr.emit("data", Buffer.from(data));
  }
}

describe("BashManager", () => {
  let bashManager: BashManager;
  let mockMessagesUpdater: ReturnType<typeof vi.fn>;
  let mockChildProcess: MockChildProcess;
  const testWorkdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessagesUpdater = vi.fn();
    mockChildProcess = new MockChildProcess();

    // Setup spawn mock to return our mock child process
    mockSpawn.mockReturnValue(mockChildProcess as unknown as ChildProcess);

    // Mock process.cwd() to return test workdir
    vi.spyOn(process, "cwd").mockReturnValue(testWorkdir);

    bashManager = createBashManager({
      onMessagesUpdate: mockMessagesUpdater,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("constructor and factory", () => {
    it("should create BashManager instance with correct options", () => {
      expect(bashManager).toBeInstanceOf(BashManager);
      expect(bashManager.getIsCommandRunning()).toBe(false);
    });

    it("should create BashManager using factory function", () => {
      const manager = createBashManager({
        onMessagesUpdate: vi.fn(),
      });
      expect(manager).toBeInstanceOf(BashManager);
    });
  });

  describe("executeCommand", () => {
    it("should execute a simple command successfully", async () => {
      const command = "echo 'hello world'";
      let capturedMessages: Message[] = [];

      // Mock the messages updater to capture all calls
      mockMessagesUpdater.mockImplementation((updater) => {
        capturedMessages = updater(capturedMessages);
        return capturedMessages;
      });

      // Start command execution
      const executePromise = bashManager.executeCommand(command);

      // Verify initial state
      expect(bashManager.getIsCommandRunning()).toBe(true);

      // Verify spawn was called with correct arguments
      expect(mockSpawn).toHaveBeenCalledWith(command, {
        shell: true,
        stdio: "pipe",
        cwd: testWorkdir,
        env: expect.any(Object),
      });

      // Initial message should be added
      expect(capturedMessages).toHaveLength(1);
      expect(capturedMessages[0]).toEqual({
        role: "assistant",
        blocks: [
          {
            type: "command_output",
            command,
            output: "",
            isRunning: true,
            exitCode: null,
          },
        ],
      });

      // Simulate command output
      mockChildProcess.simulateStdout("hello world\n");

      // Output should be updated
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        type: "command_output",
        command,
        output: "hello world",
        isRunning: true,
        exitCode: null,
      });

      // Simulate successful exit
      mockChildProcess.simulateExit(0);

      // Wait for command to complete
      const exitCode = await executePromise;

      // Final state should show completion
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        type: "command_output",
        command,
        output: "hello world",
        isRunning: false,
        exitCode: 0,
      });

      expect(exitCode).toBe(0);
      expect(bashManager.getIsCommandRunning()).toBe(false);
    });

    it("should handle command with stderr output", async () => {
      const command = "ls /nonexistent";
      let capturedMessages: Message[] = [];

      mockMessagesUpdater.mockImplementation((updater) => {
        capturedMessages = updater(capturedMessages);
        return capturedMessages;
      });

      const executePromise = bashManager.executeCommand(command);

      // Simulate stderr output
      mockChildProcess.simulateStderr(
        "ls: /nonexistent: No such file or directory\n",
      );

      // Output should be updated with stderr
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        output: "ls: /nonexistent: No such file or directory",
        isRunning: true,
      });

      // Simulate exit with error code
      mockChildProcess.simulateExit(1);

      const exitCode = await executePromise;

      // Final state should show error completion
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 1,
      });

      expect(exitCode).toBe(1);
    });

    it("should handle command execution error", async () => {
      const command = "invalid-command";
      let capturedMessages: Message[] = [];

      mockMessagesUpdater.mockImplementation((updater) => {
        capturedMessages = updater(capturedMessages);
        return capturedMessages;
      });

      const executePromise = bashManager.executeCommand(command);

      // Simulate command error
      const error = new Error("Command not found");
      mockChildProcess.simulateError(error);

      const exitCode = await executePromise;

      // Should include error message in output
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        output: expect.stringContaining("Error: Command not found"),
        isRunning: false,
        exitCode: 1,
      });

      expect(exitCode).toBe(1);
    });

    it("should handle SIGKILL signal", async () => {
      const command = "sleep 10";
      let capturedMessages: Message[] = [];

      mockMessagesUpdater.mockImplementation((updater) => {
        capturedMessages = updater(capturedMessages);
        return capturedMessages;
      });

      const executePromise = bashManager.executeCommand(command);

      // Simulate process killed by signal
      mockChildProcess.simulateExit(null, "SIGKILL");

      const exitCode = await executePromise;

      // Should show SIGKILL exit code (130)
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 130,
      });

      expect(exitCode).toBe(130);
    });

    it("should prevent multiple concurrent commands", async () => {
      const command1 = "sleep 1";
      const command2 = "echo 'second'";

      // Start first command
      const promise1 = bashManager.executeCommand(command1);

      // Try to start second command while first is running
      await expect(bashManager.executeCommand(command2)).rejects.toThrow(
        "Command already running",
      );

      // Complete first command
      mockChildProcess.simulateExit(0);
      await promise1;

      // Now second command should work
      const promise2 = bashManager.executeCommand(command2);
      expect(bashManager.getIsCommandRunning()).toBe(true);

      mockChildProcess.simulateExit(0);
      await promise2;
    });

    it("should update output progressively", async () => {
      const command = "echo 'line1' && echo 'line2'";
      let capturedMessages: Message[] = [];
      let updateCount = 0;

      mockMessagesUpdater.mockImplementation((updater) => {
        capturedMessages = updater(capturedMessages);
        updateCount++;
        return capturedMessages;
      });

      const executePromise = bashManager.executeCommand(command);

      // Simulate progressive output
      mockChildProcess.simulateStdout("line1\n");

      // Should have partial output
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        output: "line1",
        isRunning: true,
      });

      mockChildProcess.simulateStdout("line2\n");

      // Should have combined output
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        output: "line1\nline2",
        isRunning: true,
      });

      mockChildProcess.simulateExit(0);

      await executePromise;

      // Should have been called multiple times for progressive updates
      expect(updateCount).toBeGreaterThan(2);

      // Final state should show completion
      expect(capturedMessages[0].blocks[0]).toMatchObject({
        isRunning: false,
        exitCode: 0,
      });
    });
  });

  describe("abortCommand", () => {
    it("should abort running command", async () => {
      const command = "sleep 10";

      // Start command
      const executePromise = bashManager.executeCommand(command);
      expect(bashManager.getIsCommandRunning()).toBe(true);

      // Abort command
      bashManager.abortCommand();

      // Verify kill was called
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(bashManager.getIsCommandRunning()).toBe(false);

      // Complete the promise by simulating exit
      mockChildProcess.simulateExit(null, "SIGKILL");
      await executePromise;
    });

    it("should do nothing when no command is running", () => {
      expect(bashManager.getIsCommandRunning()).toBe(false);

      // Should not throw
      bashManager.abortCommand();

      expect(mockChildProcess.kill).not.toHaveBeenCalled();
    });
  });

  describe("updateWorkdir", () => {
    it("should update working directory", () => {
      const newWorkdir = "/new/working/directory";

      bashManager.updateWorkdir(newWorkdir);

      // Execute a command to verify new workdir is used
      const command = "pwd";
      bashManager.executeCommand(command);

      expect(mockSpawn).toHaveBeenCalledWith(command, {
        shell: true,
        stdio: "pipe",
        cwd: newWorkdir,
        env: expect.any(Object),
      });
    });
  });

  describe("getIsCommandRunning", () => {
    it("should return correct running state", async () => {
      expect(bashManager.getIsCommandRunning()).toBe(false);

      const executePromise = bashManager.executeCommand("echo 'test'");
      expect(bashManager.getIsCommandRunning()).toBe(true);

      mockChildProcess.simulateExit(0);
      await executePromise;

      expect(bashManager.getIsCommandRunning()).toBe(false);
    });
  });
});
