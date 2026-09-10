import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type {
  BackgroundShell,
  BackgroundSubagent,
} from "../../src/types/processes.js";
import type { ChildProcess } from "child_process";

const { readTailTextSyncMock } = vi.hoisted(() => ({
  readTailTextSyncMock: vi.fn(),
}));

vi.mock("../../src/utils/fileUtils.js", () => ({
  readTailTextSync: readTailTextSyncMock,
}));

function subagentTask(
  overrides: Partial<BackgroundSubagent> = {},
): BackgroundSubagent {
  return {
    id: "task_1",
    type: "subagent",
    status: "running",
    startTime: 1000,
    description: "explore the repo",
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

describe("BackgroundTaskManager.getOutput — log-file tail fallback", () => {
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new BackgroundTaskManager(new Container(), {
      workdir: "/tmp/test",
    });
  });

  it("returns the log-file tail for a running agent task with an empty buffer", () => {
    // Repro: a background subagent writes its tool-call log to outputPath
    // continuously but only fills task.stdout on the terminal snapshot, so the
    // in-memory buffer is empty for the whole run and /tasks showed "(无输出)".
    readTailTextSyncMock.mockReturnValue(
      "[2026-01-01T00:00:00.000Z] Read src/index.ts\n[2026-01-01T00:00:01.000Z] Bash ls\n",
    );
    manager.addTask(
      subagentTask({ outputPath: "/tmp/wave-subagent-task_1.log" }),
    );

    const output = manager.getOutput("task_1");

    expect(readTailTextSyncMock).toHaveBeenCalledWith(
      "/tmp/wave-subagent-task_1.log",
    );
    expect(output?.stdout).toBe(
      "[2026-01-01T00:00:00.000Z] Read src/index.ts\n[2026-01-01T00:00:01.000Z] Bash ls\n",
    );
  });

  it("strips ANSI colors from the file tail", () => {
    readTailTextSyncMock.mockReturnValue("\u001b[31mred line\u001b[0m\n");
    manager.addTask(subagentTask({ outputPath: "/tmp/task.log" }));

    expect(manager.getOutput("task_1")?.stdout).toBe("red line\n");
  });

  it("degrades to the in-memory value when the file is unreadable", () => {
    // readTailTextSync returns "" for a missing/unreadable file.
    readTailTextSyncMock.mockReturnValue("");
    manager.addTask(subagentTask({ outputPath: "/tmp/gone.log" }));

    const output = manager.getOutput("task_1");

    expect(output?.stdout).toBe("");
    expect(output?.status).toBe("running");
  });

  it("does not read the file when the task has no outputPath", () => {
    manager.addTask(subagentTask());

    expect(manager.getOutput("task_1")?.stdout).toBe("");
    expect(readTailTextSyncMock).not.toHaveBeenCalled();
  });

  it("does not read the file for a shell task (its buffer is accumulated live)", () => {
    // shell.stdout grows chunk by chunk and is authoritative — reading the
    // identical file tail on top of it would duplicate the text.
    const shell: BackgroundShell = {
      id: "task_2",
      type: "shell",
      status: "running",
      startTime: 1000,
      command: "npm run build",
      stdout: "$ npm run build\n> building...\n",
      stderr: "",
      outputPath: "/tmp/wave-task-task_2.log",
      process: {} as ChildProcess,
    };
    manager.addTask(shell);

    const output = manager.getOutput("task_2");

    expect(output?.stdout).toBe("$ npm run build\n> building...\n");
    expect(readTailTextSyncMock).not.toHaveBeenCalled();
  });

  it("does not read the file once the task is terminal", () => {
    manager.addTask(
      subagentTask({
        status: "completed",
        stdout: "final answer",
        outputPath: "/tmp/task.log",
      }),
    );

    expect(manager.getOutput("task_1")?.stdout).toBe("final answer");
    expect(readTailTextSyncMock).not.toHaveBeenCalled();
  });

  it("applies the regex filter to the file-tail fallback", () => {
    readTailTextSyncMock.mockReturnValue("keep me\ndrop me\nkeep me too\n");
    manager.addTask(subagentTask({ outputPath: "/tmp/task.log" }));

    expect(manager.getOutput("task_1", "keep")?.stdout).toBe(
      "keep me\nkeep me too",
    );
  });

  it("returns null for an unknown task", () => {
    expect(manager.getOutput("nope")).toBeNull();
  });
});
