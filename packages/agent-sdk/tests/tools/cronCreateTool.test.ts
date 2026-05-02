import { describe, it, expect, vi, beforeEach } from "vitest";
import { cronCreateTool } from "@/tools/cronCreateTool.js";
import type { CronManager } from "@/managers/cronManager.js";
import type { ToolContext } from "@/tools/types.js";

describe("cronCreateTool", () => {
  let mockCronManager: Partial<CronManager>;
  let context: ToolContext;

  beforeEach(() => {
    mockCronManager = {
      createJob: vi.fn().mockReturnValue({
        id: "abc123",
        cron: "*/5 * * * *",
        prompt: "test prompt",
        recurring: true,
        createdAt: Date.now(),
        nextRun: Date.now() + 60000,
        periodMs: 300000,
      }),
      listJobs: vi.fn().mockReturnValue([]),
    };

    context = {
      cronManager: mockCronManager as CronManager,
      workdir: "/test",
    } as unknown as ToolContext;
  });

  describe("execute", () => {
    it("creates a recurring job and returns humanSchedule", async () => {
      const result = await cronCreateTool.execute(
        { cron: "*/5 * * * *", prompt: "check the deploy", recurring: true },
        context,
      );

      expect(result.success).toBe(true);
      const content = JSON.parse(result.content);
      expect(content.id).toBe("abc123");
      expect(content.humanSchedule).toBe("Every 5 minutes");
      expect(content.recurring).toBe(true);
      expect(result.shortResult).toContain("Scheduled recurring job abc123");
      expect(result.shortResult).toContain("Every 5 minutes");
      expect(result.shortResult).toContain("Auto-expires after 7 days");
    });

    it("creates a one-shot job and returns appropriate message", async () => {
      (
        mockCronManager.createJob as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce({
        id: "def456",
        cron: "30 14 * * *",
        prompt: "remind me",
        recurring: false,
        createdAt: Date.now(),
        nextRun: Date.now() + 60000,
        periodMs: 86400000,
      });

      const result = await cronCreateTool.execute(
        { cron: "30 14 * * *", prompt: "remind me", recurring: false },
        context,
      );

      expect(result.success).toBe(true);
      const content = JSON.parse(result.content);
      expect(content.id).toBe("def456");
      expect(content.humanSchedule).toBe("Every day at 2:30 PM");
      expect(content.recurring).toBe(false);
      expect(result.shortResult).toContain("Scheduled one-shot task def456");
      expect(result.shortResult).toContain("fire once then auto-delete");
    });

    it("defaults recurring to true", async () => {
      await cronCreateTool.execute(
        { cron: "*/10 * * * *", prompt: "test" },
        context,
      );

      expect(mockCronManager.createJob).toHaveBeenCalledWith(
        expect.objectContaining({ recurring: true }),
      );
    });
  });

  describe("validation", () => {
    it("rejects invalid cron expression", async () => {
      const result = await cronCreateTool.execute(
        { cron: "invalid", prompt: "test" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid cron expression");
    });

    it("rejects when CronManager is unavailable", async () => {
      const result = await cronCreateTool.execute(
        { cron: "*/5 * * * *", prompt: "test" },
        { workdir: "/test" } as ToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("CronManager not available");
    });

    it("rejects when max jobs limit is reached", async () => {
      const jobs = Array.from({ length: 50 }, (_, i) => ({
        id: `job${i}`,
        cron: "0 * * * *",
        prompt: `job ${i}`,
        recurring: true,
        createdAt: Date.now(),
        nextRun: Date.now() + 60000,
        periodMs: 3600000,
      }));
      (
        mockCronManager.listJobs as ReturnType<typeof vi.fn>
      ).mockReturnValueOnce(jobs);

      const result = await cronCreateTool.execute(
        { cron: "*/5 * * * *", prompt: "new job" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Too many scheduled jobs (max 50)");
    });
  });
});
