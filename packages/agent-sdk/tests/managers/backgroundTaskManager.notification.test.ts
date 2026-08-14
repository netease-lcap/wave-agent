import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";

const handlers = new Map<string, (arg?: number | Error) => void>();

vi.mock("child_process", () => ({
  spawn: vi.fn(() => {
    const child = {
      on: vi.fn((event: string, cb: (arg?: number | Error) => void) => {
        handlers.set(event, cb);
      }),
      off: vi.fn(),
      stdout: { on: vi.fn(), off: vi.fn() },
      stderr: { on: vi.fn(), off: vi.fn() },
      kill: vi.fn(),
      pid: 12345,
    };
    return child;
  }),
  execFile: vi.fn(),
}));

// Deterministic shell path for the spawn-shape assertions.
vi.mock("../../src/utils/shellResolver.js", () => ({
  resolveShellPath: vi.fn(() => "/bin/bash"),
  setShellIfWindows: vi.fn(),
}));

// Mock fs. Both named exports (namespace-imported by backgroundTaskManager)
// and a default export (default-imported by shellResolver) are required —
// on a real win32 runner resolveShellPath() probes Git Bash via fs.existsSync.
vi.mock("fs", () => {
  const createWriteStream = vi.fn(() => ({
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  }));
  const existsSync = vi.fn(() => false);
  return {
    createWriteStream,
    existsSync,
    default: { createWriteStream, existsSync },
  };
});

import { execFile, spawn } from "child_process";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import {
  getShellSnapshotPath,
  resetShellSnapshotCache,
} from "../../src/utils/shellSnapshot.js";
const mockSpawn = vi.mocked(spawn);
const mockExecFile = vi.mocked(execFile);

