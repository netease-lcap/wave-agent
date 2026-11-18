/**
 * 后台任务列表的分组口径（spec `desktop/desktop-right-panel.md` 场景 5）：
 * 按任务类型分组、组内运行中在前 —— 两端（桌面面板 / 插件端对话框）都走这一个
 * 函数，所以口径钉在这里，UI 测试只断言它被用上了。
 */

import { describe, expect, it } from "vitest";
import { groupBackgroundTasks } from "../../src/utils/groupBackgroundTasks";
import type { BackgroundTaskSummary } from "../../src/types";

const task = (
  overrides: Partial<BackgroundTaskSummary> & { id: string },
): BackgroundTaskSummary => ({
  type: "shell",
  status: "completed",
  startTime: 0,
  ...overrides,
});

describe("groupBackgroundTasks", () => {
  it("orders groups shell → subagent → workflow, whatever order the data arrives in", () => {
    const groups = groupBackgroundTasks([
      task({ id: "w", type: "workflow" }),
      task({ id: "a", type: "subagent" }),
      task({ id: "s", type: "shell" }),
    ]);

    expect(groups.map((g) => g.label)).toEqual(["Shell", "子 Agent", "工作流"]);
    expect(groups.map((g) => g.tasks.map((t) => t.id))).toEqual([
      ["s"],
      ["a"],
      ["w"],
    ]);
  });

  it("keeps a finished task in its type group and ranks running ones first inside it", () => {
    const groups = groupBackgroundTasks([
      // 更晚启动、但已结束：组内名次看状态，不看启动时间先后。
      task({ id: "finished-late", status: "completed", startTime: 900 }),
      task({ id: "running-early", status: "running", startTime: 100 }),
      task({ id: "finished-early", status: "completed", startTime: 50 }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].tasks.map((t) => t.id)).toEqual([
      "running-early",
      "finished-late",
      "finished-early",
    ]);
  });

  it("keeps an unknown task type as its own trailing group instead of dropping it", () => {
    const groups = groupBackgroundTasks([
      // 类型来自宿主推送的 JSON：旧版 webview 配上新 SDK 时可能收到它还不认识的
      // 任务类型，这里用断言绕过联合类型把那种运行期形状造出来。
      task({ id: "future", type: "monitor" as BackgroundTaskSummary["type"] }),
      task({ id: "s" }),
    ]);

    expect(groups.map((g) => g.label)).toEqual(["Shell", "monitor"]);
    expect(groups[1].tasks.map((t) => t.id)).toEqual(["future"]);
  });

  it("does not return empty groups", () => {
    expect(groupBackgroundTasks([])).toEqual([]);
    expect(groupBackgroundTasks([task({ id: "s" })])).toHaveLength(1);
  });
});
