import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronManager } from "@/managers/cronManager.js";
import { Container } from "@/utils/container.js";
import type { AIManager } from "@/managers/aiManager.js";
import type { MessageManager } from "@/managers/messageManager.js";

vi.mock("@/utils/cronTasks.js", () => ({
  readCronTasks: vi.fn(),
  addCronTask: vi.fn(),
  removeCronTasks: vi.fn(),
  markCronTasksFired: vi.fn(),
  getCronTasksFilePath: vi.fn(),
  writeCronTasks: vi.fn(),
}));

vi.mock("@/utils/cronTasksLock.js", () => ({
  tryAcquireSchedulerLock: vi.fn().mockResolvedValue(true),
  releaseSchedulerLock: vi.fn().mockResolvedValue(undefined),
  releaseSchedulerLockSync: vi.fn(),
  registerSchedulerLockCleanup: vi.fn(),
}));

import {
  readCronTasks,
  addCronTask,
  removeCronTasks,
  markCronTasksFired,
} from "@/utils/cronTasks.js";
import {
  tryAcquireSchedulerLock,
  registerSchedulerLockCleanup,
} from "@/utils/cronTasksLock.js";

describe("CronManager", () => {
  let container: Container;
  let cronManager: CronManager;
  let mockAiManager: Partial<AIManager>;
  let mockMessageManager: Partial<MessageManager>;

  beforeEach(() => {
    container = new Container();
    mockAiManager = {
      isLoading: false,
      sendAIMessage: vi.fn().mockResolvedValue(undefined),
    };
    mockMessageManager = {
      addUserMessage: vi.fn(),
    };
    container.register("AIManager", mockAiManager as AIManager);
    container.register("MessageManager", mockMessageManager as MessageManager);
    vi.clearAllMocks();
  });

  afterEach(() => {
    cronManager.stop();
    vi.useRealTimers();
  });

  describe("createJob", () => {
    it("creates a one-shot job", () => {
      cronManager = new CronManager(container);
      const job = cronManager.createJob({
        cron: "0 12 * * *",
        prompt: "test prompt",
        recurring: false,
      });

      expect(job.id).toBeDefined();
      expect(job.cron).toBe("0 12 * * *");
      expect(job.prompt).toBe("test prompt");
      expect(job.recurring).toBe(false);
      expect(job.createdAt).toBeDefined();
      expect(job.nextRun).toBeDefined();
      expect(job.periodMs).toBe(24 * 60 * 60 * 1000);
    });

    it("creates a recurring job", () => {
      cronManager = new CronManager(container);
      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "recurring prompt",
        recurring: true,
      });

      expect(job.recurring).toBe(true);
      expect(job.periodMs).toBe(60 * 1000);
    });

    it("persists durable jobs to disk", () => {
      cronManager = new CronManager(container);
      cronManager.createJob({
        cron: "*/5 * * * *",
        prompt: "durable job",
        recurring: true,
        durable: true,
      });

      expect(addCronTask).toHaveBeenCalledTimes(1);
    });

    it("does not persist session-only jobs to disk", () => {
      cronManager = new CronManager(container);
      cronManager.createJob({
        cron: "*/5 * * * *",
        prompt: "session job",
        recurring: true,
        durable: false,
      });

      expect(addCronTask).not.toHaveBeenCalled();
    });

    it("acquires scheduler lock on createJob when durable=true", async () => {
      vi.mocked(tryAcquireSchedulerLock).mockResolvedValue(true);

      cronManager = new CronManager(container);
      cronManager.createJob({
        cron: "*/5 * * * *",
        prompt: "durable job",
        recurring: true,
        durable: true,
      });

      await vi.waitFor(() => {
        expect(tryAcquireSchedulerLock).toHaveBeenCalled();
      });
    });

    it("does not acquire lock on createJob for session-only jobs", async () => {
      vi.mocked(tryAcquireSchedulerLock).mockResolvedValue(true);

      cronManager = new CronManager(container);
      cronManager.createJob({
        cron: "*/5 * * * *",
        prompt: "session job",
        recurring: true,
        durable: false,
      });

      // Give async lock acquisition time to potentially fire
      await new Promise((r) => setTimeout(r, 50));

      expect(tryAcquireSchedulerLock).not.toHaveBeenCalled();
    });
  });

  describe("deleteJob", () => {
    it("deletes an existing job", () => {
      cronManager = new CronManager(container);
      const job = cronManager.createJob({
        cron: "0 12 * * *",
        prompt: "test",
        recurring: false,
      });

      const result = cronManager.deleteJob(job.id);
      expect(result).toBe(true);
      expect(cronManager.listJobs()).toHaveLength(0);
    });

    it("returns false for non-existent job", () => {
      cronManager = new CronManager(container);
      const result = cronManager.deleteJob("nonexistent");
      expect(result).toBe(false);
    });

    it("removes durable jobs from disk", () => {
      cronManager = new CronManager(container);
      const job = cronManager.createJob({
        cron: "0 12 * * *",
        prompt: "test",
        recurring: false,
        durable: true,
      });

      vi.mocked(addCronTask).mockClear();
      cronManager.deleteJob(job.id);

      expect(removeCronTasks).toHaveBeenCalledWith(
        [job.id],
        expect.any(String),
      );
    });

    it("does not call removeCronTasks for session-only jobs", () => {
      cronManager = new CronManager(container);
      const job = cronManager.createJob({
        cron: "0 12 * * *",
        prompt: "test",
        recurring: false,
        durable: false,
      });

      cronManager.deleteJob(job.id);

      expect(removeCronTasks).not.toHaveBeenCalled();
    });
  });

  describe("listJobs", () => {
    it("returns all jobs", () => {
      cronManager = new CronManager(container);
      cronManager.createJob({
        cron: "0 12 * * *",
        prompt: "job1",
        recurring: false,
      });
      cronManager.createJob({
        cron: "0 13 * * *",
        prompt: "job2",
        recurring: false,
      });

      expect(cronManager.listJobs()).toHaveLength(2);
    });

    it("returns empty array when no jobs", () => {
      cronManager = new CronManager(container);
      expect(cronManager.listJobs()).toHaveLength(0);
    });
  });

  describe("start/stop", () => {
    it("starts the interval", () => {
      cronManager = new CronManager(container);
      cronManager.start();
      cronManager.start();
    });

    it("stops the interval", () => {
      cronManager = new CronManager(container);
      cronManager.start();
      cronManager.stop();
      cronManager.stop();
    });

    it("loads durable tasks from disk on start", () => {
      const durableTask = {
        id: "persisted-1",
        cron: "*/10 * * * *",
        prompt: "persisted prompt",
        recurring: true,
        createdAt: Date.now() - 60000,
        durable: true,
      };
      vi.mocked(readCronTasks).mockReturnValue([durableTask as never]);

      cronManager = new CronManager(container);
      cronManager.start();

      expect(readCronTasks).toHaveBeenCalled();
      expect(cronManager.listJobs()).toHaveLength(1);
      expect(cronManager.listJobs()[0].id).toBe("persisted-1");
    });

    it("acquires scheduler lock on start when durable tasks exist", async () => {
      vi.mocked(tryAcquireSchedulerLock).mockResolvedValue(true);
      vi.mocked(readCronTasks).mockReturnValue([
        {
          id: "task-1",
          cron: "*/5 * * * *",
          prompt: "durable task",
          recurring: true,
          createdAt: Date.now(),
          durable: true,
        } as never,
      ]);

      cronManager = new CronManager(container);
      cronManager.start();

      // Lock acquisition is async, wait for it
      await vi.waitFor(() => {
        expect(tryAcquireSchedulerLock).toHaveBeenCalled();
      });
    });

    it("sets up lock probe when not owner and durable tasks exist", async () => {
      vi.mocked(tryAcquireSchedulerLock).mockResolvedValue(false);
      vi.mocked(readCronTasks).mockReturnValue([
        {
          id: "task-1",
          cron: "*/5 * * * *",
          prompt: "durable task",
          recurring: true,
          createdAt: Date.now(),
          durable: true,
        } as never,
      ]);

      cronManager = new CronManager(container);
      cronManager.start();

      await vi.waitFor(() => {
        expect(registerSchedulerLockCleanup).toHaveBeenCalled();
      });
    });

    it("does not acquire scheduler lock on start when no durable tasks", async () => {
      vi.mocked(tryAcquireSchedulerLock).mockResolvedValue(true);
      vi.mocked(readCronTasks).mockReturnValue([]);

      cronManager = new CronManager(container);
      cronManager.start();

      // Give async lock acquisition time to potentially fire
      await new Promise((r) => setTimeout(r, 50));

      expect(tryAcquireSchedulerLock).not.toHaveBeenCalled();
      expect(registerSchedulerLockCleanup).not.toHaveBeenCalled();
    });
  });

  describe("checkJobs durable lock gating", () => {
    it("skips durable jobs when not lock owner", async () => {
      cronManager = new CronManager(container);
      // isOwner defaults to false
      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "durable prompt",
        recurring: false,
        durable: true,
      });
      // Override nextRun so job is due
      job.nextRun = Date.now() - 1000;

      await (
        cronManager as unknown as { checkJobs: () => Promise<void> }
      ).checkJobs();

      expect(mockMessageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("fires durable jobs when lock owner", async () => {
      cronManager = new CronManager(container);
      // Manually set isOwner to true (normally done by start() after lock acquisition)
      (cronManager as unknown as { isOwner: boolean }).isOwner = true;

      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "durable prompt",
        recurring: false,
        durable: true,
      });
      // Override nextRun so job is due
      job.nextRun = Date.now() - 1000;

      expect(cronManager.listJobs()).toHaveLength(1);
      expect(job.nextRun).toBeLessThan(Date.now());

      await (
        cronManager as unknown as { checkJobs: () => Promise<void> }
      ).checkJobs();

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content: "durable prompt",
      });
    });

    it("always fires session-only jobs regardless of lock", async () => {
      cronManager = new CronManager(container);
      // isOwner defaults to false, but session-only jobs don't need lock
      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "session prompt",
        recurring: false,
        durable: false,
      });
      job.nextRun = Date.now() - 1000;

      await (
        cronManager as unknown as { checkJobs: () => Promise<void> }
      ).checkJobs();

      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith({
        content: "session prompt",
      });
    });

    it("writes lastFiredAt for durable recurring jobs after fire", async () => {
      cronManager = new CronManager(container);
      // Manually set isOwner to true
      (cronManager as unknown as { isOwner: boolean }).isOwner = true;

      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "durable recurring",
        recurring: true,
        durable: true,
      });
      job.nextRun = Date.now() - 1000;

      await (
        cronManager as unknown as { checkJobs: () => Promise<void> }
      ).checkJobs();

      expect(markCronTasksFired).toHaveBeenCalled();
    });
  });
});
