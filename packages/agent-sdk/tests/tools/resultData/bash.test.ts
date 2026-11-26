import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { bashTool } from "../../../src/tools/bashTool.js";
import {
  renderBashResultData,
  type BashResultData,
} from "../../../src/tools/resultData/bash.js";
import type { ToolContext } from "../../../src/tools/types.js";
import { createMockTaskManager } from "../../helpers/mockFactories.js";

/**
 * `Bash` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 每个用例都真跑 `bashTool.execute()`，只把 spawn / fs / 临时目录探针这些外部
 * 世界换成桩，然后断言两件事：`content` 等于手写的期望字面量，且
 * `renderBashResultData(data)` 逐字还回同一个 `content`。两边都算了，才能证明
 * 「措辞没漂」而不是「渲染器和自己一致」。
 *
 * 覆盖的分支（与 bashTool.ts 里产出 content 的地方一一对应）：正常输出、静默命令、
 * 非零退出、stdout/stderr 合并、两种 `cd` note、会话 cwd 恢复、临时目录不可写、
 * 磁盘/ inode 压力、后台启动（有/无输出文件）、手动转后台、超时自动转后台、超时
 * 被杀、abort、长输出落盘、spawn 失败。
 */

vi.mock("child_process");
// child_process 被 mock 了，会话快照（要 spawn 一个 login shell）永远拿不到结果：
// 按「不可用」钉住，免得每个用例多等一层超时。
vi.mock("../../../src/utils/shell/shellSnapshot.js", () => ({
  getShellSnapshot: vi.fn(async () => undefined),
}));

// shell 的「发现层」才是跟宿主机走的那一半，而本文件把 `fs` 整个 mock 了，
// 所以真解析器在盘上什么都找不到；Windows 分支还要求 `WAVE_GIT_BASH_PATH` 指向
// 真实存在的 bash/sh 文件（#3108），mock 下恒假 ⇒ 工具直接返回「Git Bash not found」，
// 一个用例都到不了真分支。这里把解析结果钉住；provider 与它拼出的
// `eval '…' && pwd -P` 包装仍是真实现，`cd` 那两个用例靠的就是它。
vi.mock("../../../src/utils/shellResolver.js", () => ({
  resolveShellPath: vi.fn(),
}));

vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    accessSync: vi.fn(),
    constants: { F_OK: 0 },
  };
});

// 保留真实的临时目录（落盘路径就在它下面），只把探测结果与 statfs 变成可控的。
vi.mock("../../../src/utils/tempDir.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../src/utils/tempDir.js")
  >("../../../src/utils/tempDir.js");
  return {
    ...actual,
    resolveTempDir: vi.fn(() => os.tmpdir()),
    probeTempDir: vi.fn(() => ({ writable: true })),
    readDiskPressure: vi.fn(() => ({})),
  };
});

vi.mock("../../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
  clearGlobalLogger: vi.fn(),
  isLoggerConfigured: vi.fn(),
}));

// abort 分支会走进程树终止（POSIX 进程组 / Windows taskkill），这里只验「有没有
// 走到」，真信号留给 tests/utils/terminateProcessTree.test.ts。
vi.mock("../../../src/utils/terminateProcessTree.js", () => ({
  terminateChildProcessTree: vi.fn(),
}));

import { probeTempDir, readDiskPressure } from "../../../src/utils/tempDir.js";
import { resolveShellPath } from "../../../src/utils/shellResolver.js";

const mockSpawn = vi.mocked(spawn);
const WORKDIR = "/test/workdir";

interface ChildSpec {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  /** 命令结束时 `pwd -P` 写进临时文件的新 cwd（触发 `cd` note）。 */
  cwd?: string;
}

/** 一个只说「这些数据、这个退出码」的假子进程。 */
function fakeChild(spec: ChildSpec = {}): ChildProcess {
  const { stdout = "", stderr = "", exitCode = 0, cwd } = spec;
  return {
    pid: 1234,
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stdout) {
          setTimeout(() => callback(Buffer.from(stdout)), 10);
        }
      }),
    },
    stderr: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stderr) {
          setTimeout(() => callback(Buffer.from(stderr)), 10);
        }
      }),
    },
    on: vi.fn((event: string, callback: (code: number) => void) => {
      if (event === "exit") {
        setTimeout(() => {
          if (cwd) {
            // `pwd -P` 那一跳：临时文件存在，内容是新的 cwd。
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue(`${cwd}\n`);
          }
          callback(exitCode);
        }, 20);
      }
    }),
    kill: vi.fn(),
    killed: false,
  } as unknown as ChildProcess;
}

