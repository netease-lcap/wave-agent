import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  taskCreateTool,
  taskGetTool,
} from "../../src/tools/taskManagementTools.js";
import { promises as fs } from "fs";
import { TaskManager } from "../../src/services/taskManager.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock fs/promises
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    promises: {
      mkdir: vi.fn(),
      writeFile: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn(),
      open: vi.fn(),
      unlink: vi.fn(),
    },
  };
});

describe("Subagent Task Sharing Integration Tests", () => {
  const mainSessionId = "main-session-id";
  const subagentSessionId = "subagent-session-id";
  let taskManager: TaskManager;
  let virtualFs: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    taskManager = new TaskManager(mainSessionId);
    virtualFs = new Map();

    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    vi.mocked(fs.writeFile).mockImplementation(async (path, data) => {
      virtualFs.set(path.toString(), data.toString());
    });

    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const content = virtualFs.get(path.toString());
      if (content === undefined) {
        const error = new Error("File not found") as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return content;
    });

    vi.mocked(fs.readdir).mockImplementation(async (path) => {
      const dirPath = path.toString();
      const files = Array.from(virtualFs.keys())
        .filter((p) => p.startsWith(dirPath))
        .map((p) => p.replace(dirPath + "/", ""));

      return files as unknown as Awaited<ReturnType<typeof fs.readdir>>;
    });

    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      virtualFs.delete(path.toString());
    });
  });

  it("should share tasks between main agent and subagent using mainSessionId", async () => {
    const mainContext: ToolContext = {
      sessionId: mainSessionId,
      taskManager,
      workdir: "/test/workdir",
    } as ToolContext;

    const subagentContext: ToolContext = {
      sessionId: subagentSessionId,
      mainSessionId: mainSessionId,
      taskManager,
      workdir: "/test/workdir",
    } as ToolContext;

    // 1. Main agent creates a task
    const createResult = await taskCreateTool.execute(
      {
        subject: "Main Task",
        description: "Created by main agent",
      },
      mainContext,
    );
    expect(createResult.success).toBe(true);
    expect(createResult.content).toContain("Task created with ID: 1");

    // 2. Subagent should be able to get the task using mainSessionId
    const getResult = await taskGetTool.execute(
      { taskId: "1" },
      subagentContext,
    );
    expect(getResult.success).toBe(true);
    const task = JSON.parse(getResult.content as string);
    expect(task.subject).toBe("Main Task");

    // 3. Subagent creates a task
    const subCreateResult = await taskCreateTool.execute(
      {
        subject: "Subagent Task",
        description: "Created by subagent",
      },
      subagentContext,
    );
    expect(subCreateResult.success).toBe(true);
    expect(subCreateResult.content).toContain("Task created with ID: 2");

    // 4. Main agent should be able to get the subagent's task
    const mainGetResult = await taskGetTool.execute(
      { taskId: "2" },
      mainContext,
    );
    expect(mainGetResult.success).toBe(true);
    const subTask = JSON.parse(mainGetResult.content as string);
    expect(subTask.subject).toBe("Subagent Task");
  });

  it("should NOT share tasks if mainSessionId is not provided (isolation check)", async () => {
    const taskManagerA = new TaskManager("session-a");
    const taskManagerB = new TaskManager("session-b");

    const contextA: ToolContext = {
      sessionId: "session-a",
      taskManager: taskManagerA,
      workdir: "/test/workdir",
    } as ToolContext;

    const contextB: ToolContext = {
      sessionId: "session-b",
      taskManager: taskManagerB,
      workdir: "/test/workdir",
    } as ToolContext;

    // 1. Session A creates a task
    await taskCreateTool.execute(
      { subject: "Task A", description: "Desc A" },
      contextA,
    );

    // 2. Session B should NOT find Task A
    const getResult = await taskGetTool.execute({ taskId: "1" }, contextB);
    expect(getResult.success).toBe(false);
    expect(getResult.content).toContain("Task with ID 1 not found");
  });
});
