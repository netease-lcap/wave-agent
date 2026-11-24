import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text } from "ink";
import { useTerminalSize } from "../contexts/useTerminalSize.js";
import { useTasks } from "../hooks/useTasks.js";
import type { Task, TaskStatus } from "wave-agent-sdk";

const RECENTLY_COMPLETED_TTL_MS = 30_000;
const AUTO_HIDE_DELAY_MS = 5_000;

export const getStatusIcon = (status: TaskStatus): React.ReactNode => {
  switch (status) {
    case "pending":
      return <Text color="gray">□</Text>;
    case "in_progress":
      return <Text color="yellow">■</Text>;
    case "completed":
      return <Text color="green">✓</Text>;
    case "deleted":
      return <Text color="red">✕</Text>;
    default:
      return <Text color="gray">?</Text>;
  }
};

function byIdAsc(a: Task, b: Task): number {
  const aNum = parseInt(a.id, 10);
  const bNum = parseInt(b.id, 10);
  if (!isNaN(aNum) && !isNaN(bNum)) {
    return aNum - bNum;
  }
  return a.id.localeCompare(b.id);
}

export function sortTasksByPriority(
  tasks: Task[],
  completionTimestamps: Map<string, number>,
  now: number,
  needsTruncation: boolean,
): Task[] {
  if (!needsTruncation) {
    // No truncation needed — sort by ID for stable ordering
    return [...tasks].sort(byIdAsc);
  }

  // When truncation is needed, prioritize:
  // recently completed > in_progress > pending (unblocked first) > older completed > deleted
  const recentCompleted: Task[] = [];
  const olderCompleted: Task[] = [];
  for (const task of tasks.filter((t) => t.status === "completed")) {
    const ts = completionTimestamps.get(task.id);
    if (ts && now - ts < RECENTLY_COMPLETED_TTL_MS) {
      recentCompleted.push(task);
    } else {
      olderCompleted.push(task);
    }
  }
  recentCompleted.sort(byIdAsc);
  olderCompleted.sort(byIdAsc);

  const inProgress = tasks
    .filter((t) => t.status === "in_progress")
    .sort(byIdAsc);

  const unresolvedTaskIds = new Set(
    tasks.filter((t) => t.status !== "completed").map((t) => t.id),
  );
  const pending = tasks
    .filter((t) => t.status === "pending")
    .sort((a, b) => {
      const aBlocked = a.blockedBy.some((id) => unresolvedTaskIds.has(id));
      const bBlocked = b.blockedBy.some((id) => unresolvedTaskIds.has(id));
      if (aBlocked !== bBlocked) return aBlocked ? 1 : -1;
      return byIdAsc(a, b);
    });

  const deleted = tasks.filter((t) => t.status === "deleted").sort(byIdAsc);

  return [
    ...recentCompleted,
    ...inProgress,
    ...pending,
    ...olderCompleted,
    ...deleted,
  ];
}

function getDisplayLimit(rows: number | undefined): number {
  const available = rows ?? 24;
  return available <= 10 ? 0 : Math.min(10, Math.max(3, available - 14));
}

