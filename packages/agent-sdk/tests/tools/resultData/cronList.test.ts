import { describe, it, expect, vi } from "vitest";
import { cronListTool } from "@/tools/cronListTool.js";
import {
  previewPrompt,
  renderCronListResultData,
  type CronListResultData,
} from "@/tools/resultData/cronList.js";
import type { CronManager } from "@/managers/cronManager.js";
import type { CronJob } from "@/types/cron.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`CronList` 的 `data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` 逐字相等。期望值是手写的字面量。
 */

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(renderCronListResultData(result.data as CronListResultData)).toBe(
    result.content,
  );
};

const job = (over: Partial<CronJob> = {}): CronJob => ({
  id: "job-1",
  cron: "0 9 * * 1-5",
  prompt: "run the smoke test",
  recurring: true,
  createdAt: 0,
  nextRun: 0,
  periodMs: 86400000,
  ...over,
});

const contextWith = (jobs: CronJob[]) =>
  ({
    cronManager: {
      listJobs: vi.fn().mockReturnValue(jobs),
    } as unknown as CronManager,
    workdir: "/test",
  }) as unknown as ToolContext;

describe("CronList data → 文本 golden", () => {
  it("一个任务都没有：固定句 No scheduled jobs.", async () => {
    const result = await cronListTool.execute({}, contextWith([]));

    expect(result.success).toBe(true);
    expect(result.content).toBe("No scheduled jobs.");
    expect(result.data).toEqual({ jobs: [] });
    expect(result.shortResult).toBe("Found 0 jobs");
    expectRendersBack(result);
  });

  it("一行一个任务：recurring / one-shot 与 [session-only] 标签都按 CC 的位置", async () => {
    const result = await cronListTool.execute(
      {},
      contextWith([
        job({ id: "a1", durable: true, prompt: "run the smoke test" }),
        job({
          id: "b2",
          cron: "30 14 * * *",
          prompt: "remind me",
          recurring: false,
          durable: false,
        }),
        // 老任务没有 durable 键：既不是 durable 也不打 [session-only]。
        job({
          id: "c3",
          cron: "7 * * * *",
          prompt: "hourly",
          durable: undefined,
        }),
      ]),
    );

    expect(result.content).toBe(
      [
        "a1 — Weekdays at 9:00 AM (recurring): run the smoke test",
        "b2 — Every day at 2:30 PM (one-shot) [session-only]: remind me",
        "c3 — Every hour at :07 (recurring): hourly",
      ].join("\n"),
    );
    expect(result.data).toEqual({
      jobs: [
        {
          id: "a1",
          cron: "0 9 * * 1-5",
          humanSchedule: "Weekdays at 9:00 AM",
          promptPreview: "run the smoke test",
          recurring: true,
        },
        {
          id: "b2",
          cron: "30 14 * * *",
          humanSchedule: "Every day at 2:30 PM",
          promptPreview: "remind me",
          durable: false,
        },
        {
          id: "c3",
          cron: "7 * * * *",
          humanSchedule: "Every hour at :07",
          promptPreview: "hourly",
          recurring: true,
        },
      ],
    });
    expect(result.shortResult).toBe("Found 3 jobs");
    expectRendersBack(result);
  });

  it("超长 prompt 只留 80 列（末位换成省略号），完整正文不落盘", async () => {
    const longPrompt = "x".repeat(100);

    const result = await cronListTool.execute(
      {},
      contextWith([job({ id: "long-1", prompt: longPrompt })]),
    );

    expect(result.content).toBe(
      `long-1 — Weekdays at 9:00 AM (recurring): ${"x".repeat(79)}…`,
    );
    expectRendersBack(result);
    expect(JSON.stringify(result.data)).not.toContain(longPrompt);
  });

  it("多行 prompt 单行化：只留首行，后面补省略号", async () => {
    const result = await cronListTool.execute(
      {},
      contextWith([job({ id: "multi-1", prompt: "first line\nsecond line" })]),
    );

    expect(result.content).toBe(
      "multi-1 — Weekdays at 9:00 AM (recurring): first line…",
    );
    expectRendersBack(result);
  });
});

describe("previewPrompt（CC 的 truncate(prompt, 80, true)）", () => {
  it("正好 80 列原样保留", () => {
    const exactly80 = "y".repeat(80);
    expect(previewPrompt(exactly80)).toBe(exactly80);
  });

  it("81 列时留 79 列 + 省略号", () => {
    expect(previewPrompt("y".repeat(81))).toBe(`${"y".repeat(79)}…`);
  });

  it("首行正好 80 列时不再额外补省略号（截断器原样返回）", () => {
    expect(previewPrompt(`${"z".repeat(80)}\nsecond`)).toBe("z".repeat(80));
  });

  it("首行未超宽但有换行：首行 + 省略号", () => {
    expect(previewPrompt("short\nsecond")).toBe("short…");
  });
});
