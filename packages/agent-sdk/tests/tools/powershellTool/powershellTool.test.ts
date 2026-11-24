import { EventEmitter } from "events";
import * as fs from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { powershellTool } from "../../../src/tools/powershellTool/powershellTool.js";
import { getShellProvider } from "../../../src/utils/shell/resolveProvider.js";
import { terminateChildProcessTree } from "../../../src/utils/terminateProcessTree.js";
import type { ShellProvider } from "../../../src/utils/shell/shellProvider.js";
import type { ToolContext } from "../../../src/tools/types.js";
import type { ForegroundTask } from "../../../src/types/processes.js";
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

vi.mock("../../../src/utils/tempDir.js", () => ({
  resolveTempDir: () => "C:\\temp",
  probeTempDir: () => ({ writable: true }),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    accessSync: vi.fn(),
    constants: { F_OK: 0 },
  };
});

const PS_PATH =
  "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

const CWD_FILE = "C:\\temp\\wave_ps_cwd.tmp";

const provider: ShellProvider = {
  type: "powershell",
  shellPath: PS_PATH,
  detached: false,
  prepareCommand: async (command: string) => command,
  buildExecCommand: (command: string) => ({
    commandString: command,
    cwdFilePath: CWD_FILE,
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
    // No tracked cwd file unless a test says so.
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("schema", () => {
    it("is the PowerShell tool with command, timeout, description and run_in_background", () => {
      expect(powershellTool.name).toBe("PowerShell");
      expect(powershellTool.config.function.name).toBe("PowerShell");

      const parameters = powershellTool.config.function.parameters as {
        properties: Record<string, unknown>;
        required?: string[];
      };

      expect(Object.keys(parameters.properties).sort()).toEqual([
        "command",
        "description",
        "run_in_background",
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
    // 退出码在 `data.exitCode`（原来是 `ToolResult.metadata.exitCode`），正文里不出现。
    expect(result.data).toEqual(expect.objectContaining({ exitCode: 0 }));
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
    expect(result.data).toEqual(expect.objectContaining({ exitCode: 1 }));
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

  describe("working directory tracking", () => {
    function withTrackedCwd(trackedCwd: string, cwdIsAllowed: boolean) {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(trackedCwd);
      const onCwdChange = vi.fn();
      return {
        onCwdChange,
        context: context({
          onCwdChange,
          originalWorkdir: "/work/project",
          permissionManager: {
            createContext: vi.fn(() => ({
              toolName: "PowerShell",
              permissionMode: "default",
            })),
            checkPermission: vi.fn(async () => ({ behavior: "allow" })),
            isPathInWorkingDirectory: () => cwdIsAllowed,
          } as unknown as ToolContext["permissionManager"],
        }),
      };
    }

    /**
     * The permission check is async, so `execute` only attaches the child's
     * listeners once `spawn` runs — arming the mock up front and awaiting the
     * spawn keeps `finish(0)` from landing on an unattached emitter.
     */
    async function runToCompletion(command: string, ctx: ToolContext) {
      const child = spawnChild();
      const promise = powershellTool.execute({ command }, ctx);
      await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
      child.finish(0);
      return promise;
    }

    it("reports the tracked cwd and says so in the output", async () => {
      const tracked = withTrackedCwd("/work/project/sub", true);

      const result = await runToCompletion("Set-Location sub", tracked.context);

      expect(tracked.onCwdChange).toHaveBeenCalledWith("/work/project/sub");
      expect(result.content).toContain(
        "Shell working directory changed to /work/project/sub",
      );
      // The temp file is read once and then removed.
      expect(fs.unlinkSync).toHaveBeenCalledWith(CWD_FILE);
    });

    it("strips the BOM 5.1 writes for Out-File -Encoding utf8", async () => {
      const tracked = withTrackedCwd("\uFEFF/work/project/sub", true);

      await runToCompletion("Set-Location sub", tracked.context);

      expect(tracked.onCwdChange).toHaveBeenCalledWith("/work/project/sub");
    });

    it("resets to the original workdir when the cwd only sits in an internal grant", async () => {
      const tracked = withTrackedCwd("/work/project/.wave/memory", false);

      const result = await runToCompletion(
        "Set-Location .wave/memory",
        tracked.context,
      );

      expect(tracked.onCwdChange).toHaveBeenCalledWith("/work/project");
      expect(result.content).toContain("Shell cwd was reset to /work/project");
    });

    it("ignores a tracked cwd that no longer exists", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("/work/project/gone");
      vi.mocked(fs.accessSync).mockImplementationOnce(() => {
        throw new Error("ENOENT");
      });
      const onCwdChange = vi.fn();

      const result = await runToCompletion(
        "Set-Location gone",
        context({ onCwdChange, originalWorkdir: "/work/project" }),
      );

      expect(onCwdChange).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
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
      expect(result.data).toEqual(expect.objectContaining({ exitCode: 130 }));
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
      expect(result.data).toEqual(expect.objectContaining({ exitCode: 130 }));
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
    it("moves a timed-out command to the background when it is allowed to", async () => {
      vi.useFakeTimers();
      const child = spawnChild();
      const adoptProcess = vi.fn(() => "task_auto_1");
      const foregroundTaskManager = {
        registerForegroundTask: vi.fn(),
        unregisterForegroundTask: vi.fn(),
      };

      const promise = powershellTool.execute(
        { command: "Get-ChildItem -Recurse", timeout: 5000 },
        context({
          foregroundTaskManager:
            foregroundTaskManager as unknown as ToolContext["foregroundTaskManager"],
          backgroundTaskManager: {
            adoptProcess,
            getTask: vi.fn(() => ({
              outputPath: "C:\\temp\\wave-task-auto.log",
            })),
          } as unknown as ToolContext["backgroundTaskManager"],
        }),
      );

      await vi.advanceTimersByTimeAsync(5000);
      const result = await promise;

      // Kept running, not killed — and reported as a success, because the work
      // is still going (same contract as the Bash tool).
      expect(terminateChildProcessTree).not.toHaveBeenCalled();
      expect(adoptProcess).toHaveBeenCalledWith(
        child,
        "Get-ChildItem -Recurse",
        "",
        "",
      );
      expect(result.success).toBe(true);
      expect(result.assistantAutoBackgrounded).toBe(true);
      expect(result.backgroundTaskId).toBe("task_auto_1");
      expect(result.content).toBe(
        "Command exceeded the timeout (5s) and was moved to the background with ID: task_auto_1. It is still running — you will be notified when it completes. Output is being written to: C:\\temp\\wave-task-auto.log",
      );
      // The foreground registration is released: the task manager now owns it.
      expect(
        foregroundTaskManager.unregisterForegroundTask,
      ).toHaveBeenCalledTimes(1);

      // The adopted process exits later; its exit must not replace the receipt.
      child.finish(0);
    });

    it.each(["Start-Sleep -Seconds 10", "sleep 10"])(
      "still kills %s on timeout — it is the wait idiom, not background work",
      async (command) => {
        vi.useFakeTimers();
        const child = spawnChild();
        const adoptProcess = vi.fn();

        const promise = powershellTool.execute(
          { command, timeout: 1000 },
          context({
            backgroundTaskManager: {
              adoptProcess,
              getTask: vi.fn(),
            } as unknown as ToolContext["backgroundTaskManager"],
          }),
        );

        await vi.advanceTimersByTimeAsync(1000);
        const result = await promise;

        expect(adoptProcess).not.toHaveBeenCalled();
        expect(terminateChildProcessTree).toHaveBeenCalledWith(child);
        expect(result.success).toBe(false);
        // 转后台失败也走中断档：正文里的原因 + 退出码 130。
        expect(result.data).toEqual(
          expect.objectContaining({ exitCode: 130, interrupted: true }),
        );
      },
    );
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

  describe("background", () => {
    function backgroundManager(outputPath?: string) {
      return {
        startShell: vi.fn(() => ({ id: "task_1_2" })),
        getTask: vi.fn(() => ({ outputPath })),
      };
    }

    function withBackground(manager: ReturnType<typeof backgroundManager>) {
      return context({
        backgroundTaskManager:
          manager as unknown as ToolContext["backgroundTaskManager"],
      });
    }

    it("hands the shell's own argv to the manager instead of spawn's shell option", async () => {
      const manager = backgroundManager("C:\\temp\\wave-task-1.log");

      const result = await powershellTool.execute(
        { command: "Start-Sleep -Seconds 5", run_in_background: true },
        withBackground(manager),
      );

      expect(result.success).toBe(true);
      expect(result.backgroundTaskId).toBe("task_1_2");
      expect(spawn).not.toHaveBeenCalled();
      expect(manager.startShell).toHaveBeenCalledWith(
        "Start-Sleep -Seconds 5",
        // No default timeout for a background task.
        undefined,
        "/work/project",
        {
          shell: {
            file: PS_PATH,
            args: [
              "-NoProfile",
              "-NonInteractive",
              "-NoLogo",
              "-Command",
              "Start-Sleep -Seconds 5",
            ],
            // A detached 5.1 child never runs its command (measured), so the
            // background process stays attached and windowsHide hides it.
            detached: false,
          },
        },
      );
    });

    it("reports the log path the manager allocated", async () => {
      const manager = backgroundManager("C:\\temp\\wave-task-1.log");

      const result = await powershellTool.execute(
        { command: "Get-ChildItem -Recurse", run_in_background: true },
        withBackground(manager),
      );

      expect(result.content).toContain("background with ID: task_1_2");
      expect(result.content).toContain("C:\\temp\\wave-task-1.log");
      expect(result.shortResult).toContain("task_1_2");
    });

    it("falls back to the Read hint when the manager allocated no log", async () => {
      const result = await powershellTool.execute(
        { command: "Get-ChildItem -Recurse", run_in_background: true },
        withBackground(backgroundManager(undefined)),
      );

      expect(result.content).toContain('task_id="task_1_2"');
    });

    it("keeps an explicit timeout and refuses to start without a manager", async () => {
      const manager = backgroundManager("C:\\temp\\wave-task-1.log");

      await powershellTool.execute(
        { command: "Get-ChildItem", run_in_background: true, timeout: 5000 },
        withBackground(manager),
      );
      expect(manager.startShell).toHaveBeenCalledWith(
        "Get-ChildItem",
        5000,
        "/work/project",
        expect.anything(),
      );

      const result = await powershellTool.execute(
        { command: "Get-ChildItem", run_in_background: true },
        context(),
      );
      expect(result.success).toBe(false);
      expect(result.error).toBe("Background task manager not available");
    });
  });

  describe("manual backgrounding (Ctrl-B)", () => {
    function foregroundManager() {
      const tasks: ForegroundTask[] = [];
      return {
        tasks,
        registerForegroundTask: vi.fn((task: ForegroundTask) => {
          tasks.push(task);
        }),
        unregisterForegroundTask: vi.fn(),
      };
    }

    function withForeground(
      manager: ReturnType<typeof foregroundManager>,
      adoptProcess = vi.fn(() => "task_9_9"),
    ) {
      return context({
        foregroundTaskManager:
          manager as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager: {
          adoptProcess,
          getTask: vi.fn(() => ({ outputPath: "C:\\temp\\wave-task-9.log" })),
        } as unknown as ToolContext["backgroundTaskManager"],
      });
    }

    it("registers a foreground command so the user can move it to the background", async () => {
      const child = spawnChild();
      const fg = foregroundManager();
      const adoptProcess = vi.fn(() => "task_9_9");

      const pending = powershellTool.execute(
        { command: "Start-Sleep -Seconds 60" },
        withForeground(fg, adoptProcess),
      );

      expect(fg.registerForegroundTask).toHaveBeenCalledTimes(1);
      await fg.tasks[0]!.backgroundHandler();

      const result = await pending;
      expect(result.success).toBe(true);
      expect(result.backgroundedByUser).toBe(true);
      expect(result.backgroundTaskId).toBe("task_9_9");
      // Same receipt text the Bash tool returns, so the model reads one contract
      // regardless of which shell ran the command.
      expect(result.content).toBe(
        "Command was manually backgrounded by user with ID: task_9_9. Output is being written to: C:\\temp\\wave-task-9.log",
      );
      expect(adoptProcess).toHaveBeenCalledWith(
        child,
        "Start-Sleep -Seconds 60",
        "",
        "",
      );

      // The adopted process exits later; the tool must not resolve a second
      // time (that would replace the background receipt with an exit result).
      child.finish(0);
      expect(fg.unregisterForegroundTask).toHaveBeenCalled();
    });

    it("unregisters once the foreground command finishes", async () => {
      const child = spawnChild();
      const fg = foregroundManager();

      const pending = powershellTool.execute(
        { command: "Get-ChildItem" },
        withForeground(fg),
      );
      child.finish(0);
      await pending;

      expect(fg.unregisterForegroundTask).toHaveBeenCalledTimes(1);
    });
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
    // One line whatever the script is: the row that prints the label starts a
    // new line at every newline.
    expect(
      powershellTool.formatCompactParams!(
        { command: "Get-ChildItem\n | Where-Object { $_.Length -gt 0 }" },
        context(),
      ),
    ).toBe("Get-ChildItem | Where-Object { $_.Length -gt 0 }");
  });
});
