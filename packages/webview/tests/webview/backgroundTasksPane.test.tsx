/**
 * 桌面端后台任务面板（spec `desktop/desktop-right-panel.md`「后台任务面板」）。
 *
 * 与插件端对话框同一份数据（`backgroundTasksChange` 推送），只是换到右侧
 * 面板承载：`/tasks` 打开 tab 而不是居中对话框，列表按运行中/已结束分组，
 * 详情里命令行块与输出块各自限高并在内部滚动，关闭最后一个 tab 面板一并收起。
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import type { BackgroundTaskSummary } from "../../src/types";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  fireInput,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

const runningTask: BackgroundTaskSummary = {
  id: "bg-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  description: "long-running build",
};

const finishedTask: BackgroundTaskSummary = {
  id: "bg-2",
  type: "subagent",
  status: "completed",
  startTime: 500,
  runtime: 5000,
  exitCode: 0,
  description: "explore the repo",
};

function renderDesktop() {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({ workdir: "/work/a", recentWorkdirs: [] }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

/** 面板栈里可见的那个 pane（非激活 tab 被 display:none 藏起来但仍挂载）。 */
const visiblePane = (testId: string) =>
  screen.getAllByTestId(testId).find((p) => {
    const stack = p.closest(".desktop-panel-stack") as HTMLElement | null;
    return stack?.style.display !== "none";
  });

async function sendSlash(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

const postsOf = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls.map(([msg]) => msg as Record<string, unknown>);

beforeEach(() => {
  prunePanelGroupCache(new Set());
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
});

describe("Desktop background tasks pane", () => {
  it("opens a panel tab for /tasks instead of the centered dialog", async () => {
    const { vscode } = renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });

    await act(async () => {
      await sendSlash("/tasks");
    });

    expect(screen.queryByTestId("background-task-manager")).toBeNull();
    expect(visiblePane("tasks-pane")).toBeInTheDocument();
    expect(postsOf(vscode).filter((p) => p.command === "sendMessage")).toEqual(
      [],
    );
  });

  it("keeps a single tab when /tasks fires again", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });

    await act(async () => {
      await sendSlash("/tasks");
    });
    await act(async () => {
      await sendSlash("/tasks");
    });

    expect(screen.getAllByTestId("panel-tab-tasks-1")).toHaveLength(1);
    expect(screen.queryByTestId("panel-tab-tasks-2")).toBeNull();
  });

  it("groups running tasks before finished ones", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [finishedTask] });
    });
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [finishedTask, runningTask],
      });
    });

    await act(async () => {
      await sendSlash("/tasks");
    });

    const groups = screen
      .getAllByText(/^(运行中|已结束)$/)
      .map((el) => el.textContent);
    expect(groups).toEqual(["运行中", "已结束"]);
    expect(screen.getByTestId("tasks-pane-row-bg-1")).toBeInTheDocument();
    expect(screen.getByTestId("tasks-pane-row-bg-2")).toBeInTheDocument();
  });

  it("opens a detail view with the command block and returns to the list", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });
    await act(async () => {
      await sendSlash("/tasks");
    });

    fireEvent.click(screen.getByTestId("tasks-pane-row-bg-1"));

    expect(screen.getByTestId("tasks-pane-command")).toHaveTextContent(
      "npm run build",
    );
    expect(screen.getByTestId("tasks-pane-output")).toHaveTextContent(
      "加载中...",
    );

    fireEvent.click(screen.getByTestId("tasks-pane-back"));
    expect(screen.queryByTestId("tasks-pane-detail")).toBeNull();
    expect(screen.getByTestId("tasks-pane-row-bg-1")).toBeInTheDocument();
  });

  it("shows the log tail and stops a running task from the detail view", async () => {
    const { vscode } = renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });
    await act(async () => {
      await sendSlash("/tasks");
    });
    fireEvent.click(screen.getByTestId("tasks-pane-row-bg-1"));

    expect(postsOf(vscode)).toContainEqual({
      command: "getBackgroundTaskOutput",
      taskId: "bg-1",
    });

    act(() => {
      sendCommand("backgroundTaskOutput", {
        taskId: "bg-1",
        output: {
          stdout: "line 1\nline 2",
          stderr: "boom",
          status: "running",
          type: "shell",
        },
      } as never);
    });
    expect(screen.getByTestId("tasks-pane-output")).toHaveTextContent("line 2");
    expect(screen.getByTestId("tasks-pane-stderr")).toHaveTextContent("boom");

    fireEvent.click(screen.getByTestId("tasks-pane-detail-stop"));
    expect(postsOf(vscode)).toContainEqual({
      command: "stopBackgroundTask",
      taskId: "bg-1",
    });
  });

  it("shows the empty state when the session has no background task", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [] });
    });
    await act(async () => {
      await sendSlash("/tasks");
    });

    expect(visiblePane("tasks-pane")).toHaveTextContent("暂无后台任务");
  });

  it("collapses the panel when the tasks tab was the last one", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });
    await act(async () => {
      await sendSlash("/tasks");
    });

    fireEvent.click(screen.getByTestId("panel-tab-close-tasks-1"));

    expect(screen.queryByTestId("desktop-panel-slot")).toBeNull();
  });
});
