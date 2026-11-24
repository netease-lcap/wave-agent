import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { powershellTool } from "../../../src/tools/powershellTool/powershellTool.js";
import {
  renderPowerShellResultData,
  type PowerShellResultData,
} from "../../../src/tools/resultData/powershell.js";
import { getShellProvider } from "../../../src/utils/shell/resolveProvider.js";
import type { ShellProvider } from "../../../src/utils/shell/shellProvider.js";
import type { ToolContext } from "../../../src/tools/types.js";
import type { ForegroundTask } from "../../../src/types/processes.js";
import { createMockTaskManager } from "../../helpers/mockFactories.js";

/**
 * `PowerShell` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 每个用例都真跑 `powershellTool.execute()`，只把 spawn / fs / 临时目录探针 / shell
 * provider 这些外部世界换成桩，然后断言两件事：`content` 等于**手写**的期望字面量，
 * 且 `renderPowerShellResultData(data)` 逐字还回同一个 `content`。两边都算了，才能
 * 证明「措辞没漂」而不是「渲染器和自己一致」。
 *
 * 覆盖的分支（与 powershellTool.ts 里产出 content 的地方一一对应）：正常输出、
 * stderr 合流、静默命令、非零退出、两种 `cd` note、后台启动（有/无输出文件）、
 * 手动转后台（有/无输出文件）、超时自动转后台、超时被杀、abort、转后台失败、
 * 长输出落盘、落盘失败就地截断、spawn 失败（'error' 事件与同步抛错）。
 */

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

// abort / 超时分支会走进程树终止（POSIX 进程组 / Windows taskkill），这里只验
// 「有没有走到」，真信号留给 tests/utils/terminateProcessTree.test.ts。
vi.mock("../../../src/utils/terminateProcessTree.js", () => ({
  terminateChildProcessTree: vi.fn(),
}));

vi.mock("../../../src/utils/shell/resolveProvider.js", () => ({
  getShellProvider: vi.fn(),
}));

