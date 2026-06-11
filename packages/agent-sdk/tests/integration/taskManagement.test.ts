import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../../src/tools/taskManagementTools.js";
import { promises as fs } from "fs";
import { TaskManager } from "../../src/services/taskManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import { Container } from "../../src/utils/container.js";

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

describe("Task Management Integration Tests", () => {
  const sessionId = "test-session-id";
  let context: ToolContext;
  let virtualFs: Map<string, string>;
  let taskManager: TaskManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    taskManager = new TaskManager(container, sessionId);
    context = {
      sessionId,
      taskManager,
      workdir: "/test/workdir",
    } as ToolContext;
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

    vi.mocked(fs.open).mockImplementation(async (path, flags) => {
      if (flags === "wx") {
        if (virtualFs.has(path.toString())) {
          const error = new Error("File exists") as NodeJS.ErrnoException;
          error.code = "EEXIST";
          throw error;
        }
        virtualFs.set(path.toString(), "");
      }
      return {
        close: vi.fn().mockResolvedValue(undefined),
      } as unknown as Awaited<ReturnType<typeof fs.open>>;
    });

    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      virtualFs.delete(path.toString());
    });
  });

  it("Flow 1: Create -> Get", async () => {
    // 1. Create a task
    const createArgs = {
      subject: "Integration Task",
      description: "Testing create and get flow",
      metadata: { priority: "high" },
    };
    const createResult = await taskCreateTool.execute(createArgs, context);
    expect(createResult.success).toBe(true);
    expect(createResult.content).toContain("Task #1 created successfully");

    // 2. Get the task
    const getResult = await taskGetTool.execute({ taskId: "1" }, context);
    expect(getResult.success).toBe(true);
    expect(getResult.content).toContain("Task #1: Integration Task");
    expect(getResult.content).toContain("Status: pending");
    expect(getResult.content).toContain(
      "Description: Testing create and get flow",
    );
  });

  it("Flow 2: Create -> Update -> Get", async () => {
    // 1. Create
    await taskCreateTool.execute(
      { subject: "Initial Task", description: "Initial description" },
      context,
    );

    // 2. Update
    const updateArgs = {
      taskId: "1",
      status: "in_progress",
      metadata: { progress: 50 },
    };
    const updateResult = await taskUpdateTool.execute(updateArgs, context);
    expect(updateResult.success).toBe(true);

    // 3. Get and verify
    const getResult = await taskGetTool.execute({ taskId: "1" }, context);
    expect(getResult.success).toBe(true);
    expect(getResult.content).toContain("Status: in_progress");
    expect(getResult.content).toContain("Initial Task");
  });

  it("Flow 3: Create multiple -> List", async () => {
    // 1. Create multiple tasks
    await taskCreateTool.execute(
      { subject: "Task A", description: "Desc A" },
      context,
    );
    await taskCreateTool.execute(
      { subject: "Task B", description: "Desc B" },
      context,
    );
    await taskCreateTool.execute(
      { subject: "Task C", description: "Desc C" },
      context,
    );

    // 2. List all — all pending since TaskCreate no longer accepts status
    const listAllResult = await taskListTool.execute({}, context);
    expect(listAllResult.success).toBe(true);
    expect(listAllResult.content).toContain("#1 [pending] Task A");
    expect(listAllResult.content).toContain("#2 [pending] Task B");
    expect(listAllResult.content).toContain("#3 [pending] Task C");
  });

  it("Flow 4: Error cases", async () => {
    // 1. Get non-existent task
    const getResult = await taskGetTool.execute({ taskId: "999" }, context);
    expect(getResult.success).toBe(false);
    expect(getResult.content).toContain("not found");

    // 2. Update non-existent task
    const updateResult = await taskUpdateTool.execute(
      { taskId: "999", subject: "New" },
      context,
    );
    expect(updateResult.success).toBe(false);
    expect(updateResult.content).toContain("not found");
  });
});
