import { EventEmitter } from "events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { powershellTool } from "../../../src/tools/powershellTool/powershellTool.js";
import { getShellProvider } from "../../../src/utils/shell/resolveProvider.js";
import { terminateChildProcessTree } from "../../../src/utils/terminateProcessTree.js";
import type { ShellProvider } from "../../../src/utils/shell/shellProvider.js";
import type { ToolContext } from "../../../src/tools/types.js";
import { spawn } from "child_process";
import { createMockTaskManager } from "../../helpers/mockFactories.js";

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("../../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../../src/utils/terminateProcessTree.js", () => ({
  terminateChildProcessTree: vi.fn(),
}));

vi.mock("../../../src/utils/shell/resolveProvider.js", () => ({
  getShellProvider: vi.fn(),
}));

const PS_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const provider: ShellProvider = {
  type: "powershell",
  shellPath: PS_PATH,
  detached: false,
  prepareCommand: (command: string) => command,
  buildExecCommand: (command: string) => ({
    commandString: command,
    cwdFilePath: "C:\\temp\\wave_ps_cwd.tmp",
  }),
  getSpawnArgs: (command: string) => [
    "-NoProfile",
    "-NonInteractive",
    "-NoLogo",
    "-Command",
    command,
  ],
  getEnvironmentOverrides: () => ({}),
};

/**
 * A child process the test drives event by event: `spawn` is mocked, so the
 * only thing that can advance the tool is an emitted event.
 */
class FakeChild {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill = vi.fn();
  pid = 4242;
  private handlers = new Map<string, (arg?: unknown) => void>();

  on(event: string, handler: (arg?: unknown) => void) {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, arg?: unknown) {
    this.handlers.get(event)?.(arg);
  }

  /** Exit, then let both pipes finish — the order Node actually uses. */
  finish(code: number | null) {
    this.emit("exit", code);
    this.stdout.emit("end");
    this.stderr.emit("end");
  }
}

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    workdir: "/work/project",
    taskManager: createMockTaskManager(),
    ...overrides,
  } as ToolContext;
}

function spawnChild(): FakeChild {
  const child = new FakeChild();
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  return child;
}

