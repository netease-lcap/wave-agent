import { describe, it, expect, vi } from "vitest";
import { TaskManager } from "../src/services/taskManager.js";
import { Agent } from "../src/agent.js";
import { MessageManager } from "../src/managers/messageManager.js";

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
      const taskManager = new TaskManager("test-session");
      const spy = vi.fn();
      taskManager.on("tasksChange", spy);

      await taskManager.refreshTasks();

      expect(spy).toHaveBeenCalledWith("test-session");
    });
  });

  describe("Agent.truncateHistory", () => {
    it("should call taskManager.refreshTasks after history truncation", async () => {
      // We need to mock MessageManager.prototype.truncateHistory to avoid complex setup
      const truncateHistorySpy = vi
        .spyOn(MessageManager.prototype, "truncateHistory")
        .mockResolvedValue(undefined);

      // Create agent instance
      // Note: Agent.create is async and does a lot of initialization.
      // For this test, we can try to mock the necessary parts or use a simplified approach.

      const agent = await Agent.create({
        apiKey: "test-key",
        workdir: "/test/workdir",
      });

      // Spy on taskManager.refreshTasks
      const refreshTasksSpy = vi.spyOn(
        (agent as unknown as { taskManager: TaskManager }).taskManager,
        "refreshTasks",
      );

      await agent.truncateHistory(0);

      expect(truncateHistorySpy).toHaveBeenCalledWith(0, expect.anything());
      expect(refreshTasksSpy).toHaveBeenCalled();
    });
  });
});
