import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text, useStdout } from "ink";
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

export function sortTasksByPriority(
  tasks: Task[],
  recentlyCompleted: Map<string, number>,
  now: number,
): Task[] {
  const getPriority = (task: Task): number => {
    const completedAt = recentlyCompleted.get(task.id);
    const isRecentlyCompleted =
      completedAt !== undefined &&
      now - completedAt < RECENTLY_COMPLETED_TTL_MS;

    if (isRecentlyCompleted) return 0;
    if (task.status === "in_progress") return 1;
    if (task.status === "pending" && task.blockedBy.length === 0) return 2;
    if (task.status === "pending" && task.blockedBy.length > 0) return 3;
    if (task.status === "completed") return 4;
    if (task.status === "deleted") return 5;
    return 6;
  };

  return [...tasks].sort((a, b) => getPriority(a) - getPriority(b));
}

function getDisplayLimit(rows: number | undefined): number {
  const available = rows ?? 24;
  return Math.min(8, Math.max(3, available - 12));
}

export const TaskList: React.FC = () => {
  const tasks = useTasks();
  const { isTaskListVisible } = useChat();
  const { stdout } = useStdout();

  const recentlyCompletedRef = React.useRef<Map<string, number>>(new Map());
  const autoHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [autoHidden, setAutoHidden] = React.useState(() => {
    // If all tasks are already completed on mount (e.g. session restore),
    // start hidden immediately instead of flashing for 5 seconds.
    const active = tasks.filter((t) => t.status !== "deleted");
    return active.length > 0 && active.every((t) => t.status === "completed");
  });
  const [, setTick] = React.useState(0);

  const now = Date.now();
  const activeTasks = tasks.filter((t) => t.status !== "deleted");

  // Track recently completed tasks
  for (const task of tasks) {
    if (
      task.status === "completed" &&
      !recentlyCompletedRef.current.has(task.id)
    ) {
      recentlyCompletedRef.current.set(task.id, now);
    }
  }

  // Prune expired entries and force re-render if any expired
  const needsTick = React.useMemo(() => {
    let expired = false;
    for (const [id, ts] of recentlyCompletedRef.current) {
      if (now - ts >= RECENTLY_COMPLETED_TTL_MS) {
        recentlyCompletedRef.current.delete(id);
        expired = true;
      }
    }
    return expired;
  }, [now]);

  React.useEffect(() => {
    if (needsTick) {
      setTick((t) => t + 1);
    }
  }, [needsTick]);

  // Auto-hide logic: when all active tasks are completed
  const allCompleted =
    activeTasks.length > 0 &&
    activeTasks.every((t) => t.status === "completed");

  React.useEffect(() => {
    if (allCompleted && !autoHidden) {
      autoHideTimerRef.current = setTimeout(() => {
        setAutoHidden(true);
      }, AUTO_HIDE_DELAY_MS);
    }
    if (!allCompleted && autoHidden) {
      setAutoHidden(false);
    }
    return () => {
      if (autoHideTimerRef.current) {
        clearTimeout(autoHideTimerRef.current);
        autoHideTimerRef.current = null;
      }
    };
  }, [allCompleted, autoHidden]);

  if (tasks.length === 0 || !isTaskListVisible || autoHidden) {
    return null;
  }

  const displayLimit = getDisplayLimit(stdout?.rows);
  const sorted = sortTasksByPriority(tasks, recentlyCompletedRef.current, now);
  const displayed = sorted.slice(0, displayLimit);
  const hidden = sorted.slice(displayLimit);

  const doneCount = tasks.filter((t) => t.status === "completed").length;
  const inProgressCount = tasks.filter(
    (t) => t.status === "in_progress",
  ).length;
  const openCount = tasks.filter(
    (t) => t.status === "pending" || t.status === "in_progress",
  ).length;

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
        const isBlocked = task.blockedBy && task.blockedBy.length > 0;
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
      {hidden.length > 0 && (
        <Text dimColor>
          {" "}
          +{hidden.length} {summaryParts.join(", ")}
        </Text>
      )}
    </Box>
  );
};
