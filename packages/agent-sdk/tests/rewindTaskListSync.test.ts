import { describe, it, expect, vi } from "vitest";
import { TaskManager } from "../src/services/taskManager.js";
import { Agent } from "../src/agent.js";
import { MessageManager } from "../src/managers/messageManager.js";
import { Container } from "../src/utils/container.js";
import { Task } from "../src/types/tasks.js";

// Mock dependencies
vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn().mockResolvedValue([]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    open: vi.fn(),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
    unlink: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
}));

vi.mock("os", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
}));

describe("Rewind Task List Sync", () => {
  describe("TaskManager.refreshTasks", () => {
    it("should emit tasksChange event", async () => {
      const container = new Container();
      const taskManager = new TaskManager(container, "test-session");
      const spy = vi.fn();
      taskManager.on("tasksChange", spy);

      await taskManager.refreshTasks();

      expect(spy).toHaveBeenCalledWith("test-session");
    });
  });

  describe("Agent.truncateHistory", () => {
    it("should call onTasksChange after history truncation", async () => {
      // We need to mock MessageManager.prototype.truncateHistory to avoid complex setup
      const truncateHistorySpy = vi
        .spyOn(MessageManager.prototype, "truncateHistory")
        .mockResolvedValue(undefined);

      const onTasksChangeSpy = vi.fn();

      // Create agent instance
      const agent = await Agent.create({
        apiKey: "test-key",
        workdir: "/test/workdir",
        callbacks: {
          onTasksChange: onTasksChangeSpy,
        },
      });

      // Mock listTasks to return some tasks
      const mockTasks = [{ id: "1", subject: "test", status: "pending" }];
      vi.spyOn(
        (agent as unknown as { taskManager: TaskManager }).taskManager,
        "listTasks",
      ).mockResolvedValue(mockTasks as unknown as Task[]);

      await agent.truncateHistory(0);

      expect(truncateHistorySpy).toHaveBeenCalledWith(0, expect.anything());
      expect(onTasksChangeSpy).toHaveBeenCalledWith(mockTasks);
    });
  });
});
