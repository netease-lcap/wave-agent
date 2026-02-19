import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";

describe("SlashCommandManager /clear reset", () => {
  let slashCommandManager: SlashCommandManager;
  let messageManager: MessageManager;
  let taskManager: TaskManager;
  let aiManager: AIManager;

  beforeEach(() => {
    vi.clearAllMocks();

    messageManager = new MessageManager({
      callbacks: {},
      workdir: "/test/workdir",
    });

    taskManager = new TaskManager("initial-task-list-id");
    vi.spyOn(taskManager, "setTaskListId");
    vi.spyOn(taskManager, "emit");

    aiManager = {} as AIManager;

    slashCommandManager = new SlashCommandManager({
      messageManager,
      aiManager,
      backgroundTaskManager: {} as BackgroundTaskManager,
      taskManager,
      workdir: "/test/workdir",
    });
  });

  it("should reset task list ID and emit tasksChange when /clear is called and WAVE_TASK_LIST_ID is not set", async () => {
    const initialRootSessionId = messageManager.getRootSessionId();
    expect(taskManager.getTaskListId()).toBe("initial-task-list-id");

    await slashCommandManager.executeCommand("clear");

    const newRootSessionId = messageManager.getRootSessionId();
    expect(newRootSessionId).not.toBe(initialRootSessionId);
    expect(taskManager.setTaskListId).toHaveBeenCalledWith(newRootSessionId);
    expect(taskManager.emit).toHaveBeenCalledWith(
      "tasksChange",
      newRootSessionId,
    );
    expect(taskManager.getTaskListId()).toBe(newRootSessionId);
  });

  it("should NOT reset task list ID when /clear is called and WAVE_TASK_LIST_ID is set", async () => {
    process.env.WAVE_TASK_LIST_ID = "fixed-task-list-id";

    // Re-initialize to pick up env var if needed, but our implementation checks it at runtime
    const initialRootSessionId = messageManager.getRootSessionId();

    await slashCommandManager.executeCommand("clear");

    const newRootSessionId = messageManager.getRootSessionId();
    expect(newRootSessionId).not.toBe(initialRootSessionId);

    expect(taskManager.setTaskListId).not.toHaveBeenCalled();
    expect(taskManager.emit).not.toHaveBeenCalledWith(
      "tasksChange",
      expect.any(String),
    );
    expect(taskManager.getTaskListId()).toBe("initial-task-list-id");

    delete process.env.WAVE_TASK_LIST_ID;
  });
});
