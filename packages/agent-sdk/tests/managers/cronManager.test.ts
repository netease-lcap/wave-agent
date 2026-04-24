import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CronManager } from "@/managers/cronManager.js";
import { Container } from "@/utils/container.js";
import type { AIManager } from "@/managers/aiManager.js";
import type { MessageManager } from "@/managers/messageManager.js";

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
    cronManager = new CronManager(container);
  });

  afterEach(() => {
    cronManager.stop();
  });

  describe("createJob", () => {
    it("creates a one-shot job", () => {
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
      const job = cronManager.createJob({
        cron: "* * * * *",
        prompt: "recurring prompt",
        recurring: true,
      });

      expect(job.recurring).toBe(true);
      expect(job.periodMs).toBe(60 * 1000);
    });
  });

  describe("deleteJob", () => {
    it("deletes an existing job", () => {
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
      const result = cronManager.deleteJob("nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("listJobs", () => {
    it("returns all jobs", () => {
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
      expect(cronManager.listJobs()).toHaveLength(0);
    });
  });

  describe("start/stop", () => {
    it("starts the interval", () => {
      cronManager.start();
      cronManager.start();
    });

    it("stops the interval", () => {
      cronManager.start();
      cronManager.stop();
      cronManager.stop();
    });
  });
});
