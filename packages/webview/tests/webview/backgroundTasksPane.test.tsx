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

/** 同属 Bash 组、且比 `runningTask` 更早启动的已结束任务。 */
const alreadyFinishedShell: BackgroundTaskSummary = {
  id: "bg-3",
  type: "shell",
  status: "completed",
  startTime: 200,
  runtime: 1000,
  exitCode: 0,
  command: "npm ci",
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

  it("groups tasks by type, running ones first inside a group", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [finishedTask] });
    });
    act(() => {
      // 一个更早结束的 shell：分组维度是类型，跑完不换组，只改变组内名次，
      // 所以在 Bash 组里它排在更晚启动、仍在运行的那条之后。
      sendCommand("updateBackgroundTasks", {
        tasks: [alreadyFinishedShell, finishedTask, runningTask],
      });
    });

    await act(async () => {
      await sendSlash("/tasks");
    });

    const groups = screen
      .getAllByText(/^(Bash|子 Agent|工作流) \(\d+\)$/)
      .map((el) => el.textContent);
    expect(groups).toEqual(["Bash (2)", "子 Agent (1)"]);
    expect(
      screen
        .getAllByTestId(/^tasks-pane-row-bg-/)
        .map((el) => el.getAttribute("data-testid")),
    ).toEqual([
      "tasks-pane-row-bg-1",
      "tasks-pane-row-bg-3",
      "tasks-pane-row-bg-2",
    ]);
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

  it("treats /workflows as another name for the same tab", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [
          {
            id: "wf_1",
            type: "workflow",
            status: "running",
            startTime: 1000,
            description: "Workflow: audit-and-fix",
          },
        ],
      });
    });

    await act(async () => {
      await sendSlash("/workflows");
    });

    // 同一个承载：一个 tab、停在列表（命令没有作用对象，直达只来自工具行）。
    expect(screen.getAllByTestId("panel-tab-tasks-1")).toHaveLength(1);
    expect(visiblePane("tasks-pane")).toHaveTextContent("audit-and-fix");

    await act(async () => {
      await sendSlash("/tasks");
    });
    expect(screen.getAllByTestId("panel-tab-tasks-1")).toHaveLength(1);
    expect(screen.queryByTestId("panel-tab-tasks-2")).toBeNull();
  });

  it("marks an oversized workflow run on its task row", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", {
        tasks: [
          {
            id: "wf_big",
            type: "workflow",
            status: "running",
            startTime: 1000,
            description: "Workflow: deep-research",
          },
          {
            id: "wf_small",
            type: "workflow",
            status: "running",
            startTime: 1000,
            description: "Workflow: migrate-config",
          },
        ],
      });
      sendCommand("updateWorkflowRuns", {
        runs: [
          {
            runId: "wf_big",
            meta: { name: "deep-research", description: "深调研" },
            status: "running",
            scriptPath: "/runs/wf_big/script.js",
            startTime: 1000,
            phases: [],
            totalAgents: 26,
            totalTokens: 6_300_000,
            sizeWarning: true,
          },
          {
            runId: "wf_small",
            meta: { name: "migrate-config", description: "迁移" },
            status: "running",
            scriptPath: "/runs/wf_small/script.js",
            startTime: 1000,
            phases: [],
            totalAgents: 3,
            totalTokens: 31000,
          },
        ],
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("panel-toggle-btn"));
    });
    await act(async () => {
      await sendSlash("/tasks");
    });

    // 标记只落在越线的那个运行所在的任务行上：运行过大是「停在哪儿」的信息，
    // 而用户挑任务看的就是这些行。
    expect(screen.getAllByTestId("tasks-pane-oversized-wf_big")).toHaveLength(
      1,
    );
    expect(screen.queryByTestId("tasks-pane-oversized-wf_small")).toBeNull();
  });
});
