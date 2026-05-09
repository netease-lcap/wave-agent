import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  readCronTasks,
  writeCronTasks,
  addCronTask,
  removeCronTasks,
  markCronTasksFired,
  getCronTasksFilePath,
} from "@/utils/cronTasks.js";
import { CronJob } from "@/types/cron.js";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
} from "fs";
import { join } from "path";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
  };
});

vi.mock("crypto", () => ({
  randomUUID: () => "test-uuid-123",
}));

const MOCK_DIR = "/mock/project";
const WAVE_DIR = join(MOCK_DIR, ".wave");
const TASKS_FILE = join(WAVE_DIR, "scheduled_tasks.json");

const createMockJob = (overrides = {}): CronJob => ({
  id: "job1",
  cron: "*/5 * * * *",
  prompt: "test prompt",
  recurring: true,
  createdAt: Date.now(),
  nextRun: Date.now() + 60000,
  periodMs: 300000,
  durable: true,
  ...overrides,
});

describe("cronTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("getCronTasksFilePath", () => {
    it("returns correct path for given directory", () => {
      const result = getCronTasksFilePath("/my/project");
      expect(result).toBe(join("/my/project", ".wave", "scheduled_tasks.json"));
    });

    it("uses process.cwd() as default", () => {
      const cwd = process.cwd();
      const result = getCronTasksFilePath();
      expect(result).toBe(join(cwd, ".wave", "scheduled_tasks.json"));
    });
  });

  describe("readCronTasks", () => {
    it("returns empty array when file does not exist", () => {
      vi.mocked(existsSync).mockReturnValue(false);
      const result = readCronTasks(MOCK_DIR);
      expect(result).toEqual([]);
    });

    it("parses valid tasks from file", () => {
      const tasks = [
        {
          id: "job1",
          cron: "*/5 * * * *",
          prompt: "test",
          recurring: true,
          createdAt: 1234567890,
        },
      ];
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ tasks }));

      const result = readCronTasks(MOCK_DIR);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("job1");
    });

    it("drops malformed entries silently", () => {
      const tasks = [
        {
          id: "good",
          cron: "*/5 * * * *",
          prompt: "test",
          recurring: true,
          createdAt: 123,
        },
        { id: "bad" }, // missing required fields
        "not an object",
      ];
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ tasks }));

      const result = readCronTasks(MOCK_DIR);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("good");
    });

    it("returns empty array for invalid JSON", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("not json");

      const result = readCronTasks(MOCK_DIR);
      expect(result).toEqual([]);
    });

    it("returns empty array for missing tasks array", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ foo: "bar" }));

      const result = readCronTasks(MOCK_DIR);
      expect(result).toEqual([]);
    });
  });

  describe("writeCronTasks", () => {
    it("writes tasks to file with atomic rename", () => {
      const jobs: CronJob[] = [createMockJob()];
      writeCronTasks(jobs, MOCK_DIR);

      expect(mkdirSync).toHaveBeenCalledWith(WAVE_DIR, { recursive: true });
      expect(renameSync).toHaveBeenCalledWith(
        join(WAVE_DIR, "test-uuid-123.tmp"),
        TASKS_FILE,
      );
    });

    it("strips runtime flags before writing", () => {
      const jobs: CronJob[] = [createMockJob()];
      writeCronTasks(jobs, MOCK_DIR);

      const writeCall = vi.mocked(writeFileSync);
      const writtenContent = writeCall.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);

      expect(parsed.tasks[0]).not.toHaveProperty("nextRun");
      expect(parsed.tasks[0]).not.toHaveProperty("periodMs");
      expect(parsed.tasks[0]).toHaveProperty("id", "job1");
      expect(parsed.tasks[0]).toHaveProperty("durable", true);
    });
  });

  describe("addCronTask", () => {
    it("adds a task to existing tasks", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ tasks: [] }));

      const job = createMockJob();
      addCronTask(job, MOCK_DIR);

      const writeCall = vi.mocked(writeFileSync);
      const writtenContent = writeCall.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.tasks).toHaveLength(1);
    });
  });

  describe("removeCronTasks", () => {
    it("removes tasks by ID", () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          tasks: [
            {
              id: "keep",
              cron: "* * * * *",
              prompt: "keep",
              recurring: false,
              createdAt: 123,
            },
            {
              id: "remove",
              cron: "* * * * *",
              prompt: "remove",
              recurring: false,
              createdAt: 123,
            },
          ],
        }),
      );

      removeCronTasks(["remove"], MOCK_DIR);

      const writeCall = vi.mocked(writeFileSync);
      const writtenContent = writeCall.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.tasks).toHaveLength(1);
      expect(parsed.tasks[0].id).toBe("keep");
    });
  });

  describe("markCronTasksFired", () => {
    it("updates lastFiredAt for matching tasks", () => {
      const firedAt = Date.now();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          tasks: [
            {
              id: "job1",
              cron: "* * * * *",
              prompt: "test",
              recurring: true,
              createdAt: 123,
            },
            {
              id: "job2",
              cron: "* * * * *",
              prompt: "test",
              recurring: true,
              createdAt: 123,
            },
          ],
        }),
      );

      markCronTasksFired(["job1"], firedAt, MOCK_DIR);

      const writeCall = vi.mocked(writeFileSync);
      const writtenContent = writeCall.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenContent);
      expect(parsed.tasks[0].lastFiredAt).toBe(firedAt);
      expect(parsed.tasks[1].lastFiredAt).toBeUndefined();
    });
  });
});
