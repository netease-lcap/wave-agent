import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../../src/tools/taskManagementTools.js";
import { promises as fs } from "fs";
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
    },
  };
});

describe("Task Management Integration Tests", () => {
  const sessionId = "test-session-id";
  let context: ToolContext;
  let virtualFs: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = { sessionId } as ToolContext;
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
  });

  it("Flow 1: Create -> Get", async () => {
    // 1. Create a task
    const createArgs = {
      subject: "Integration Task",
      description: "Testing create and get flow",
      status: "pending",
      metadata: { priority: "high" },
    };
    const createResult = await taskCreateTool.execute(createArgs, context);
    expect(createResult.success).toBe(true);
    expect(createResult.content).toContain("Task created with ID: 1");

    // 2. Get the task
    const getResult = await taskGetTool.execute({ id: "1" }, context);
    expect(getResult.success).toBe(true);
    const task = JSON.parse(getResult.content as string);
    expect(task).toMatchObject({
      id: "1",
      subject: "Integration Task",
      description: "Testing create and get flow",
      status: "pending",
      metadata: { priority: "high" },
    });
  });

  it("Flow 2: Create -> Update -> Get", async () => {
    // 1. Create
    await taskCreateTool.execute(
      { subject: "Initial Task", description: "Initial description" },
      context,
    );

    // 2. Update
    const updateArgs = {
      id: "1",
      status: "in_progress",
      metadata: { progress: 50 },
    };
    const updateResult = await taskUpdateTool.execute(updateArgs, context);
    expect(updateResult.success).toBe(true);

    // 3. Get and verify
    const getResult = await taskGetTool.execute({ id: "1" }, context);
    expect(getResult.success).toBe(true);
    const task = JSON.parse(getResult.content as string);
    expect(task.status).toBe("in_progress");
    expect(task.metadata.progress).toBe(50);
    expect(task.subject).toBe("Initial Task"); // Should remain unchanged
  });

  it("Flow 3: Create multiple -> List", async () => {
    // 1. Create multiple tasks
    await taskCreateTool.execute(
      { subject: "Task A", description: "Desc A" },
      context,
    );
    await taskCreateTool.execute(
      { subject: "Task B", description: "Desc B", status: "completed" },
      context,
    );
    await taskCreateTool.execute(
      { subject: "Task C", description: "Desc C" },
      context,
    );

    // 2. List all
    const listAllResult = await taskListTool.execute({}, context);
    expect(listAllResult.success).toBe(true);
    expect(listAllResult.content).toContain("[1] Task A (pending)");
    expect(listAllResult.content).toContain("[2] Task B (completed)");
    expect(listAllResult.content).toContain("[3] Task C (pending)");

    // 3. List with filter
    const listFilteredResult = await taskListTool.execute(
      { status: "completed" },
      context,
    );
    expect(listFilteredResult.success).toBe(true);
    expect(listFilteredResult.content).toBe("[2] Task B (completed)");
    expect(listFilteredResult.content).not.toContain("Task A");
  });

  it("Flow 4: Error cases", async () => {
    // 1. Get non-existent task
    const getResult = await taskGetTool.execute({ id: "999" }, context);
    expect(getResult.success).toBe(false);
    expect(getResult.content).toContain("Task with ID 999 not found");

    // 2. Update non-existent task
    const updateResult = await taskUpdateTool.execute(
      { id: "999", subject: "New" },
      context,
    );
    expect(updateResult.success).toBe(false);
    expect(updateResult.content).toContain("Task with ID 999 not found");
  });
});
