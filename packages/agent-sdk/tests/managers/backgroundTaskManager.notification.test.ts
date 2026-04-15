import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";

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
}));

// Mock fs
vi.mock("fs", () => ({
  createWriteStream: vi.fn(() => ({
    writable: true,
    write: vi.fn(),
    end: vi.fn(),
  })),
}));

import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";

describe("BackgroundTaskManager - Notification Queue", () => {
  let container: Container;
  let notificationQueue: NotificationQueue;
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    handlers.clear();
    container = new Container();
    notificationQueue = new NotificationQueue();
    container.register("NotificationQueue", notificationQueue);

    manager = new BackgroundTaskManager(container, {
      workdir: "/test/workdir",
    });
  });

  it("should enqueue notification when shell task completes", () => {
    manager.startShell("echo hello");

    const exitHandler = handlers.get("exit");
    exitHandler?.(0);

    expect(notificationQueue.hasPending()).toBe(true);
    const notifications = notificationQueue.dequeueAll();
    expect(notifications.length).toBe(1);
    expect(notifications[0]).toContain("<task-id>");
    expect(notifications[0]).toContain("<status>completed</status>");
    expect(notifications[0]).toContain("<task-type>shell</task-type>");
  });

  it("should enqueue notification when shell task fails", () => {
    manager.startShell("false");

    const exitHandler = handlers.get("exit");
    exitHandler?.(1);

    expect(notificationQueue.hasPending()).toBe(true);
    const notifications = notificationQueue.dequeueAll();
    expect(notifications[0]).toContain("<status>failed</status>");
  });

  it("should enqueue notification on process error", () => {
    manager.startShell("echo test");

    const errorHandler = handlers.get("error");
    errorHandler?.(new Error("spawn error"));

    expect(notificationQueue.hasPending()).toBe(true);
    const notifications = notificationQueue.dequeueAll();
    expect(notifications[0]).toContain("<status>failed</status>");
    expect(notifications[0]).toContain("spawn error");
  });

  it("should enqueue notification when task is killed", () => {
    manager.startShell("sleep 999");
    const tasks = manager.getAllTasks();
    const taskId = tasks[0].id;

    manager.stopTask(taskId);

    expect(notificationQueue.hasPending()).toBe(true);
    const notifications = notificationQueue.dequeueAll();
    expect(notifications[0]).toContain("<status>killed</status>");
  });

  it("should not enqueue notification when NotificationQueue is not available", () => {
    const noNotifyContainer = new Container();
    const noNotifyManager = new BackgroundTaskManager(noNotifyContainer, {
      workdir: "/test/workdir",
    });

    // Should not throw
    noNotifyManager.startShell("echo test");
  });

  it("should handle task completion without NotificationQueue", () => {
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

  it("should handle task error without NotificationQueue", () => {
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

  it("should handle task kill without NotificationQueue", () => {
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
});
