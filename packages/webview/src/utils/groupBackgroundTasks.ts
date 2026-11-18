import type { BackgroundTaskSummary } from "../types";

/**
 * 后台任务列表的分组口（spec `desktop/desktop-right-panel.md` 场景 5 /
 * `multi-agent/task-background-execution.md` 场景 1）。
 *
 * 分组的维度是**类型**，不是状态——照 CC 的后台任务弹层（它按 `local_bash` /
 * `local_agent` / `local_workflow` 各成一组）。按状态分组时，一个任务跑完就从
 * 「运行中」整行挪到「已结束」，读者刚扫到的那一行会自己跑掉；按类型分组则位置
 * 稳定，状态只改它在本组里的名次。
 */
const TYPE_LABELS: ReadonlyArray<{ type: string; label: string }> = [
  { type: "shell", label: "Bash" },
  { type: "subagent", label: "子 Agent" },
  { type: "workflow", label: "工作流" },
];

export interface BackgroundTaskGroup {
  /** 组 id === 任务类型（未知类型也用它自己的 type，不吞任务）。 */
  type: string;
  label: string;
  tasks: BackgroundTaskSummary[];
}

/** 组内：运行中在前，同状态按启动时间倒序（新的在上），与 CC 同口径。 */
const byRunningThenNewest = (
  a: BackgroundTaskSummary,
  b: BackgroundTaskSummary,
): number => {
  const aRank = a.status === "running" ? 0 : 1;
  const bRank = b.status === "running" ? 0 : 1;
  return aRank - bRank || b.startTime - a.startTime;
};

/**
 * 按类型分组，组内排好序；空组不返回。
 *
 * 未知类型（未来新增的任务类型走到旧版 webview）排在三组之后，标题用它的原始
 * `type` —— 宁可标题不漂亮，也不让任务在列表里消失。
 */
export function groupBackgroundTasks(
  tasks: BackgroundTaskSummary[],
): BackgroundTaskGroup[] {
  const groups = new Map<string, BackgroundTaskGroup>();
  for (const { type, label } of TYPE_LABELS) {
    groups.set(type, { type, label, tasks: [] });
  }
  for (const task of tasks) {
    let group = groups.get(task.type);
    if (!group) {
      group = { type: task.type, label: task.type, tasks: [] };
      groups.set(task.type, group);
    }
    group.tasks.push(task);
  }
  return [...groups.values()]
    .filter((group) => group.tasks.length > 0)
    .map((group) => ({
      ...group,
      tasks: [...group.tasks].sort(byRunningThenNewest),
    }));
}
