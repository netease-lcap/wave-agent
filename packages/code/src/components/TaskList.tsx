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
  const { isTaskListVisible } = useChat();
  const { stdout } = useStdout();

  const completionTimestampsRef = React.useRef<Map<string, number>>(new Map());
  const previousCompletedIdsRef = React.useRef<Set<string> | null>(null);
  const autoHideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [autoHidden, setAutoHidden] = React.useState(() => {
    // If all tasks are already completed on mount (e.g. session restore),
    // start hidden immediately instead of flashing for 5 seconds.
    const active = tasks.filter((t) => t.status !== "deleted");
    return active.length > 0 && active.every((t) => t.status === "completed");
  });
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
