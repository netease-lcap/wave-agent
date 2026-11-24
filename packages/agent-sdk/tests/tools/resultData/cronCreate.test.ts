import { describe, it, expect, vi, beforeEach } from "vitest";
import { cronCreateTool } from "@/tools/cronCreateTool.js";
import {
  renderCronCreateResultData,
  type CronCreateResultData,
} from "@/tools/resultData/cronCreate.js";
import type { CronManager } from "@/managers/cronManager.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`CronCreate` 的 `data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` 逐字相等。期望值是手写的字面量，不是从 `content`
 * 抄来的——抄一遍只能证明两边用了同一个渲染器，证明不了措辞没漂。
 */

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(renderCronCreateResultData(result.data as CronCreateResultData)).toBe(
    result.content,
  );
};

describe("CronCreate data → 文本 golden", () => {
  let cronManager: {
    createJob: ReturnType<typeof vi.fn>;
    listJobs: ReturnType<typeof vi.fn>;
  };
  let context: ToolContext;

  beforeEach(() => {
    cronManager = {
      createJob: vi.fn().mockReturnValue({
        id: "abc123",
        cron: "*/5 * * * *",
        prompt: "check the deploy",
        recurring: true,
        createdAt: 0,
        nextRun: 60000,
        periodMs: 300000,
      }),
      listJobs: vi.fn().mockReturnValue([]),
    };

    context = {
      cronManager: cronManager as unknown as CronManager,
      workdir: "/test",
    } as unknown as ToolContext;
  });

  it("recurring + 默认 session-only：正文交代过期天数与撤销入口", async () => {
    const result = await cronCreateTool.execute(
      { cron: "*/5 * * * *", prompt: "check the deploy" },
      context,
    );

    expect(result.content).toBe(
      "Scheduled recurring job abc123 (Every 5 minutes). Session-only (not written to disk, dies when Wave exits). Auto-expires after 7 days. Use CronDelete to cancel sooner.",
    );
    expect(result.data).toEqual({
      id: "abc123",
      humanSchedule: "Every 5 minutes",
      recurring: true,
      durable: false,
    });
    expect(result.shortResult).toBe(result.content);
    expectRendersBack(result);
    // prompt 是模型传进来的正文，不进 data（CC 的 schema 里也没有）。
    expect(JSON.stringify(result.data)).not.toContain("check the deploy");
  });

  it("durable: true 时正文说落到哪个文件", async () => {
    const result = await cronCreateTool.execute(
      { cron: "0 * * * *", prompt: "hourly sweep", durable: true },
      context,
    );

    expect(result.content).toBe(
      "Scheduled recurring job abc123 (Every hour). Persisted to .wave/scheduled_tasks.json. Auto-expires after 7 days. Use CronDelete to cancel sooner.",
    );
    expect(result.data).toEqual({
      id: "abc123",
      humanSchedule: "Every hour",
      recurring: true,
      durable: true,
    });
    expectRendersBack(result);
  });

  it("one-shot：尾句换成「打一次就自删」，不提过期天数", async () => {
    const result = await cronCreateTool.execute(
      { cron: "30 14 * * *", prompt: "remind me", recurring: false },
      context,
    );

    expect(result.content).toBe(
      "Scheduled one-shot task abc123 (Every day at 2:30 PM). Session-only (not written to disk, dies when Wave exits). It will fire once then auto-delete.",
    );
    expect(result.data).toEqual({
      id: "abc123",
      humanSchedule: "Every day at 2:30 PM",
      recurring: false,
      durable: false,
    });
    expectRendersBack(result);
  });

  it("非法 cron 走 error 分支：没有 data，也没有正文", async () => {
    const result = await cronCreateTool.execute(
      { cron: "not a cron", prompt: "x" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.data).toBeUndefined();
    expect(result.error).toBe(
      "Invalid cron expression 'not a cron'. Expected 5 fields: M H DoM Mon DoW.",
    );
  });

  it("任务数到上限走 error 分支：没有 data，也没有正文", async () => {
    cronManager.listJobs.mockReturnValueOnce(
      Array.from({ length: 50 }, (_, i) => ({
        id: `job${i}`,
        cron: "0 * * * *",
        prompt: `job ${i}`,
        recurring: true,
        createdAt: 0,
        nextRun: 0,
        periodMs: 3600000,
      })),
    );

    const result = await cronCreateTool.execute(
      { cron: "*/5 * * * *", prompt: "new job" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.data).toBeUndefined();
    expect(result.error).toBe(
      "Too many scheduled jobs (max 50). Cancel one first.",
    );
  });
});