describe("powershellTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getShellProvider).mockReturnValue(provider);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schema", () => {
    it("is the PowerShell tool with only command, timeout and description", () => {
      expect(powershellTool.name).toBe("PowerShell");
      expect(powershellTool.config.function.name).toBe("PowerShell");

      const parameters = powershellTool.config.function.parameters as {
        properties: Record<string, unknown>;
        required?: string[];
      };

      expect(Object.keys(parameters.properties).sort()).toEqual([
        "command",
        "description",
        "timeout",
      ]);
      expect(parameters.required).toEqual(["command"]);
      // A shell tool runs one command at a time: parallel calls would race on
      // the same working directory.
      expect(powershellTool.isConcurrencySafe).toBe(false);
    });

    it("rejects a missing or non-string command", async () => {
      for (const command of [undefined, "", 42]) {
        const result = await powershellTool.execute({ command }, context());

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Command parameter is required and must be a string",
        );
      }

      expect(spawn).not.toHaveBeenCalled();
    });

    it("rejects a negative or non-numeric timeout before spawning", async () => {
      for (const timeout of [-1, "soon"]) {
        const result = await powershellTool.execute(
          { command: "Get-Location", timeout },
          context(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Timeout must be a non-negative number of milliseconds",
        );
      }

      expect(spawn).not.toHaveBeenCalled();
    });
  });

  it("explains what to install when no PowerShell binary was found", async () => {
    vi.mocked(getShellProvider).mockReturnValue(undefined);

    const result = await powershellTool.execute(
      { command: "Get-Location" },
      context(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("PowerShell not found");
    expect(result.error).toContain("pwsh");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("spawns the resolved binary with the -Command argv and the session cwd", async () => {
    spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-ChildItem -Path ." },
      context({ sessionEnv: { WAVE_TEST_ENV: "1" } }),
    );
    const child = vi.mocked(spawn).mock.results[0]!.value as FakeChild;
    child.finish(0);
    await promise;

    expect(getShellProvider).toHaveBeenCalledWith("powershell");
    expect(spawn).toHaveBeenCalledWith(
      PS_PATH,
      [
        "-NoProfile",
        "-NonInteractive",
        "-NoLogo",
        "-Command",
        "Get-ChildItem -Path .",
      ],
      expect.objectContaining({
        shell: false,
        windowsHide: true,
        cwd: "/work/project",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const options = vi.mocked(spawn).mock.calls[0]![2] as {
      env: Record<string, string>;
    };
    expect(options.env.WAVE_TEST_ENV).toBe("1");
  });

  it("returns the command's output and passes the exit code through", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Content .\\a.txt" },
      context(),
    );
    child.stdout.emit("data", Buffer.from("line one\n"));
    child.stderr.emit("data", Buffer.from("a warning\n"));
    child.finish(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.content).toContain("line one");
    expect(result.content).toContain("a warning");
    expect(result.error).toBeUndefined();
    expect(result.metadata).toEqual({ exitCode: 0 });
  });

  it("reports a non-zero exit code with the failure text", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Item .\\missing.txt" },
      context(),
    );
    child.stderr.emit("data", Buffer.from("Cannot find path\n"));
    child.finish(1);

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Command failed with exit code: 1");
    expect(result.metadata).toEqual({ exitCode: 1 });
    expect(result.content).toContain("Cannot find path");
  });

  it("says so when the command printed nothing at all", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute({ command: "exit 0" }, context());
    child.finish(0);

    const result = await promise;

    expect(result.success).toBe(true);
    expect(result.content).toBe("Command executed with exit code: 0");
  });

  it("reports a spawn failure instead of throwing", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Location" },
      context(),
    );
    child.emit("error", new Error("ENOENT"));
    child.stdout.emit("end");
    child.stderr.emit("end");

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to execute command: ENOENT");
  });

  describe("permission", () => {
    function permissionManager(decision: "allow" | "deny" | "ask") {
      return {
        createContext: vi.fn(() => ({
          toolName: "PowerShell",
          permissionMode: "default",
        })),
        checkPermission: vi.fn(async () => ({
          behavior: decision,
          message: decision === "deny" ? "blocked by rule" : undefined,
        })),
      };
    }

    it("asks the manager with the tool name the permission engine keys on", async () => {
      const manager = permissionManager("allow");

      const promise = powershellTool.execute(
        {
          command: "Set-Content -Path a.txt -Value x",
          workdir: "/work/project",
        },
        context({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );
      // The permission check is async, so the child only exists once it resolved.
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      const child = vi.mocked(spawn).mock.results[0]!.value as FakeChild;
      child.finish(0);
      await promise;

      expect(manager.createContext).toHaveBeenCalledWith(
        "PowerShell",
        "default",
        undefined,
        {
          command: "Set-Content -Path a.txt -Value x",
          description: undefined,
          timeout: 120000,
          workdir: "/work/project",
        },
        undefined,
      );
    });

    it("does not spawn a denied command", async () => {
      const manager = permissionManager("deny");

      const result = await powershellTool.execute(
        { command: "Remove-Item .\\a.txt" },
        context({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("denied by user");
      expect(result.error).toContain("blocked by rule");
      expect(spawn).not.toHaveBeenCalled();
    });

    it("does not spawn when the permission check throws", async () => {
      const manager = permissionManager("allow");
      manager.checkPermission.mockRejectedValueOnce(new Error("boom"));

      const result = await powershellTool.execute(
        { command: "Get-Location" },
        context({
          permissionManager:
            manager as unknown as ToolContext["permissionManager"],
        }),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Permission check failed");
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe("timeout and abort", () => {
    it("terminates the process tree when the timeout fires", async () => {
      vi.useFakeTimers();
      const child = spawnChild();

      const promise = powershellTool.execute(
        { command: "Start-Sleep -Seconds 10", timeout: 5000 },
        context(),
      );
      vi.mocked(terminateChildProcessTree).mockClear();
      await vi.advanceTimersByTimeAsync(5000);

      const result = await promise;

      expect(terminateChildProcessTree).toHaveBeenCalledWith(child);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Command timed out after 5s");
      expect(result.metadata).toEqual({ exitCode: 130 });
    });

    it("terminates the process tree when the caller aborts", async () => {
      const child = spawnChild();
      const controller = new AbortController();

      const promise = powershellTool.execute(
        { command: "Start-Sleep -Seconds 10" },
        context({ abortSignal: controller.signal }),
      );
      controller.abort();

      const result = await promise;

      expect(terminateChildProcessTree).toHaveBeenCalledWith(child);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Command execution was aborted");
      expect(result.metadata).toEqual({ exitCode: 130 });
    });

    it("aborts immediately when the signal is already aborted", async () => {
      const child = spawnChild();
      const controller = new AbortController();
      controller.abort();

      const result = await powershellTool.execute(
        { command: "Get-Location" },
        context({ abortSignal: controller.signal }),
      );

      expect(terminateChildProcessTree).toHaveBeenCalledWith(child);
      expect(result.error).toBe("Command execution was aborted");
    });

    it("ignores the exit that follows a timeout", async () => {
      vi.useFakeTimers();
      const child = spawnChild();

      const promise = powershellTool.execute(
        { command: "Start-Sleep -Seconds 10", timeout: 1000 },
        context(),
      );
      await vi.advanceTimersByTimeAsync(1000);
      child.finish(0);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("Command timed out");
    });
  });

  it("folds long output into a three-line short result", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-ChildItem" },
      context(),
    );
    child.stdout.emit("data", Buffer.from("a\nb\nc\nd\ne\n"));
    child.finish(0);

    const result = await promise;

    expect(result.shortResult).toBe("... +2 lines\nc\nd\ne");
  });

  it("prefers the description over the command in the compact label", () => {
    expect(
      powershellTool.formatCompactParams!(
        { command: "Get-ChildItem", description: "list files" },
        context(),
      ),
    ).toBe("list files");
    expect(
      powershellTool.formatCompactParams!(
        { command: "Get-ChildItem" },
        context(),
      ),
    ).toBe("Get-ChildItem");
  });
});
