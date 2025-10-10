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

import { BashManager } from "@/services/bashManager.js";

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
  let mockOnAddCommandOutputMessage: ReturnType<typeof vi.fn>;
  let mockOnUpdateCommandOutputMessage: ReturnType<typeof vi.fn>;
  let mockOnCompleteCommandMessage: ReturnType<typeof vi.fn>;
  let mockChildProcess: MockChildProcess;
  const testWorkdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnAddCommandOutputMessage = vi.fn();
    mockOnUpdateCommandOutputMessage = vi.fn();
    mockOnCompleteCommandMessage = vi.fn();
    mockChildProcess = new MockChildProcess();

    // Setup spawn mock to return our mock child process
    mockSpawn.mockReturnValue(mockChildProcess as unknown as ChildProcess);

    // Mock process.cwd() to return test workdir
    vi.spyOn(process, "cwd").mockReturnValue(testWorkdir);

    bashManager = new BashManager({
      onAddCommandOutputMessage: mockOnAddCommandOutputMessage,
      onUpdateCommandOutputMessage: mockOnUpdateCommandOutputMessage,
      onCompleteCommandMessage: mockOnCompleteCommandMessage,
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
      const manager = new BashManager({
        onAddCommandOutputMessage: vi.fn(),
        onUpdateCommandOutputMessage: vi.fn(),
        onCompleteCommandMessage: vi.fn(),
      });
      expect(manager).toBeInstanceOf(BashManager);
    });
  });

  describe("executeCommand", () => {
    it("should execute a simple command successfully", async () => {
      const command = "echo 'hello world'";

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

      // Verify initial command message was added
      expect(mockOnAddCommandOutputMessage).toHaveBeenCalledWith(command);

      // Simulate command output
      mockChildProcess.simulateStdout("hello world\n");

      // Verify output update callback was called
      expect(mockOnUpdateCommandOutputMessage).toHaveBeenCalledWith(
        command,
        "hello world\n",
      );

      // Simulate command completion
      mockChildProcess.simulateExit(0);
      const exitCode = await executePromise;

      // Verify final state
      expect(exitCode).toBe(0);
      expect(bashManager.getIsCommandRunning()).toBe(false);
      expect(mockOnCompleteCommandMessage).toHaveBeenCalledWith(command, 0);
    });

    it("should handle command with stderr output", async () => {
      const command = "ls /nonexistent";

      const executePromise = bashManager.executeCommand(command);

      // Verify initial callback was called
      expect(mockOnAddCommandOutputMessage).toHaveBeenCalledWith(command);

      // Simulate stderr output
      mockChildProcess.simulateStderr(
        "ls: /nonexistent: No such file or directory",
      );

      // Verify update callback was called with stderr output
      expect(mockOnUpdateCommandOutputMessage).toHaveBeenCalledWith(
        command,
        "ls: /nonexistent: No such file or directory",
      );

      // Simulate command completion with non-zero exit code
      mockChildProcess.simulateExit(1);
      const exitCode = await executePromise;

      expect(exitCode).toBe(1);
      expect(mockOnCompleteCommandMessage).toHaveBeenCalledWith(command, 1);
    });

    it("should handle command execution error", async () => {
      const command = "nonexistentcommand";

      const executePromise = bashManager.executeCommand(command);

      // Verify initial callback was called
      expect(mockOnAddCommandOutputMessage).toHaveBeenCalledWith(command);

      // Simulate command error
      const error = new Error("Command not found");
      mockChildProcess.simulateError(error);

      const exitCode = await executePromise;

      // Should have error output and exit code 1
      expect(mockOnUpdateCommandOutputMessage).toHaveBeenCalledWith(
        command,
        "\nError: Command not found\n",
      );
      expect(mockOnCompleteCommandMessage).toHaveBeenCalledWith(command, 1);
      expect(exitCode).toBe(1);
    });

    it("should handle SIGKILL signal", async () => {
      const command = "long_running_command";

      const executePromise = bashManager.executeCommand(command);

      // Simulate signal termination
      mockChildProcess.simulateExit(null, "SIGKILL");
      const exitCode = await executePromise;

      expect(exitCode).toBe(130);
      expect(mockOnCompleteCommandMessage).toHaveBeenCalledWith(command, 130);
    });

    it("should prevent multiple concurrent commands", async () => {
      const command1 = "command1";
      const command2 = "command2";

      // Start first command
      bashManager.executeCommand(command1);
      expect(bashManager.getIsCommandRunning()).toBe(true);

      // Trying to start second command should throw
      await expect(bashManager.executeCommand(command2)).rejects.toThrow(
        "Command already running",
      );
    });

    it("should update output progressively", async () => {
      const command = "cat file.txt";

      const executePromise = bashManager.executeCommand(command);

      // Simulate partial output
      mockChildProcess.simulateStdout("line1");
      expect(mockOnUpdateCommandOutputMessage).toHaveBeenCalledWith(
        command,
        "line1",
      );

      // Simulate more output
      mockChildProcess.simulateStdout("\nline2");
      expect(mockOnUpdateCommandOutputMessage).toHaveBeenCalledWith(
        command,
        "line1\nline2",
      );

      // Complete
      mockChildProcess.simulateExit(0);
      await executePromise;

      expect(mockOnCompleteCommandMessage).toHaveBeenCalledWith(command, 0);
    });
  });

  describe("abortCommand", () => {
    it("should abort running command", async () => {
      const command = "long_command";

      bashManager.executeCommand(command);
      expect(bashManager.getIsCommandRunning()).toBe(true);

      // Abort the command
      bashManager.abortCommand();

      // Verify kill was called
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(bashManager.getIsCommandRunning()).toBe(false);
    });

    it("should do nothing when no command is running", () => {
      expect(bashManager.getIsCommandRunning()).toBe(false);

      // Should not throw or cause issues
      bashManager.abortCommand();

      expect(bashManager.getIsCommandRunning()).toBe(false);
    });
  });

  describe("getIsCommandRunning", () => {
    it("should return correct running state", async () => {
      expect(bashManager.getIsCommandRunning()).toBe(false);

      const executePromise = bashManager.executeCommand("test_command");
      expect(bashManager.getIsCommandRunning()).toBe(true);

      mockChildProcess.simulateExit(0);
      await executePromise;

      expect(bashManager.getIsCommandRunning()).toBe(false);
    });
  });
});
