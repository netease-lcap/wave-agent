import { render } from "ink-testing-library";
import React, { useEffect } from "react";
import { describe, it, expect, vi } from "vitest";
import { useTasks } from "../../src/hooks/useTasks.js";
import { useChat } from "../../src/contexts/useChat.js";
import type { Task } from "wave-agent-sdk";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("useTasks", () => {
  function TestComponent({
    onHookValue,
  }: {
    onHookValue: (value: Task[]) => void;
  }) {
    const hookValue = useTasks();
    useEffect(() => {
      onHookValue(hookValue);
    }, [hookValue, onHookValue]);
    return null;
  }

  it("should return sessionTasks from useChat", () => {
    const mockTasks: Task[] = [
      {
        id: "1",
        subject: "Task 1",
        status: "pending",
        description: "Desc 1",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
      {
        id: "2",
        subject: "Task 2",
        status: "in_progress",
        description: "Desc 2",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ];

    vi.mocked(useChat).mockReturnValue({
      sessionTasks: mockTasks,
    } as unknown as ReturnType<typeof useChat>);

    let lastValue: Task[] | undefined;
    const onHookValue = (val: Task[]) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    expect(lastValue).toEqual(mockTasks);
  });

  it("should return empty array if no tasks", () => {
    vi.mocked(useChat).mockReturnValue({
      sessionTasks: [],
    } as unknown as ReturnType<typeof useChat>);

    let lastValue: Task[] | undefined;
    const onHookValue = (val: Task[]) => {
      lastValue = val;
    };

    render(<TestComponent onHookValue={onHookValue} />);

    expect(lastValue).toEqual([]);
  });
});
