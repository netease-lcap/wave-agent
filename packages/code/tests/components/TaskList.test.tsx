import { render } from "ink-testing-library";
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { TaskList } from "../../src/components/TaskList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Task } from "wave-agent-sdk";

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("TaskList", () => {
  it("should render nothing when there are no tasks", () => {
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
    const { lastFrame } = render(<TaskList />);
    expect(lastFrame()).toBeFalsy();
  });

  it("should render nothing when isTaskListVisible is false", () => {
    const mockTasks: Task[] = [
      {
        id: "1",
        subject: "Task 1",
        status: "pending",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: false,
    } as unknown as ChatContextType);
    const { lastFrame } = render(<TaskList />);
    expect(lastFrame()).toBeFalsy();
  });

  it("should render tasks with correct icons and subjects", () => {
    const mockTasks: Task[] = [
      {
        id: "1",
        subject: "Pending Task",
        status: "pending",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "In Progress Task",
        status: "in_progress",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "3",
        subject: "Completed Task",
        status: "completed",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "4",
        subject: "Deleted Task",
        status: "deleted",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame();

    expect(output).toContain("TASKS");
    expect(output).toContain("○ Pending Task");
    expect(output).toContain("● In Progress Task");
    expect(output).toContain("✓ Completed Task");
    expect(output).toContain("✕ Deleted Task");
  });

  it("should truncate long task subjects", () => {
    const longSubject =
      "This is a very long task subject that should be truncated because it exceeds the terminal width";
    const mockTasks: Task[] = [
      {
        id: "1",
        subject: longSubject,
        status: "pending",
        description: "",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame();

    expect(output).toContain("...");
    // The truncated text should be present
    expect(output).toContain(longSubject.slice(0, 10));
  });

  it("should render blocked tasks with lock icon and blocking subjects", () => {
    const mockTasks: Task[] = [
      {
        id: "1",
        subject: "Blocking Task",
        status: "pending",
        description: "",
        blocks: ["2"],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "Blocked Task",
        status: "pending",
        description: "",
        blocks: [],
        blockedBy: ["1"],
        metadata: {},
      },
    ];
    vi.mocked(useTasks).mockReturnValue(mockTasks);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);

    const { lastFrame } = render(<TaskList />);
    const output = lastFrame();

    expect(output).toContain("🔒 Blocked Task (Blocked by: Blocking Task)");
  });
});