describe("BackgroundTaskManager - Message Queue", () => {
  let container: Container;
  let messageQueue: MessageQueue;
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    handlers.clear();
    resetShellSnapshotCache();
    container = new Container();
    messageQueue = new MessageQueue();
    container.register("MessageQueue", messageQueue);

    manager = new BackgroundTaskManager(container, {
      workdir: "/test/workdir",
    });
  });

  it("should enqueue notification when shell task completes", () => {
    manager.startShell("echo hello");

    const exitHandler = handlers.get("exit");
    exitHandler?.(0);

    expect(messageQueue.hasNotifications()).toBe(true);
    const notifications = messageQueue.drainNotifications();
    expect(notifications.length).toBe(1);
    expect(notifications[0]).toContain("<task-id>");
    expect(notifications[0]).toContain("<status>completed</status>");
    expect(notifications[0]).toContain("<task-type>shell</task-type>");
  });

  it("should enqueue notification when shell task fails", () => {
    manager.startShell("false");

    const exitHandler = handlers.get("exit");
    exitHandler?.(1);

    expect(messageQueue.hasNotifications()).toBe(true);
    const notifications = messageQueue.drainNotifications();
    expect(notifications[0]).toContain("<status>failed</status>");
  });

  it("should enqueue notification on process error", () => {
    manager.startShell("echo test");

    const errorHandler = handlers.get("error");
    errorHandler?.(new Error("spawn error"));

    expect(messageQueue.hasNotifications()).toBe(true);
    const notifications = messageQueue.drainNotifications();
    expect(notifications[0]).toContain("<status>failed</status>");
    expect(notifications[0]).toContain("spawn error");
  });

  it("should NOT enqueue notification when task is killed", () => {
    manager.startShell("sleep 999");
    const tasks = manager.getAllTasks();
    const taskId = tasks[0].id;

    manager.stopTask(taskId);

    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("should not enqueue notification when MessageQueue is not available", () => {
    const noNotifyContainer = new Container();
    const noNotifyManager = new BackgroundTaskManager(noNotifyContainer, {
      workdir: "/test/workdir",
    });

    // Should not throw
    noNotifyManager.startShell("echo test");
  });

  it("should handle task completion without MessageQueue", () => {
    const noNotifyContainer = new Container();
    const noNotifyManager = new BackgroundTaskManager(noNotifyContainer, {
      workdir: "/test/workdir",
    });

    noNotifyManager.startShell("echo test");

    // Simulate task exit - should not throw
    const exitHandler = handlers.get("exit");
    exitHandler?.(0);

    const tasks = noNotifyManager.getAllTasks();
    expect(tasks[0].status).toBe("completed");
  });

  it("should handle task error without MessageQueue", () => {
    const noNotifyContainer = new Container();
    const noNotifyManager = new BackgroundTaskManager(noNotifyContainer, {
      workdir: "/test/workdir",
    });

    noNotifyManager.startShell("echo test");

    // Simulate process error - should not throw
    const errorHandler = handlers.get("error");
    errorHandler?.(new Error("spawn error"));

    const tasks = noNotifyManager.getAllTasks();
    expect(tasks[0].status).toBe("failed");
  });

  it("should handle task kill without MessageQueue", () => {
    const noNotifyContainer = new Container();
    const noNotifyManager = new BackgroundTaskManager(noNotifyContainer, {
      workdir: "/test/workdir",
    });

    noNotifyManager.startShell("sleep 999");
    const tasks = noNotifyManager.getAllTasks();
    const taskId = tasks[0].id;

    // Stop task - should not throw
    noNotifyManager.stopTask(taskId);

    const updatedTasks = noNotifyManager.getAllTasks();
    expect(updatedTasks[0].status).toBe("killed");
  });

  it("should NOT enqueue notification when killed task exits (race condition)", () => {
    // This tests the race condition: stopTask() sets status to "killed",
    // then the onExit handler fires from the SIGTERM signal.
    manager.startShell("sleep 999");
    const tasks = manager.getAllTasks();
    const taskId = tasks[0].id;

    // Stop the task (sets status to "killed", sends SIGTERM via onStop)
    manager.stopTask(taskId);

    expect(messageQueue.hasNotifications()).toBe(false);

    // Simulate onExit firing after SIGTERM — this should NOT enqueue a notification
    const exitHandler = handlers.get("exit");
    exitHandler?.(143); // SIGTERM exit code

    // Status should remain "killed", not be overwritten to "failed"
    expect(tasks[0].status).toBe("killed");
    // No notification should be enqueued
    expect(messageQueue.hasNotifications()).toBe(false);
  });

  it("should preserve killed status when onExit fires after stopTask", () => {
    manager.startShell("sleep 999");
    const tasks = manager.getAllTasks();
    const taskId = tasks[0].id;

    manager.stopTask(taskId);
    expect(tasks[0].status).toBe("killed");

    // Exit handler fires with exit code 0 (e.g. SIGTERM caught as exit 0)
    const exitHandler = handlers.get("exit");
    exitHandler?.(0);

    // Status must remain "killed", not overwritten to "completed"
    expect(tasks[0].status).toBe("killed");
    expect(messageQueue.hasNotifications()).toBe(false);
  });

  describe("startShell shell invocation", () => {
    it("spawns the shell with -c -l (login shell) and kicks off snapshot creation", () => {
      manager.startShell("echo hello");

      // Explicit spawn: [shellPath, args, options].
      expect(mockSpawn).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "-l", "echo hello"],
        expect.objectContaining({
          stdio: "pipe",
          detached: true,
          cwd: "/test/workdir",
          env: expect.any(Object),
        }),
      );
      // Snapshot capture kicked off (fire-and-forget) for later commands.
      expect(mockExecFile).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "-l", expect.stringContaining('echo "$PATH"')],
        expect.anything(),
        expect.any(Function),
      );
    });

    it("skips -l and reuses the cached snapshot PATH once it is ready", async () => {
      // Settle the real snapshot for /bin/bash via the mocked execFile.
      mockExecFile.mockImplementation(((
        _file: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        callback(
          null,
          "WAVE_SHELL_SNAPSHOT\n/usr/local/bin:/usr/bin:/bin\n",
          "",
        );
      }) as unknown as typeof execFile);
      await getShellSnapshotPath("/bin/bash");
      mockExecFile.mockClear();

      manager.startShell("echo hello");

      expect(mockSpawn).toHaveBeenCalledWith(
        "/bin/bash",
        ["-c", "export PATH='/usr/local/bin:/usr/bin:/bin'; echo hello"],
        expect.objectContaining({
          stdio: "pipe",
          detached: true,
          cwd: "/test/workdir",
        }),
      );
      // Snapshot already cached — no new capture kicked off.
      expect(mockExecFile).not.toHaveBeenCalled();
    });
  });
});