/**
 * 一个永远不结束的假子进程：转后台、超时、abort 三条分支的前提都是「它还在跑」，
 * 用会自己退出的假进程会让正常完成分支先赢。
 */
function hangingChild(spec: { stdout?: string } = {}): ChildProcess {
  const { stdout = "" } = spec;
  return {
    pid: 1234,
    stdout: {
      on: vi.fn((event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stdout) {
          setTimeout(() => callback(Buffer.from(stdout)), 10);
        }
      }),
    },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    killed: false,
  } as unknown as ChildProcess;
}

/** `data` 必须能逐字还原工具的 `content`——阶段 2 丢掉 `content` 的前提。 */
function expectRendersBack(result: { content: string; data?: unknown }): void {
  expect(renderBashResultData(result.data as BashResultData)).toBe(
    result.content,
  );
}

/** 走一遍权限闸门：`cd` 的两个用例需要它给出 workspace 判定。 */
function permissionManager(inWorkingDirectory: boolean) {
  return {
    createContext: vi.fn().mockReturnValue({}),
    checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
    isPathInWorkingDirectory: vi.fn().mockReturnValue(inWorkingDirectory),
  } as unknown as ToolContext["permissionManager"];
}

describe("Bash 的 data → 文本 golden", () => {
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(probeTempDir).mockReturnValue({ writable: true });
    vi.mocked(readDiskPressure).mockReturnValue({});
    // 解析层已在模块级 mock（见上面的 `shellResolver` `vi.mock`）：给一个固定路径，
    // 用例就不再取决于宿主机装没装 Git Bash。
    vi.mocked(resolveShellPath).mockReturnValue("/bin/bash");
    context = {
      workdir: WORKDIR,
      taskManager: createMockTaskManager(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正常输出：正文就是命令自己的输出", async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: "test output" }));

    const result = await bashTool.execute({ command: "echo hello" }, context);

    expect(result.content).toBe("test output");
    expect(result.data).toEqual({
      stdout: "test output",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("静默命令：正文是那句带上退出码的话，退出码同时落 data", async () => {
    mockSpawn.mockReturnValue(fakeChild({ exitCode: 0 }));

    const result = await bashTool.execute({ command: "true" }, context);

    expect(result.content).toBe("Command executed with exit code: 0");
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      interrupted: false,
      exitCode: 0,
    });
    // 正文里的那句与 `data.exitCode` 是同一个值：`$` 的出口码判定与宿主卡片读
    // 后者（阶段 2 之前它是 `ToolResult.metadata.exitCode`）。
    expect((result.data as { exitCode?: number }).exitCode).toBe(0);
    expectRendersBack(result);
  });

  it("命令自己的 stderr 合进 stdout：中间用一个换行拼", async () => {
    mockSpawn.mockReturnValue(
      fakeChild({ stdout: "line 1", stderr: "line 2", exitCode: 1 }),
    );

    const result = await bashTool.execute({ command: "false" }, context);

    // 非零退出是命令自己的答案，不是这次调用失败；`Exit code N` 那一行照 CC 由工具
    // 写进 `stdout`（spec core/bash-tools.md「退出码不是工具成败」）。
    expect(result.success).toBe(true);
    expect(result.content).toBe("line 1\nline 2\nExit code 1");
    expect(result.data).toEqual({
      stdout: "line 1\nline 2\nExit code 1",
      interrupted: false,
      exitCode: 1,
      returnCodeInterpretation: "Command failed with exit code: 1",
    });
    expectRendersBack(result);
  });

  it("只有 stderr 时正文以那个换行开头（既有口径，改了会伤 REPL）", async () => {
    mockSpawn.mockReturnValue(
      fakeChild({ stderr: "error message", exitCode: 1 }),
    );

    const result = await bashTool.execute({ command: "false" }, context);

    expect(result.content).toBe("\nerror message\nExit code 1");
    expect(result.data).toEqual({
      stdout: "\nerror message\nExit code 1",
      interrupted: false,
      exitCode: 1,
      returnCodeInterpretation: "Command failed with exit code: 1",
    });
    expectRendersBack(result);
  });

  it("cd note 进 stderr，正文里排在命令输出前面", async () => {
    // `pwd -P` 交回来的是 shell 的**原生**路径，`cd` note 直接插值它，不归一成
    // 正斜杠（与 CC 一致，见 src/tools/bashTool.ts 的 `Shell working directory
    // changed to ${newCwd}`）。所以落点要在本平台是合法绝对路径：写死
    // `/test/workdir/subdir` 在 Windows 上没有盘符，会被规范化成 `\test\…`。
    const subdir = path.resolve(WORKDIR, "subdir");
    mockSpawn.mockReturnValue(fakeChild({ exitCode: 0, cwd: subdir }));

    const result = await bashTool.execute(
      { command: "cd subdir" },
      {
        ...context,
        onCwdChange: vi.fn(),
        originalWorkdir: WORKDIR,
        permissionManager: permissionManager(true),
      },
    );

    expect(result.content).toBe(
      `Shell working directory changed to ${subdir}\nCommand executed with exit code: 0`,
    );
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      stderr: `Shell working directory changed to ${subdir}`,
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("权限外目录：回写 originalWorkdir，note 是 reset 措辞", async () => {
    mockSpawn.mockReturnValue(
      fakeChild({ exitCode: 0, cwd: "/home/liuyiqi/other-dir" }),
    );

    const result = await bashTool.execute(
      { command: "cd /home/liuyiqi/other-dir" },
      {
        ...context,
        onCwdChange: vi.fn(),
        originalWorkdir: WORKDIR,
        permissionManager: permissionManager(false),
      },
    );

    expect(result.content).toBe(
      "Shell cwd was reset to /test/workdir\nCommand executed with exit code: 0",
    );
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 0",
      stderr: "Shell cwd was reset to /test/workdir",
      interrupted: false,
      exitCode: 0,
    });
    expectRendersBack(result);
  });

  it("会话 cwd 被自动恢复：提示排在正文最前面，from/to 留在 data 里", async () => {
    mockSpawn.mockReturnValue(fakeChild({ stdout: "test output" }));

    const result = await bashTool.execute(
      { command: "echo hello" },
      {
        ...context,
        aiManager: {
          consumeCwdRecovery: vi.fn().mockReturnValue({
            from: "/repo/.wave/worktrees/feat-a",
            to: "/repo",
          }),
        } as unknown as ToolContext["aiManager"],
      },
    );

    expect(result.content).toBe(
      "Note: working directory /repo/.wave/worktrees/feat-a no longer exists; session working directory recovered to /repo.\ntest output",
    );
    expect(result.data).toEqual({
      stdout: "test output",
      interrupted: false,
      exitCode: 0,
      cwdRecovery: {
        from: "/repo/.wave/worktrees/feat-a",
        to: "/repo",
      },
    });
    expectRendersBack(result);
  });

  it("临时目录不可写：只存 errno，渲染器重建整段说明", async () => {
    vi.mocked(probeTempDir).mockReturnValue({
      writable: false,
      code: "EDQUOT",
    });
    mockSpawn.mockReturnValue(fakeChild({ stdout: "test output" }));

    const result = await bashTool.execute({ command: "echo hello" }, context);

    const dir = os.tmpdir();
    expect(result.content).toBe(
      `The temporary directory ${dir} is not writable (EDQUOT: the user's disk quota on that volume is used up), so shell working-directory tracking is disabled and anything the agent would persist there (long tool output, background-task logs) will be lost. Either free space on the volume holding ${dir}, or restart with WAVE_TMPDIR pointing at a directory on another volume (e.g. WAVE_TMPDIR=/var/tmp/wave).\ntest output`,
    );
    expect(result.data).toEqual({
      stdout: "test output",
      interrupted: false,
      exitCode: 0,
      tempDir: { path: dir, code: "EDQUOT" },
    });
    expectRendersBack(result);
  });

  it("失败时临时卷快满：诊断段接在正文最后", async () => {
    vi.mocked(readDiskPressure).mockReturnValue({ freeBytes: 1024 * 1024 });
    mockSpawn.mockReturnValue(
      fakeChild({ stderr: "write error", exitCode: 1 }),
    );

    const result = await bashTool.execute({ command: "cp a b" }, context);

    const dir = os.tmpdir();
    // `Exit code N` 在 `stdout` 里（工具写的），诊断段接在正文最后。
    expect(result.content).toBe(
      `\nwrite error\nExit code 1\n\nDisk nearly full: ${dir} (the agent's temporary directory) has 1 MB free, so this command — or another process on the same volume — may have failed for that reason.`,
    );
    expect(result.data).toEqual({
      stdout: "\nwrite error\nExit code 1",
      interrupted: false,
      exitCode: 1,
      returnCodeInterpretation: "Command failed with exit code: 1",
      diskPressure: { path: dir, freeBytes: 1024 * 1024 },
    });
    expectRendersBack(result);
  });

  it("卷很健康时诊断段整段不出现（data 里也没有）", async () => {
    vi.mocked(readDiskPressure).mockReturnValue({
      freeBytes: 100 * 1024 * 1024 * 1024,
      freeInodes: 1_000_000,
    });
    mockSpawn.mockReturnValue(fakeChild({ exitCode: 1 }));

    const result = await bashTool.execute({ command: "false" }, context);

    // 量过了但健康：读数留在 data 里，渲染器什么都不说。
    expect(result.content).toBe("Command executed with exit code: 1");
    expect(result.data).toEqual({
      stdout: "Command executed with exit code: 1",
      interrupted: false,
      exitCode: 1,
      // 空输出那句已经报了退出码，所以正文不再补 `Exit code 1`（下面断言的就是它）。
      returnCodeInterpretation: "Command failed with exit code: 1",
      diskPressure: {
        path: os.tmpdir(),
        freeBytes: 100 * 1024 * 1024 * 1024,
        freeInodes: 1_000_000,
      },
    });
    expectRendersBack(result);
  });

  it("后台启动：有输出文件时正文给出路径", async () => {
    const result = await bashTool.execute(
      { command: "npm run dev", run_in_background: true },
      {
        ...context,
        backgroundTaskManager: {
          startShell: vi.fn().mockReturnValue({ id: "task_bg" }),
          getTask: vi.fn().mockReturnValue({ outputPath: "/tmp/bg.log" }),
        } as unknown as ToolContext["backgroundTaskManager"],
      },
    );

    expect(result.content).toBe(
      "Command running in background with ID: task_bg. Output is being written to: /tmp/bg.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_bg",
      backgroundOutputPath: "/tmp/bg.log",
    });
    // 阶段 1：顶层字段照旧并存。
    expect(result.backgroundTaskId).toBe("task_bg");
    expectRendersBack(result);
  });

  it("后台启动：拿不到输出文件时改成让模型用 Read 读", async () => {
    const result = await bashTool.execute(
      { command: "npm run dev", run_in_background: true },
      {
        ...context,
        backgroundTaskManager: {
          startShell: vi.fn().mockReturnValue({ id: "task_bg" }),
          getTask: vi.fn().mockReturnValue(undefined),
        } as unknown as ToolContext["backgroundTaskManager"],
      },
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
    mockSpawn.mockReturnValue(hangingChild());

    let backgroundHandler: (() => Promise<void>) | undefined;
    const foregroundTaskManager = {
      registerForegroundTask: vi.fn(({ backgroundHandler: handler }) => {
        backgroundHandler = handler;
      }),
      unregisterForegroundTask: vi.fn(),
    };
    const backgroundTaskManager = {
      adoptProcess: vi.fn().mockReturnValue("task_adopted"),
      getTask: vi.fn().mockReturnValue({ outputPath: "/tmp/test.log" }),
    };

    const promise = bashTool.execute(
      { command: "long" },
      {
        ...context,
        foregroundTaskManager:
          foregroundTaskManager as unknown as ToolContext["foregroundTaskManager"],
        backgroundTaskManager:
          backgroundTaskManager as unknown as ToolContext["backgroundTaskManager"],
      },
    );

    // 会话快照是异步的，前台任务（以及转后台的 handler）要等它落地才存在。
    await vi.waitFor(() =>
      expect(foregroundTaskManager.registerForegroundTask).toHaveBeenCalled(),
    );
    await backgroundHandler!();

    const result = await promise;

    expect(result.content).toBe(
      "Command was manually backgrounded by user with ID: task_adopted. It is still running — you will be notified when it completes. Do not start it again. Output is being written to: /tmp/test.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_adopted",
      backgroundedByUser: true,
      backgroundOutputPath: "/tmp/test.log",
    });
    expect(result.backgroundedByUser).toBe(true);
    expectRendersBack(result);
  });

  it("超时自动转后台：秒数由 data.timeoutMs 现算", async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(hangingChild());

    const promise = bashTool.execute(
      { command: "long-build", timeout: 1000 },
      {
        ...context,
        backgroundTaskManager: {
          adoptProcess: vi.fn().mockReturnValue("task_auto"),
          getTask: vi.fn().mockReturnValue({ outputPath: "/tmp/auto.log" }),
        } as unknown as ToolContext["backgroundTaskManager"],
      },
    );

    await vi.advanceTimersByTimeAsync(1001);
    const result = await promise;

    expect(result.content).toBe(
      "Command exceeded the timeout (1s) and was moved to the background with ID: task_auto. It is still running — you will be notified when it completes. Output is being written to: /tmp/auto.log",
    );
    expect(result.data).toEqual({
      stdout: "",
      interrupted: false,
      backgroundTaskId: "task_auto",
      assistantAutoBackgrounded: true,
      backgroundOutputPath: "/tmp/auto.log",
      timeoutMs: 1000,
    });
    expect(result.assistantAutoBackgrounded).toBe(true);
    expectRendersBack(result);
  });

  it("超时被杀：原因替代空输出，中断标记与 130 都进 data", async () => {
    vi.useFakeTimers();
    mockSpawn.mockReturnValue(hangingChild());

    const promise = bashTool.execute(
      { command: "sleep 10", timeout: 1000 },
      context,
    );

    await vi.advanceTimersByTimeAsync(1001);
    const result = await promise;

    // 中断是失败（CC 的 mapper 用 `is_error: interrupted`）：原因句既在正文里，也在
    // `error` 里给宿主与 `$`。
    expect(result.success).toBe(false);
    expect(result.error).toBe("Command timed out");
    expect(result.content).toBe("Command timed out");
    expect(result.data).toEqual({
      stdout: "",
      interrupted: true,
      interruptedReason: "Command timed out",
      exitCode: 130,
    });
    expectRendersBack(result);
  });

  it("abort：已有的输出在上、原因在下", async () => {
    mockSpawn.mockReturnValue(hangingChild({ stdout: "partial" }));

    const abortController = new AbortController();
    const promise = bashTool.execute(
      { command: "sleep 10" },
      { ...context, abortSignal: abortController.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    abortController.abort();

    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Command execution was aborted");
    expect(result.content).toBe("partial\n\nCommand execution was aborted");
    expect(result.data).toEqual({
      stdout: "partial",
      interrupted: true,
      interruptedReason: "Command execution was aborted",
      exitCode: 130,
    });
    expectRendersBack(result);
  });

  it("长输出：整段落盘、正文换成 <persisted-output>，data.stdout 只留算预览的那段", async () => {
    const largeOutput = "a".repeat(30001);
    mockSpawn.mockReturnValue(fakeChild({ stdout: largeOutput }));

    const result = await bashTool.execute({ command: "large-output" }, context);

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

  it("spawn 失败：content 是空串，cwd 恢复提示只能跟在 error 里", async () => {
    mockSpawn.mockReturnValue({
      pid: 1234,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, callback: (error: Error) => void) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("spawn failed")), 10);
        }
      }),
      kill: vi.fn(),
      killed: false,
    } as unknown as ChildProcess);

    const result = await bashTool.execute(
      { command: "echo hello" },
      {
        ...context,
        aiManager: {
          consumeCwdRecovery: vi.fn().mockReturnValue({
            from: "/repo/.wave/worktrees/feat-a",
            to: "/repo",
          }),
        } as unknown as ToolContext["aiManager"],
      },
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe(
      "Note: working directory /repo/.wave/worktrees/feat-a no longer exists; session working directory recovered to /repo.\nFailed to execute command: spawn failed",
    );
    // 没有正文就没有 data：`aiManager` 会退回 `Error: ${error}`。
    expect(result.data).toBeUndefined();
  });
});
