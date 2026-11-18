/**
 * 后台任务列表的分组口径（CLI 弹层）。与 webview 的
 * `utils/groupBackgroundTasks.ts` 同一套语义：按**任务类型**分组，组内运行中在前、
 * 其余按启动时间倒序 —— 分成两个文件是因为两端跨包（CLI 不吃 webview 产物、
 * webview 也不能引 CLI），改口径时两边一起看。
 */

/** 分组顺序照 CC 后台任务弹层：bash → agent → workflow。 */
const TYPE_ORDER = ["shell", "subagent", "workflow"] as const;

const TYPE_LABELS: Record<string, string> = {
  shell: "Bash",
  subagent: "Agents",
  workflow: "Workflows",
};

/** 组标题；未知类型用原始 type，宁可标题不漂亮也不吞掉任务。 */
export const taskGroupLabel = (type: string): string =>
  TYPE_LABELS[type] ?? type;

const groupRank = (type: string): number => {
  const index = (TYPE_ORDER as readonly string[]).indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
};

interface SortableTask {
  type: string;
  status: string;
  startTime: number;
}

/**
 * 排成「组序 + 组内运行中在前 + 组内新的在上」。
 *
 * 列表选中是按下标走的（`selectedIndex`），所以排序只能发生在写入 reducer 之前 ——
 * 一旦顺序与下标对不上，↑/↓ 会跳到别人的行上。
 */
export function sortBackgroundTasks<T extends SortableTask>(tasks: T[]): T[] {
  return [...tasks].sort(
    (a, b) =>
      groupRank(a.type) - groupRank(b.type) ||
      (a.status === "running" ? 0 : 1) - (b.status === "running" ? 0 : 1) ||
      b.startTime - a.startTime,
  );
}
