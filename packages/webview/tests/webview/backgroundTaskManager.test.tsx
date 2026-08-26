import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  waitFor,
  act,
  sendCommand,
  fireEvent,
} from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

/**
 * BackgroundTaskManager roving focus circle (spec:
 * task-background-execution.md 「后台任务弹窗键盘焦点圈」). The task list is a
 * single Tab stop; ArrowUp/Down move the selection, Enter opens the selected
 * task's detail view, and focus returns to the list on "返回列表".
 */
describe("BackgroundTaskManager roving focus circle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const tasks: BackgroundTaskSummary[] = [
    {
      id: "t1",
      type: "shell",
      status: "running",
      description: "npm install",
      startTime: Date.now(),
    },
    {
      id: "t2",
      type: "subagent",
      status: "completed",
      description: "code review",
      startTime: Date.now(),
    },
  ];

  const openTasksDialog = (taskList: BackgroundTaskSummary[]) => {
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: taskList });
    });
    act(() => {
      sendCommand("showDialog", { dialogType: "tasks" });
    });
  };

  const waitForDialog = () =>
    waitFor(() => {
      expect(
        document.querySelector(".configuration-dialog"),
      ).toBeInTheDocument();
    });

  it("the task list is a single Tab stop and receives focus on open", async () => {
    openTasksDialog(tasks);
    await waitForDialog();
    const list = document.querySelector(".mcp-server-list")!;
    expect(list).toBeInTheDocument();
    expect((list as HTMLElement).tabIndex).toBe(0);
    expect(document.activeElement).toBe(list);
  });

  it("Arrow keys move the roving selection (highlight), Enter opens the detail", async () => {
    openTasksDialog(tasks);
    await waitForDialog();
    const list = document.querySelector(".mcp-server-list")!;

    // No selection before interaction.
    expect(list.querySelector(".roving-selected")).toBeNull();

    act(() => {
      fireEvent.keyDown(list, { key: "ArrowDown" });
    });
    expect(
      list
        .querySelectorAll(".mcp-server-item")[1]
        .classList.contains("roving-selected"),
    ).toBe(true);

    act(() => {
      fireEvent.keyDown(list, { key: "ArrowUp" });
    });
    expect(
      list
        .querySelectorAll(".mcp-server-item")[0]
        .classList.contains("roving-selected"),
    ).toBe(true);

    // Enter opens the selected task's detail view.
    act(() => {
      fireEvent.keyDown(list, { key: "Enter" });
    });
    await waitFor(() => {
      expect(
        document.querySelector(".mcp-server-item .mcp-server-name"),
      ).toHaveTextContent("[t1] shell");
    });
  });

  it("empty list skips the list: focus lands on the close button", async () => {
    openTasksDialog([]);
    await waitForDialog();
    expect(document.querySelector(".mcp-server-list")).toBeNull();
    expect(document.querySelector(".empty-state")).toBeInTheDocument();
    const closeBtn = document.querySelector<HTMLElement>(
      ".configuration-actions button",
    )!;
    expect(document.activeElement).toBe(closeBtn);
  });

  it("dismissing restores focus to the element focused before the dialog", async () => {
    renderChatApp();
    const input = document.querySelector<HTMLElement>(
      '[data-testid="message-input"]',
    )!;
    act(() => {
      input.focus();
    });
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: tasks });
    });
    act(() => {
      sendCommand("showDialog", { dialogType: "tasks" });
    });
    await waitForDialog();
    expect(document.activeElement).not.toBe(input);
    act(() => {
      fireEvent.click(document.querySelector(".configuration-actions button")!);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });
});
