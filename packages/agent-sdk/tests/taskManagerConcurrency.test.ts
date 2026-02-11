import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../src/services/taskManager.js";
import { taskCreateTool } from "../src/tools/taskManagementTools.js";
import { ToolContext } from "../src/tools/types.js";
import { promises as fs } from "fs";

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    mkdir: vi.fn(),
    open: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

vi.mock("../src/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("TaskCreate Concurrency", () => {
  let taskManager: TaskManager;
  const sessionId = "test-session";

  beforeEach(() => {
    vi.clearAllMocks();
    taskManager = new TaskManager();
  });

  it("should result in unique IDs when TaskCreate is called concurrently", async () => {
    // Mock readdir to return empty initially, then return files as they are "created"
    const createdFiles: string[] = [];
    vi.mocked(fs.readdir).mockImplementation(async () => {
      return createdFiles as unknown as Awaited<ReturnType<typeof fs.readdir>>;
    });

    // Mock mkdir
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);

    // Mock open to succeed for any lock file, but simulate EEXIST if lock file already "exists"
    const activeLocks = new Set<string>();
    const mockFileHandle = {
      close: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(fs.open).mockImplementation(async (path, flags) => {
      if (flags === "wx" && activeLocks.has(path as string)) {
        const error = new Error("File exists") as NodeJS.ErrnoException;
        error.code = "EEXIST";
        throw error;
      }
      activeLocks.add(path as string);
      return mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>;
    });

    // Mock readFile to return a valid task object
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      const filename = (path as string).split("/").pop()!;
      const id = filename.replace(".json", "");
      return JSON.stringify({
        id,
        subject: "test",
        description: "test",
        status: "pending",
      }) as unknown as Awaited<ReturnType<typeof fs.readFile>>;
    });

    // Mock writeFile to "create" the file
    vi.mocked(fs.writeFile).mockImplementation(async (path) => {
      const filename = (path as string).split("/").pop()!;
      if (filename.endsWith(".json")) {
        if (!createdFiles.includes(filename)) {
          createdFiles.push(filename);
        }
      }
      return undefined as unknown as Awaited<ReturnType<typeof fs.writeFile>>;
    });

    // Mock unlink to release lock
    vi.mocked(fs.unlink).mockImplementation(async (path) => {
      activeLocks.delete(path as string);
      return undefined as unknown as Awaited<ReturnType<typeof fs.unlink>>;
    });

    const context: ToolContext = {
      sessionId,
      taskManager,
    } as unknown as ToolContext;

    // Trigger multiple concurrent task creations
    const results = await Promise.all([
      taskCreateTool.execute(
        { subject: "Task 1", description: "Desc 1" },
        context,
      ),
      taskCreateTool.execute(
        { subject: "Task 2", description: "Desc 2" },
        context,
      ),
      taskCreateTool.execute(
        { subject: "Task 3", description: "Desc 3" },
        context,
      ),
    ]);

    const taskIds = results.map((r) => {
      if (r.success) {
        const match = r.content.match(/ID: (\d+)/);
        return match ? match[1] : null;
      }
      return null;
    });

    // Now we expect all IDs to be unique
    const uniqueIds = new Set(taskIds);
    expect(uniqueIds.size).toBe(results.length);
    expect(taskIds).toContain("1");
    expect(taskIds).toContain("2");
    expect(taskIds).toContain("3");
  });
});
