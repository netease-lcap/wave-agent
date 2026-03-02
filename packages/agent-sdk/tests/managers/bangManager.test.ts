import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

// Mock child_process
vi.mock("child_process");

// Mock bashHistory utility
vi.mock("@/utils/bashHistory");

import { BangManager } from "@/managers/bangManager.js";
import type { MessageManager } from "@/managers/messageManager.js";
import { Container } from "@/utils/container.js";

// Mock MessageManager
const createMockMessageManager = (): MessageManager => {
  const mock = {
    addBangMessage: vi.fn(),
    updateBangMessage: vi.fn(),
    completeBangMessage: vi.fn(),
  };
  return mock as unknown as MessageManager;
};

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

describe("BangManager", () => {
  let bangManager: BangManager;
  let mockMessageManager: MessageManager;
  let mockChildProcess: MockChildProcess;
  const testWorkdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageManager = createMockMessageManager();
    mockChildProcess = new MockChildProcess();

    // Setup spawn mock to return our mock child process
    mockSpawn.mockReturnValue(mockChildProcess as unknown as ChildProcess);

    const container = new Container();
    container.register("MessageManager", mockMessageManager);

    bangManager = new BangManager(container, {
      workdir: testWorkdir,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("constructor and factory", () => {
    it("should create BangManager instance with correct options", () => {
      expect(bangManager).toBeInstanceOf(BangManager);
      expect(bangManager.isCommandRunning).toBe(false);
    });

    it("should create BangManager using factory function", () => {
      const container = new Container();
      container.register("MessageManager", createMockMessageManager());
      const manager = new BangManager(container, {
        workdir: "/test/workdir",
      });
      expect(manager).toBeInstanceOf(BangManager);
    });
  });

  describe("executeCommand", () => {
    it("should execute a simple command successfully", async () => {
      const command = "echo 'hello world'";

      // Start command execution
      const executePromise = bangManager.executeCommand(command);

      // Verify initial state
      expect(bangManager.isCommandRunning).toBe(true);

      // Verify spawn was called with correct arguments
      expect(mockSpawn).toHaveBeenCalledWith(command, {
        shell: true,
        stdio: "pipe",
        cwd: testWorkdir,
        env: expect.any(Object),
      });

      // Verify initial command message was added
      expect(mockMessageManager.addBangMessage).toHaveBeenCalledWith(command);

      // Simulate command output
      mockChildProcess.simulateStdout("hello world\n");

      // Verify output update callback was NOT called during execution
      expect(mockMessageManager.updateBangMessage).not.toHaveBeenCalled();

      // Simulate command completion
      mockChildProcess.simulateExit(0);
      const exitCode = await executePromise;

      // Verify final state
      expect(exitCode).toBe(0);
      expect(bangManager.isCommandRunning).toBe(false);
      expect(mockMessageManager.completeBangMessage).toHaveBeenCalledWith(
        command,
        0,
        "hello world\n",
      );
    });

    it("should handle command with stderr output", async () => {
      const command = "ls /nonexistent";

      const executePromise = bangManager.executeCommand(command);

      // Verify initial callback was called
      expect(mockMessageManager.addBangMessage).toHaveBeenCalledWith(command);

      // Simulate stderr output
      mockChildProcess.simulateStderr(
        "ls: /nonexistent: No such file or directory",
      );

      // Verify update callback was NOT called during execution
      expect(mockMessageManager.updateBangMessage).not.toHaveBeenCalled();

      // Simulate command completion with non-zero exit code
      mockChildProcess.simulateExit(1);
      const exitCode = await executePromise;

      expect(exitCode).toBe(1);
      expect(mockMessageManager.completeBangMessage).toHaveBeenCalledWith(
        command,
        1,
        "ls: /nonexistent: No such file or directory",
      );
    });

    it("should handle command execution error", async () => {
      const command = "nonexistentcommand";

      const executePromise = bangManager.executeCommand(command);

      // Verify initial callback was called
      expect(mockMessageManager.addBangMessage).toHaveBeenCalledWith(command);

      // Simulate command error
      const error = new Error("Command not found");
      mockChildProcess.simulateError(error);

      const exitCode = await executePromise;

      // Should have error output and exit code 1
      expect(mockMessageManager.updateBangMessage).not.toHaveBeenCalled();
      expect(mockMessageManager.completeBangMessage).toHaveBeenCalledWith(
        command,
        1,
        "\nError: Command not found\n",
      );
      expect(exitCode).toBe(1);
    });

    it("should handle SIGKILL signal", async () => {
      const command = "long_running_command";

      const executePromise = bangManager.executeCommand(command);

      // Simulate signal termination
      mockChildProcess.simulateExit(null, "SIGKILL");
      const exitCode = await executePromise;

      expect(exitCode).toBe(130);
      expect(mockMessageManager.completeBangMessage).toHaveBeenCalledWith(
        command,
        130,
        "",
      );
    });

    it("should prevent multiple concurrent commands", async () => {
      const command1 = "command1";
      const command2 = "command2";

      // Start first command
      bangManager.executeCommand(command1);
      expect(bangManager.isCommandRunning).toBe(true);

      // Trying to start second command should throw
      await expect(bangManager.executeCommand(command2)).rejects.toThrow(
        "Command already running",
      );
    });

    it("should NOT update output progressively", async () => {
      const command = "cat file.txt";

      const executePromise = bangManager.executeCommand(command);

      // Simulate partial output
      mockChildProcess.simulateStdout("line1");
      expect(mockMessageManager.updateBangMessage).not.toHaveBeenCalled();

      // Simulate more output
      mockChildProcess.simulateStdout("\nline2");
      expect(mockMessageManager.updateBangMessage).not.toHaveBeenCalled();

      // Complete
      mockChildProcess.simulateExit(0);
      await executePromise;

      expect(mockMessageManager.completeBangMessage).toHaveBeenCalledWith(
        command,
        0,
        "line1\nline2",
      );
    });
  });

  describe("abortCommand", () => {
    it("should abort running command", async () => {
      const command = "long_command";

      bangManager.executeCommand(command);
      expect(bangManager.isCommandRunning).toBe(true);

      // Abort the command
      bangManager.abortCommand();

      // Verify kill was called
      expect(mockChildProcess.kill).toHaveBeenCalledWith("SIGKILL");
      expect(bangManager.isCommandRunning).toBe(false);
    });

    it("should do nothing when no command is running", () => {
      expect(bangManager.isCommandRunning).toBe(false);

      // Should not throw or cause issues
      bangManager.abortCommand();

      expect(bangManager.isCommandRunning).toBe(false);
    });
  });

  describe("isCommandRunning", () => {
    it("should return correct running state", async () => {
      expect(bangManager.isCommandRunning).toBe(false);

      const executePromise = bangManager.executeCommand("test_command");
      expect(bangManager.isCommandRunning).toBe(true);

      mockChildProcess.simulateExit(0);
      await executePromise;

      expect(bangManager.isCommandRunning).toBe(false);
    });
  });
});
