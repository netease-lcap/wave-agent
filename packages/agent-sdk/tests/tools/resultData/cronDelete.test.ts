import { describe, it, expect, vi } from "vitest";
import { cronDeleteTool } from "@/tools/cronDeleteTool.js";
import {
  renderCronDeleteResultData,
  type CronDeleteResultData,
} from "@/tools/resultData/cronDelete.js";
import type { CronManager } from "@/managers/cronManager.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`CronDelete` 的 `data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` 逐字相等。期望值是手写的字面量。
 */

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(renderCronDeleteResultData(result.data as CronDeleteResultData)).toBe(
    result.content,
  );
};

const contextWith = (deleteJob: ReturnType<typeof vi.fn>) =>
  ({
    cronManager: { deleteJob } as unknown as CronManager,
    workdir: "/test",
  }) as unknown as ToolContext;

describe("CronDelete data → 文本 golden", () => {
  it("删掉一个任务：一句话回显 id", async () => {
    const deleteJob = vi.fn().mockReturnValue(true);

    const result = await cronDeleteTool.execute(
      { id: "job-1" },
      contextWith(deleteJob),
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("Cancelled job job-1.");
    expect(result.data).toEqual({ id: "job-1" });
    expect(result.shortResult).toBe("Deleted job job-1");
    expectRendersBack(result);
  });

  it("id 不存在：error 分支，没有 data、没有正文", async () => {
    const deleteJob = vi.fn().mockReturnValue(false);

    const result = await cronDeleteTool.execute(
      { id: "job-9" },
      contextWith(deleteJob),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.data).toBeUndefined();
    expect(result.error).toBe("Job job-9 not found");
  });

  it("CronManager 不可用：error 分支，没有 data", async () => {
    const result = await cronDeleteTool.execute({ id: "job-1" }, {
      workdir: "/test",
    } as ToolContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.data).toBeUndefined();
    expect(result.error).toBe("CronManager not available");
  });
});