// 保留真实的临时目录（落盘路径就在它下面），只把探测结果变成可控的。
vi.mock("../../../src/utils/tempDir.js", () => ({
  resolveTempDir: () => os.tmpdir(),
  probeTempDir: () => ({ writable: true }),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
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
 * A child process the test drives event by event: `spawn` is mocked, so the only
 * thing that can advance the tool is an emitted event.
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

/** `data` 必须能逐字还原工具的 `content`——阶段 2 丢掉 `content` 的前提。 */
function expectRendersBack(result: { content: string; data?: unknown }): void {
  expect(renderPowerShellResultData(result.data as PowerShellResultData)).toBe(
    result.content,
  );
}

/** Tracked cwd file present, with this path inside (or outside) the workspace. */
function withTrackedCwd(trackedCwd: string, cwdIsAllowed: boolean) {
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue(trackedCwd);
  const onCwdChange = vi.fn();
  return {
    onCwdChange,
    ctx: context({
      onCwdChange,
      originalWorkdir: "/work/project",
      permissionManager: {
        createContext: vi.fn(() => ({})),
        checkPermission: vi.fn(async () => ({ behavior: "allow" })),
        isPathInWorkingDirectory: () => cwdIsAllowed,
      } as unknown as ToolContext["permissionManager"],
    }),
  };
}

/**
 * The permission check is async, so `execute` only attaches the child's listeners
 * once `spawn` runs — arming the mock up front and awaiting the spawn keeps
 * `finish(0)` from landing on an unattached emitter.
 */
async function runToCompletion(command: string, ctx: ToolContext) {
  const child = spawnChild();
  const promise = powershellTool.execute({ command }, ctx);
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled());
  child.finish(0);
  return promise;
}

describe("PowerShell 的 data → 文本 golden", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getShellProvider).mockReturnValue(provider);
    // No tracked cwd file unless a test says so.
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常输出：正文就是命令自己的输出", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute({ command: "Get-Date" }, context());
    child.stdout.emit("data", Buffer.from("line one\n"));
    child.finish(0);

    const result = await promise;

    expect(result.content).toBe("line one\n");
    expect(result.data).toEqual({
      stdout: "line one\n",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("命令自己的 stderr 合进 stdout：中间用一个换行拼", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Item .\\a.txt" },
      context(),
    );
    child.stdout.emit("data", Buffer.from("line one\n"));
    child.stderr.emit("data", Buffer.from("a warning\n"));
    child.finish(0);

    const result = await promise;

    expect(result.content).toBe("line one\n\na warning\n");
    expect(result.data).toEqual({
      stdout: "line one\n\na warning\n",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("只有 stderr 时正文以那个换行开头（既有口径，与 Bash 工具一致）", async () => {
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
    expect(result.content).toBe("\nCannot find path\n");
    expect(result.data).toEqual({
      stdout: "\nCannot find path\n",
      interrupted: false,
      exitCode: 1,
    });
    expectRendersBack(result);
  });

  it("静默命令：正文是那句带上退出码的话，退出码同时落 data", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute({ command: "exit 0" }, context());
    child.finish(0);

    const result = await promise;

    expect(result.content).toBe("Command executed with exit code: 0");
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      interrupted: false,
      exitCode: 0,
    });
    // 退出码另在 `data.exitCode` —— 与 bash.ts 同一处理（正文里那句是渲染结果）。
    expect((result.data as { exitCode?: number }).exitCode).toBe(0);
    expectRendersBack(result);
  });

  it("cd note 进 stderr，正文里排在命令输出前面", async () => {
    const tracked = withTrackedCwd("/work/project/sub", true);

    const result = await runToCompletion("Set-Location sub", tracked.ctx);

    expect(result.content).toBe(
      "Shell working directory changed to /work/project/sub\nCommand executed with exit code: 0",
    );
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      stderr: "Shell working directory changed to /work/project/sub",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("权限外目录：note 是 reset 措辞，同样只进 data.stderr", async () => {
    const tracked = withTrackedCwd("/work/project/.wave/memory", false);

    const result = await runToCompletion(
      "Set-Location .wave/memory",
      tracked.ctx,
    );

    expect(result.content).toBe(
      "Shell cwd was reset to /work/project\nCommand executed with exit code: 0",
    );
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      stderr: "Shell cwd was reset to /work/project",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("后台启动：有输出文件时正文给出路径", async () => {
    const result = await powershellTool.execute(
      { command: "Get-ChildItem -Recurse", run_in_background: true },
      context({
        backgroundTaskManager: {
          startShell: vi.fn(() => ({ id: "task_bg" })),
          getTask: vi.fn(() => ({ outputPath: "C:\\temp\\wave-task-bg.log" })),
        } as unknown as ToolContext["backgroundTaskManager"],
      }),
    );

    expect(result.content).toBe(
      "Command running in background with ID: task_bg. Output is being written to: C:\\temp\\wave-task-bg.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_bg",
      backgroundOutputPath: "C:\\temp\\wave-task-bg.log",
    });
    // 阶段 1：顶层字段照旧并存。
    expect(result.backgroundTaskId).toBe("task_bg");
    expectRendersBack(result);
  });

  it("后台启动：拿不到输出文件时改成让模型用 Read 读", async () => {
    const result = await powershellTool.execute(
      { command: "Get-ChildItem -Recurse", run_in_background: true },
      context({
        backgroundTaskManager: {
          startShell: vi.fn(() => ({ id: "task_bg" })),
          getTask: vi.fn(() => ({})),
        } as unknown as ToolContext["backgroundTaskManager"],
      }),
    );

    expect(result.content).toBe(
      'Command running in background with ID: task_bg. Use Read tool with task_id="task_bg" to read the output.',
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_bg",
    });
    expectRendersBack(result);
  });

  it("用户手动转后台：backgroundedByUser 同时进 data 与顶层", async () => {
    const child = spawnChild();
    const tasks: ForegroundTask[] = [];
    const foregroundTaskManager = {
      registerForegroundTask: vi.fn((task: ForegroundTask) => {
        tasks.push(task);
      }),
      unregisterForegroundTask: vi.fn(),
    };

    const pending = powershellTool.execute(
      { command: "Start-Sleep -Seconds 60" },
      context({
        foregroundTaskManager:
          foregroundTaskManager as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager: {
          adoptProcess: vi.fn(() => "task_9_9"),
          getTask: vi.fn(() => ({ outputPath: "C:\\temp\\wave-task-9.log" })),
        } as unknown as ToolContext["backgroundTaskManager"],
      }),
    );

    await tasks[0]!.backgroundHandler();
    const result = await pending;

    expect(result.content).toBe(
      "Command was manually backgrounded by user with ID: task_9_9. Output is being written to: C:\\temp\\wave-task-9.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_9_9",
      backgroundedByUser: true,
      backgroundOutputPath: "C:\\temp\\wave-task-9.log",
    });
    expect(result.backgroundedByUser).toBe(true);
    expectRendersBack(result);

    // The adopted process exits later; it must not resolve a second time.
    child.finish(0);
  });

  it("手动转后台但没拿到输出文件：正文以句号收尾，不多一个空格", async () => {
    const child = spawnChild();
    const tasks: ForegroundTask[] = [];

    const pending = powershellTool.execute(
      { command: "Start-Sleep -Seconds 60" },
      context({
        foregroundTaskManager: {
          registerForegroundTask: vi.fn((task: ForegroundTask) => {
            tasks.push(task);
          }),
          unregisterForegroundTask: vi.fn(),
        } as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager: {
          adoptProcess: vi.fn(() => "task_9_9"),
          getTask: vi.fn(() => ({})),
        } as unknown as ToolContext["backgroundTaskManager"],
      }),
    );

    await tasks[0]!.backgroundHandler();
    const result = await pending;

    expect(result.content).toBe(
      "Command was manually backgrounded by user with ID: task_9_9.",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_9_9",
      backgroundedByUser: true,
    });
    expectRendersBack(result);

    child.finish(0);
  });

  it("超时自动转后台：秒数由 data.timeoutMs 现算", async () => {
    vi.useFakeTimers();
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-ChildItem -Recurse", timeout: 5000 },
      context({
        foregroundTaskManager: {
          registerForegroundTask: vi.fn(),
          unregisterForegroundTask: vi.fn(),
        } as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager: {
          adoptProcess: vi.fn(() => "task_auto_1"),
          getTask: vi.fn(() => ({
            outputPath: "C:\\temp\\wave-task-auto.log",
          })),
        } as unknown as ToolContext["backgroundTaskManager"],
      }),
    );

    await vi.advanceTimersByTimeAsync(5000);
    const result = await promise;

    expect(result.content).toBe(
      "Command exceeded the timeout (5s) and was moved to the background with ID: task_auto_1. It is still running — you will be notified when it completes. Output is being written to: C:\\temp\\wave-task-auto.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_auto_1",
      assistantAutoBackgrounded: true,
      backgroundOutputPath: "C:\\temp\\wave-task-auto.log",
      timeoutMs: 5000,
    });
    expect(result.assistantAutoBackgrounded).toBe(true);
    expectRendersBack(result);

    child.finish(0);
  });

  it("超时被杀：原因替代空输出，中断标记与 130 都进 data", async () => {
    vi.useFakeTimers();
    spawnChild();

    const promise = powershellTool.execute(
      { command: "Start-Sleep -Seconds 10", timeout: 1000 },
      context(),
    );
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    const reason =
      "Command timed out after 1s. Consider breaking the command into smaller steps or increasing the timeout.";
    expect(result.success).toBe(false);
    expect(result.error).toBe(reason);
    expect(result.content).toBe(reason);
    expect(result.data).toEqual({
      stdout: "",
      interrupted: true,
      interruptedReason: reason,
      exitCode: 130,
    });
    expectRendersBack(result);
  });

  it("abort：已有的输出在上、原因在下", async () => {
    const child = spawnChild();
    const controller = new AbortController();

    const promise = powershellTool.execute(
      { command: "Start-Sleep -Seconds 10" },
      context({ abortSignal: controller.signal }),
    );
    child.stdout.emit("data", Buffer.from("partial"));
    controller.abort();

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.content).toBe("partial\n\nCommand execution was aborted");
    expect(result.data).toEqual({
      stdout: "partial",
      interrupted: true,
      interruptedReason: "Command execution was aborted",
      exitCode: 130,
    });
    expectRendersBack(result);
  });

  it("转后台失败：reason 走的是中断分支，data 里那句就是正文", async () => {
    spawnChild();
    const tasks: ForegroundTask[] = [];

    const pending = powershellTool.execute(
      { command: "Get-ChildItem" },
      context({
        foregroundTaskManager: {
          registerForegroundTask: vi.fn((task: ForegroundTask) => {
            tasks.push(task);
          }),
          unregisterForegroundTask: vi.fn(),
        } as unknown as ToolContext["foregroundTaskManager"],
      }),
    );

    await tasks[0]!.backgroundHandler();
    const result = await pending;

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "Failed to background: Background task manager not available",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: true,
      interruptedReason:
        "Failed to background: Background task manager not available",
      exitCode: 130,
    });
    expectRendersBack(result);
  });

  it("长输出：整段落盘、正文换成 <persisted-output>，data.stdout 只留算预览的那段", async () => {
    const largeOutput = "a".repeat(30001);
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Content .\\big.txt" },
      context(),
    );
    child.stdout.emit("data", Buffer.from(largeOutput));
    child.finish(0);

    const result = await promise;

    const writes = vi.mocked(fs.writeFileSync).mock.calls;
    expect(writes).toHaveLength(1);
    const [filePath, written] = writes[0]!;
    expect(written).toBe(largeOutput);
    expect(String(filePath)).toContain("wave-tool-results");

    expect(result.content).toBe(
      [
        "<persisted-output>",
        `Output too large (${(30001).toLocaleString()} characters). Full output saved to: ${filePath}`,
        `Preview (first ${(2048).toLocaleString()} characters):`,
        `${"a".repeat(2048)}\n...`,
        "</persisted-output>",
      ].join("\n"),
    );
    expect(result.data).toEqual({
      stdout: "a".repeat(30000),
      interrupted: false,
      exitCode: 0,
      persistedOutputPath: filePath,
      persistedOutputSize: 30001,
    });
    expectRendersBack(result);
  });

  it("落盘失败：就地截断，data 里没有路径（与 processToolResult 的兜底同形）", async () => {
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error("ENOSPC");
    });
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Content .\\big.txt" },
      context(),
    );
    child.stdout.emit("data", Buffer.from("a".repeat(30001)));
    child.finish(0);

    const result = await promise;

    expect(result.content).toBe(
      "a".repeat(30000) +
        "\n\n... (output truncated, failed to persist full output)",
    );
    expect(result.data).toEqual({
      stdout: "a".repeat(30001),
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("spawn 失败：content 是空串，没有 data（模型侧退回 error）", async () => {
    const child = spawnChild();

    const promise = powershellTool.execute(
      { command: "Get-Location" },
      context(),
    );
    child.emit("error", new Error("ENOENT"));

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("Failed to execute command: ENOENT");
    expect(result.data).toBeUndefined();
  });

  it("spawn 同步抛错：同样没有 data", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error("boom");
    });

    const result = await powershellTool.execute(
      { command: "Get-Location" },
      context(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("Failed to execute command: boom");
    expect(result.data).toBeUndefined();
  });
});
