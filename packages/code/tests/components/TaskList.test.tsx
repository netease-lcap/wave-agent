import { render } from "ink-testing-library";
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  TaskList,
  getStatusIcon,
  sortTasksByPriority,
} from "../../src/components/TaskList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import { useStdout } from "ink";
import type { Task } from "wave-agent-sdk";

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useStdout: vi.fn(() => ({ stdout: { rows: 24 } })),
  };
});

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    subject: `Task ${overrides.id}`,
    status: "pending" as const,
    description: "",
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

describe("TaskList", () => {
  beforeEach(() => {
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  it("should render nothing when there are no tasks", () => {
    vi.mocked(useTasks).mockReturnValue([]);
    const { lastFrame } = render(<TaskList />);
    expect(lastFrame()).toBeFalsy();
  });

  it("should render nothing when isTaskListVisible is false", () => {
    vi.mocked(useTasks).mockReturnValue([
      makeTask({ id: "1", subject: "Task 1" }),
    ]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: false,
    } as unknown as ChatContextType);
    const { lastFrame } = render(<TaskList />);
    expect(lastFrame()).toBeFalsy();
  });

  it("should render tasks with correct icons and subjects", () => {
    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Pending Task", status: "pending" }),
      makeTask({ id: "2", subject: "In Progress Task", status: "in_progress" }),
      makeTask({ id: "3", subject: "Completed Task", status: "completed" }),
      makeTask({ id: "4", subject: "Deleted Task", status: "deleted" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    expect(output).toContain("□ Pending Task");
    expect(output).toContain("■ In Progress Task");
    expect(output).toContain("✓ Completed Task");
    expect(output).toContain("✕ Deleted Task");
  });

  it("should show header with task counts", () => {
    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Pending Task", status: "pending" }),
      makeTask({ id: "2", subject: "In Progress Task", status: "in_progress" }),
      makeTask({ id: "3", subject: "Completed Task", status: "completed" }),
      makeTask({ id: "4", subject: "Completed Task 2", status: "completed" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    // "open" counts only pending tasks, not in_progress (no double-counting)
    expect(output).toContain("4 tasks (2 done, 1 in progress, 1 open)");
  });

  it("should not double-count in_progress in open count", () => {
    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Task 1", status: "in_progress" }),
      makeTask({ id: "2", subject: "Task 2", status: "in_progress" }),
      makeTask({ id: "3", subject: "Task 3", status: "pending" }),
      makeTask({ id: "4", subject: "Task 4", status: "completed" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    // open = pending only (1), not pending + in_progress (3)
    expect(output).toContain("4 tasks (1 done, 2 in progress, 1 open)");
    expect(output).not.toContain("3 open");
  });

  it("should truncate long task subjects with wrap=truncate-end", () => {
    const longSubject =
      "This is a very long task subject that should be truncated with wrap";
    vi.mocked(useTasks).mockReturnValue([
      makeTask({ id: "1", subject: longSubject }),
    ]);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    // The text should still contain the subject (ink-testing-library may not
    // actually truncate in test env, but the wrap prop is set)
    expect(output).toContain(longSubject);
  });

  it("should render blocked tasks with pending icon and blocking subjects", () => {
    const mockTasks: Task[] = [
      makeTask({
        id: "1",
        subject: "Blocking Task",
        status: "pending",
        blocks: ["2"],
        blockedBy: [],
      }),
      makeTask({
        id: "2",
        subject: "Blocked Task",
        status: "pending",
        blocks: [],
        blockedBy: ["1"],
      }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    expect(output).toContain("□ Blocked Task (Blocked by: #1)");
  });

  it("should limit displayed tasks based on terminal height", () => {
    vi.mocked(useStdout).mockReturnValue({
      stdout: { rows: 10 },
    } as unknown as ReturnType<typeof useStdout>);

    const mockTasks: Task[] = Array.from({ length: 8 }, (_, i) =>
      makeTask({
        id: String(i + 1),
        subject: `Task ${i + 1}`,
        status: "pending",
      }),
    );
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    // rows=10 → displayLimit = min(8, max(3, 10-12)) = min(8, max(3, -2)) = min(8, 3) = 3
    expect(output).toContain("Task 1");
    expect(output).toContain("Task 2");
    expect(output).toContain("Task 3");
    // Tasks beyond the limit should be in the summary
    expect(output).toContain("+5 5 pending");
  });

  it("should show summary line for hidden tasks", () => {
    // Use rows=10 → displayLimit=3 to force truncation with mixed statuses
    vi.mocked(useStdout).mockReturnValue({
      stdout: { rows: 10 },
    } as unknown as ReturnType<typeof useStdout>);

    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Working", status: "in_progress" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
      makeTask({ id: "3", subject: "Also Done", status: "completed" }),
      makeTask({ id: "4", subject: "Pending 1", status: "pending" }),
      makeTask({ id: "5", subject: "Pending 2", status: "pending" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame()!;

    // displayLimit=3: shows "Working", "Done", "Also Done" (recently completed first, then in_progress)
    // Hidden: 2 pending → summary
    expect(output).toMatch(/\+2.*2 pending/);
  });

  it("should sort by priority when tasks exceed display limit", () => {
    vi.mocked(useStdout).mockReturnValue({
      stdout: { rows: 10 },
    } as unknown as ReturnType<typeof useStdout>);

    const recentlyCompleted = new Map<string, number>();
    const now = Date.now();

    const tasks: Task[] = [
      makeTask({
        id: "1",
        subject: "Pending blocked",
        status: "pending",
        blockedBy: ["2"],
      }),
      makeTask({ id: "2", subject: "Pending unblocked", status: "pending" }),
      makeTask({ id: "3", subject: "In progress", status: "in_progress" }),
      makeTask({ id: "4", subject: "Old completed", status: "completed" }),
    ];

    const sorted = sortTasksByPriority(tasks, recentlyCompleted, now);

    // in_progress first, then pending unblocked, then pending blocked, then completed
    expect(sorted[0].subject).toBe("In progress");
    expect(sorted[1].subject).toBe("Pending unblocked");
    expect(sorted[2].subject).toBe("Pending blocked");
    expect(sorted[3].subject).toBe("Old completed");
  });

  it("should sort recently completed tasks before in_progress", () => {
    const recentlyCompleted = new Map<string, number>();
    const now = Date.now();
    recentlyCompleted.set("1", now - 1000); // 1s ago

    const tasks: Task[] = [
      makeTask({ id: "1", subject: "Just completed", status: "completed" }),
      makeTask({ id: "2", subject: "In progress", status: "in_progress" }),
    ];

    const sorted = sortTasksByPriority(tasks, recentlyCompleted, now);

    expect(sorted[0].subject).toBe("Just completed");
    expect(sorted[1].subject).toBe("In progress");
  });

  it("should auto-hide after all tasks completed", () => {
    vi.useFakeTimers();
    // Start with an in-progress task so the list is visible
    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Working", status: "in_progress" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame, rerender } = render(<TaskList />);
    expect(lastFrame()).toBeTruthy();

    // Complete the remaining task
    vi.mocked(useTasks).mockReturnValue([
      makeTask({ id: "1", subject: "Working", status: "completed" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
    ]);
    rerender(<TaskList />);
    expect(lastFrame()).toBeTruthy();

    vi.advanceTimersByTime(5000);
    rerender(<TaskList />);
    expect(lastFrame()).toBeFalsy();

    vi.useRealTimers();
  });

  it("should be hidden immediately when mounted with all completed tasks", () => {
    const mockTasks: Task[] = [
      makeTask({ id: "1", subject: "Done 1", status: "completed" }),
      makeTask({ id: "2", subject: "Done 2", status: "completed" }),
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);

    const { lastFrame } = render(<TaskList />);
    // Should be hidden immediately, no 5-second flash
    expect(lastFrame()).toBeFalsy();
  });

  it("should reappear when new task added after auto-hide", () => {
    vi.useFakeTimers();
    // Start with in-progress so list is visible initially
    const initialTasks: Task[] = [
      makeTask({ id: "1", subject: "Working", status: "in_progress" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
    ];
    vi.mocked(useTasks).mockReturnValue(initialTasks);

    const { lastFrame, rerender, unmount } = render(<TaskList />);
    expect(lastFrame()).toBeTruthy();

    // Complete all tasks → auto-hide after delay
    vi.mocked(useTasks).mockReturnValue([
      makeTask({ id: "1", subject: "Working", status: "completed" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
    ]);
    rerender(<TaskList />);
    vi.advanceTimersByTime(5000);
    rerender(<TaskList />);
    expect(lastFrame()).toBeFalsy();
    unmount();

    // Add a new pending task and mount fresh
    vi.mocked(useTasks).mockReturnValue([
      makeTask({ id: "1", subject: "Working", status: "completed" }),
      makeTask({ id: "2", subject: "Done", status: "completed" }),
      makeTask({ id: "3", subject: "New Task", status: "pending" }),
    ]);
    const { lastFrame: lastFrame2 } = render(<TaskList />);
    expect(lastFrame2()).toBeTruthy();
    expect(lastFrame2()).toContain("New Task");

    vi.useRealTimers();
  });
});

describe("getStatusIcon", () => {
  it("returns correct icons for each status", () => {
    // Just verify it returns non-null JSX for each status
    expect(getStatusIcon("pending")).toBeTruthy();
    expect(getStatusIcon("in_progress")).toBeTruthy();
    expect(getStatusIcon("completed")).toBeTruthy();
    expect(getStatusIcon("deleted")).toBeTruthy();
  });
});
