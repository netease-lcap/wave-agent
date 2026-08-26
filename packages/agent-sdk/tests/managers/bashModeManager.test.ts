import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock bashTool so no real shell is spawned in tests.
vi.mock("@/tools/bashTool", () => ({
  bashTool: { execute: vi.fn() },
}));

import { BashModeManager } from "@/managers/bashModeManager.js";
import type { MessageManager } from "@/managers/messageManager.js";
import { Container } from "@/utils/container.js";
import { bashTool } from "@/tools/bashTool.js";
import { BASH_TOOL_NAME } from "@/constants/tools.js";

const mockExecute = vi.mocked(bashTool.execute);

const createMockMessageManager = (): MessageManager => {
  const mock = {
    addUserMessage: vi.fn(() => "msg-1"),
    addToolBlockToMessage: vi.fn(() => "block-1"),
    updateToolBlock: vi.fn(),
  };
  return mock as unknown as MessageManager;
};

describe("BashModeManager", () => {
  let bashModeManager: BashModeManager;
  let mockMessageManager: MessageManager;
  const testWorkdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageManager = createMockMessageManager();

    const container = new Container();
    container.register("MessageManager", mockMessageManager);
    container.register("TaskManager", {});

    bashModeManager = new BashModeManager(container, {
      workdir: testWorkdir,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("constructor and factory", () => {
    it("should create BashModeManager instance with correct options", () => {
      expect(bashModeManager).toBeInstanceOf(BashModeManager);
      expect(bashModeManager.isCommandRunning).toBe(false);
    });

    it("should create BashModeManager using factory function", () => {
      const container = new Container();
      container.register("MessageManager", createMockMessageManager());
      const manager = new BashModeManager(container, {
        workdir: "/test/workdir",
      });
      expect(manager).toBeInstanceOf(BashModeManager);
    });
  });

  describe("executeCommand", () => {
    it("should surface the command as a user message + bash tool block and complete on success", async () => {
      const command = "echo 'hello world'";
      mockExecute.mockResolvedValue({
        success: true,
        content: "hello world\n",
        metadata: { exitCode: 0 },
      } as never);

      const exitCode = await bashModeManager.executeCommand(command);

      // Command runs through the shared bash tool engine.
      expect(mockExecute).toHaveBeenCalledWith(
        { command },
        expect.objectContaining({
          workdir: testWorkdir,
          abortSignal: expect.any(AbortSignal),
        }),
      );

      // User message + running tool block.
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content: command,
      });
      expect(mockMessageManager.addToolBlockToMessage).toHaveBeenCalledWith(
        "msg-1",
        {
          name: BASH_TOOL_NAME,
          parameters: command,
          stage: "running",
        },
      );

      // Completion: full output (no exit-code prefix on success).
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith({
        id: "block-1",
        messageId: "msg-1",
        result: "hello world\n",
        stage: "end",
        success: true,
      });
      expect(exitCode).toBe(0);
      expect(bashModeManager.isCommandRunning).toBe(false);
    });

    it("should stream realtime output into the running tool block", async () => {
      const command = "sleep 1";
      mockExecute.mockImplementation(
        (
          _args: Record<string, unknown>,
          context: {
            onShortResultUpdate?: (shortResult: string) => void;
            onResultUpdate?: (result: string) => void;
          },
        ) => {
          // The bash tool engine drives these callbacks while the command runs.
          context.onShortResultUpdate?.("line 1\nline 2\nline 3");
          context.onResultUpdate?.("line 1\nline 2\nline 3\nline 4\n");
          return Promise.resolve({
            success: true,
            content: "line 1\nline 2\nline 3\nline 4\n",
            shortResult: "line 1\nline 2\nline 3",
            metadata: { exitCode: 0 },
          } as never);
        },
      );

      await bashModeManager.executeCommand(command);

      // Both callbacks are wired into the bash tool context.
      const context = vi.mocked(bashTool.execute).mock.calls[0][1] as {
        onShortResultUpdate: (shortResult: string) => void;
        onResultUpdate: (result: string) => void;
      };
      expect(typeof context.onShortResultUpdate).toBe("function");
      expect(typeof context.onResultUpdate).toBe("function");

      // Realtime updates land on the running tool block (stage stays "running").
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith({
        id: "block-1",
        messageId: "msg-1",
        shortResult: "line 1\nline 2\nline 3",
        stage: "running",
        name: BASH_TOOL_NAME,
      });
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith({
        id: "block-1",
        messageId: "msg-1",
        result: "line 1\nline 2\nline 3\nline 4\n",
        stage: "running",
        name: BASH_TOOL_NAME,
      });
    });

    it("should prefix the exit code when the command fails", async () => {
      const command = "ls /nonexistent";
      mockExecute.mockResolvedValue({
        success: false,
        content: "ls: /nonexistent: No such file or directory",
        metadata: { exitCode: 1 },
      } as never);

      const exitCode = await bashModeManager.executeCommand(command);

      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith({
        id: "block-1",
        messageId: "msg-1",
        result: "[exit code: 1]\n\nls: /nonexistent: No such file or directory",
        stage: "end",
        success: false,
      });
      expect(exitCode).toBe(1);
    });

    it("should fall back to exit code 1 when metadata has no exitCode on failure", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        content: "Command not found",
      } as never);

      const exitCode = await bashModeManager.executeCommand("nope");

      expect(exitCode).toBe(1);
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "[exit code: 1]\n\nCommand not found",
          success: false,
        }),
      );
    });

    it("should handle abort metadata (exit 130)", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        content: "",
        metadata: { exitCode: 130 },
      } as never);

      const exitCode = await bashModeManager.executeCommand("long_running");

      expect(exitCode).toBe(130);
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          result: "[exit code: 130]",
          success: false,
        }),
      );
    });

    it("should prevent multiple concurrent commands", async () => {
      let resolveExecute: (r: unknown) => void;
      mockExecute.mockReturnValue(
        new Promise((resolve) => {
          resolveExecute = resolve;
        }) as never,
      );

      const first = bashModeManager.executeCommand("command1");
      expect(bashModeManager.isCommandRunning).toBe(true);

      await expect(bashModeManager.executeCommand("command2")).rejects.toThrow(
        "Command already running",
      );

      resolveExecute!({
        success: true,
        content: "",
        metadata: { exitCode: 0 },
      });
      await first;
    });
  });

  describe("abortCommand", () => {
    it("should abort the running command via AbortController", async () => {
      const abortSpy = vi.spyOn(AbortController.prototype, "abort");
      mockExecute.mockImplementation(
        (
          _args: Record<string, unknown>,
          context: { abortSignal?: AbortSignal },
        ) =>
          new Promise((resolve) => {
            context.abortSignal?.addEventListener("abort", () => {
              resolve({
                success: false,
                content: "",
                metadata: { exitCode: 130 },
              });
            });
          }) as never,
      );

      const executePromise = bashModeManager.executeCommand("long_command");
      expect(bashModeManager.isCommandRunning).toBe(true);

      bashModeManager.abortCommand();

      expect(abortSpy).toHaveBeenCalled();
      await executePromise;
      expect(bashModeManager.isCommandRunning).toBe(false);
      abortSpy.mockRestore();
    });

    it("should do nothing when no command is running", () => {
      expect(bashModeManager.isCommandRunning).toBe(false);

      bashModeManager.abortCommand();

      expect(bashModeManager.isCommandRunning).toBe(false);
    });
  });

  describe("isCommandRunning", () => {
    it("should return correct running state", async () => {
      expect(bashModeManager.isCommandRunning).toBe(false);

      let resolveExecute: (r: unknown) => void;
      mockExecute.mockReturnValue(
        new Promise((resolve) => {
          resolveExecute = resolve;
        }) as never,
      );

      const executePromise = bashModeManager.executeCommand("test_command");
      expect(bashModeManager.isCommandRunning).toBe(true);

      resolveExecute!({
        success: true,
        content: "",
        metadata: { exitCode: 0 },
      });
      await executePromise;

      expect(bashModeManager.isCommandRunning).toBe(false);
    });
  });
});
