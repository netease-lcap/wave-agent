import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock both shell tools so no real shell is spawned in tests.
vi.mock("@/tools/bashTool", () => ({
  bashTool: { execute: vi.fn() },
}));

vi.mock("@/tools/powershellTool/powershellTool", () => ({
  powershellTool: { execute: vi.fn() },
}));

// The shell kind is the subject of the routing cases below, so it is pinned
// instead of depending on whether this machine happens to have Git Bash.
vi.mock("@/utils/shell/shellToolGate", () => ({
  collectShellToolGateInput: vi.fn(() => ({})),
  resolveShellKind: vi.fn(() => "bash"),
}));

import { BashModeManager } from "@/managers/bashModeManager.js";
import type { MessageManager } from "@/managers/messageManager.js";
import { Container } from "@/utils/container.js";
import { bashTool } from "@/tools/bashTool.js";
import { powershellTool } from "@/tools/powershellTool/powershellTool.js";
import { BASH_TOOL_NAME, POWERSHELL_TOOL_NAME } from "@/constants/tools.js";
import { resolveShellKind } from "@/utils/shell/shellToolGate.js";

const mockExecute = vi.mocked(bashTool.execute);
const mockPowerShellExecute = vi.mocked(powershellTool.execute);

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
    vi.mocked(resolveShellKind).mockReturnValue("bash");
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
        data: { exitCode: 0 },
      } as never);

      const exitCode = await bashModeManager.executeCommand(command);

      // Command runs through the shell tool this session has.
      expect(mockExecute).toHaveBeenCalledWith(
        { command, dangerouslyDisableSandbox: true },
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

    it("should write the output once, when the command ends", async () => {
      mockExecute.mockResolvedValue({
        success: true,
        content: "line 1\nline 2\n",
        data: { exitCode: 0 },
      } as never);

      await bashModeManager.executeCommand("sleep 1");

      // The engine buffers output and hands it back once, so there is nothing
      // to stream into the block while the command runs.
      const context = vi.mocked(bashTool.execute).mock.calls[0][1];
      expect(context).not.toHaveProperty("onShortResultUpdate");
      expect(context).not.toHaveProperty("onResultUpdate");

      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledTimes(1);
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith({
        id: "block-1",
        messageId: "msg-1",
        result: "line 1\nline 2\n",
        stage: "end",
        success: true,
      });
    });

    it("reads the failure from the exit code, not from `success`", async () => {
      // 真的 shell 工具对非零退出报的是 `success: true`（spec core/bash-tools.md
      // 「退出码不是工具成败」），成败只能从 `data.exitCode` 读。
      mockExecute.mockResolvedValue({
        success: true,
        content: "ls: /nonexistent: No such file or directory\nExit code 1",
        data: {
          exitCode: 1,
          returnCodeInterpretation: "Command failed with exit code: 1",
        },
      } as never);

      const exitCode = await bashModeManager.executeCommand("ls /nonexistent");

      expect(exitCode).toBe(1);
      expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
        expect.objectContaining({
          result:
            "[exit code: 1]\n\nls: /nonexistent: No such file or directory\nExit code 1",
          success: false,
        }),
      );
    });

    it("should prefix the exit code when the command fails", async () => {
      const command = "ls /nonexistent";
      mockExecute.mockResolvedValue({
        success: false,
        content: "ls: /nonexistent: No such file or directory",
        data: { exitCode: 1 },
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

    it("should fall back to exit code 1 when the result carries no exitCode on failure", async () => {
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

    it("should pass an aborted command's 130 through", async () => {
      mockExecute.mockResolvedValue({
        success: false,
        content: "",
        data: { exitCode: 130 },
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
        data: { exitCode: 0 },
      });
      await first;
    });
  });

  describe("shell routing", () => {
    it("runs a PowerShell session's command through the PowerShell tool", async () => {
      vi.mocked(resolveShellKind).mockReturnValue("powershell");
      mockPowerShellExecute.mockResolvedValue({
        success: true,
        content: "ps output\n",
        data: { exitCode: 0 },
      } as never);

      const exitCode = await bashModeManager.executeCommand("Get-ChildItem");

      expect(mockPowerShellExecute).toHaveBeenCalledWith(
        { command: "Get-ChildItem", dangerouslyDisableSandbox: true },
        expect.objectContaining({ workdir: testWorkdir }),
      );
      expect(mockExecute).not.toHaveBeenCalled();
      // The block is named after the tool that ran, so the UI shows what the
      // user actually executed instead of a Bash block with PS syntax in it.
      expect(mockMessageManager.addToolBlockToMessage).toHaveBeenCalledWith(
        "msg-1",
        {
          name: POWERSHELL_TOOL_NAME,
          parameters: "Get-ChildItem",
          stage: "running",
        },
      );
      expect(exitCode).toBe(0);
    });

    it("keeps using the Bash tool while the session's shell is bash", async () => {
      mockExecute.mockResolvedValue({
        success: true,
        content: "",
        data: { exitCode: 0 },
      } as never);

      await bashModeManager.executeCommand("ls");

      expect(mockPowerShellExecute).not.toHaveBeenCalled();
      expect(mockMessageManager.addToolBlockToMessage).toHaveBeenCalledWith(
        "msg-1",
        expect.objectContaining({ name: BASH_TOOL_NAME }),
      );
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
                data: { exitCode: 130 },
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
        data: { exitCode: 0 },
      });
      await executePromise;

      expect(bashModeManager.isCommandRunning).toBe(false);
    });
  });
});