export const TaskList: React.FC = () => {
  const tasks = useTasks();
  const { isTaskListVisible, isBtwActive } = useChat();
  const { rows } = useTerminalSize();

  const completionTimestampsRef = React.useRef<Map<string, number>>(new Map());
  const previousCompletedIdsRef = React.useRef<Set<string> | null>(null);
  const autoHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [autoHidden, setAutoHidden] = React.useState(false);
  // 是否在当前展示期间观察到过未完成任务；用于区分“任务在眼前完成”与“加载时已全部完成”
  const hadIncompleteRef = React.useRef(false);
  const [, forceUpdate] = React.useState(0);

  const now = Date.now();
  const activeTasks = tasks.filter((t) => t.status !== "deleted");

  // Track completion timestamps: only set when a task newly transitions to completed
  if (previousCompletedIdsRef.current === null) {
    previousCompletedIdsRef.current = new Set(
      tasks.filter((t) => t.status === "completed").map((t) => t.id),
    );
  }
  const currentCompletedIds = new Set(
    tasks.filter((t) => t.status === "completed").map((t) => t.id),
  );
  for (const id of currentCompletedIds) {
    if (!previousCompletedIdsRef.current.has(id)) {
      completionTimestampsRef.current.set(id, now);
    }
  }
  for (const id of completionTimestampsRef.current.keys()) {
    if (!currentCompletedIds.has(id)) {
      completionTimestampsRef.current.delete(id);
    }
  }
  previousCompletedIdsRef.current = currentCompletedIds;

  // Schedule re-render when the next recent completion expires
  React.useEffect(() => {
    if (completionTimestampsRef.current.size === 0) return;
    const currentNow = Date.now();
    let earliestExpiry = Infinity;
    for (const ts of completionTimestampsRef.current.values()) {
      const expiry = ts + RECENTLY_COMPLETED_TTL_MS;
      if (expiry > currentNow && expiry < earliestExpiry) {
        earliestExpiry = expiry;
      }
    }
    if (earliestExpiry === Infinity) return;
    const timer = setTimeout(
      () => forceUpdate((n) => n + 1),
      earliestExpiry - currentNow,
    );
    return () => clearTimeout(timer);
  }, [tasks]);

  // Auto-hide logic: when all active tasks are completed
  const allCompleted =
    activeTasks.length > 0 &&
    activeTasks.every((t) => t.status === "completed");

  // 自动隐藏这两条边都在 render 期算（判据就是上面这个 `allCompleted` 与
  // `hadIncompleteRef`），不放进下面那个 effect：effect 会先提交一帧错的 ——
  // 新任务已经出现、列表却还隐着；或者加载时就已经全部完成的会话先闪一下。
  //
  // - 有任务重新跑起来：取消隐藏（否则下一次全部完成会立刻藏掉，丢掉那 5 秒）；
  // - 一帧未完成都没见过（加载/恢复到已全部完成的会话）：直接隐掉。
  //
  // 下面的 effect 仍要在这两支里记 `hadIncompleteRef`（区分「在眼前完成」与
  // 「加载时已全部完成」），只是不再改 state。
  if (activeTasks.length > 0) {
    if (!allCompleted && autoHidden) {
      setAutoHidden(false);
    }
    if (allCompleted && !hadIncompleteRef.current && !autoHidden) {
      setAutoHidden(true);
    }
  }

  // 观察到任务从“存在未完成”变为“全部完成”时保留 5 秒再隐藏；
  // 加载或恢复到已全部完成的会话时立即隐藏，避免先闪现再消失
  React.useEffect(() => {
    if (activeTasks.length === 0) {
      hadIncompleteRef.current = false;
      return;
    }
    if (!allCompleted) {
      hadIncompleteRef.current = true;
      return;
    }
    // 这一支的隐藏已由 render 期那一支做掉，这里只剩「不用排 5 秒的定时器」。
    if (!hadIncompleteRef.current) {
      return;
    }
    if (!autoHidden) {
      autoHideTimerRef.current = setTimeout(() => {
        setAutoHidden(true);
      }, AUTO_HIDE_DELAY_MS);
    }
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    };
  }, [allCompleted, autoHidden, activeTasks.length]);

  if (
    tasks.length === 0 ||
    !isTaskListVisible ||
    isBtwActive ||
    autoHidden ||
    (allCompleted && !hadIncompleteRef.current)
  ) {
    return null;
  }

  const displayLimit = getDisplayLimit(rows);
  const needsTruncation = tasks.length > displayLimit;
  const sorted = sortTasksByPriority(
    tasks,
    completionTimestampsRef.current,
    now,
    needsTruncation,
  );
  const displayed = displayLimit > 0 ? sorted.slice(0, displayLimit) : [];
  const hidden = displayLimit > 0 ? sorted.slice(displayLimit) : sorted;

  const doneCount = tasks.filter((t) => t.status === "completed").length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const openCount = tasks.filter((t) => t.status === "pending").length;

  // Summary parts for hidden tasks
  const hiddenInProgress = hidden.filter(
    (t) => t.status === "in_progress",
  ).length;
  const hiddenPending = hidden.filter((t) => t.status === "pending").length;
  const hiddenCompleted = hidden.filter((t) => t.status === "completed").length;

  const summaryParts: string[] = [];
  if (hiddenInProgress > 0)
    summaryParts.push(`${hiddenInProgress} in progress`);
  if (hiddenPending > 0) summaryParts.push(`${hiddenPending} pending`);
  if (hiddenCompleted > 0) summaryParts.push(`${hiddenCompleted} completed`);

  return (
    <Box flexDirection="column">
      <Text dimColor>
        {tasks.length} tasks ({doneCount} done, {inProgressCount} in progress,{" "}
        {openCount} open)
      </Text>
      {displayed.map((task) => {
        const isDimmed =
          task.status === "completed" || task.status === "deleted";
        const unresolvedTaskIds = new Set(
          tasks.filter((t) => t.status !== "completed").map((t) => t.id),
        );
        const isBlocked =
          task.blockedBy &&
          task.blockedBy.some((id) => unresolvedTaskIds.has(id));
        const blockingTaskIds = isBlocked
          ? task.blockedBy.map((id) => `#${id}`)
          : [];

        const blockedByText =
          isBlocked && blockingTaskIds.length > 0
            ? ` (Blocked by: ${blockingTaskIds.join(", ")})`
            : "";

        const fullText = `${task.subject}${blockedByText}`;

        return (
          <Box key={task.id} gap={1}>
            {getStatusIcon(task.status)}
            <Text dimColor={isDimmed} wrap="truncate-end">
              {fullText}
            </Text>
          </Box>
        );
      })}
      {displayLimit > 0 && hidden.length > 0 && (
        <Text dimColor> … +{summaryParts.join(", ")}</Text>
      )}
    </Box>
  );
};
