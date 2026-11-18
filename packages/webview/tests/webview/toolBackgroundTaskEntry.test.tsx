/**
 * 工具行尾的「后台任务」入口（spec `multi-agent/task-background-execution.md`
 * 「从工具行进入后台任务详情」、`multi-agent/workflow.md`「从 Workflow 工具行直达
 * 运行详情」）。
 *
 * 已后台化的 Bash / Agent 工具行、以及启动即返回的 Workflow 工具行，在消息流里
 * 只剩一行文本回执；行尾那颗入口把它接回后台任务面，并带上任务 id 直接停在详情
 * （桌面端 = 右侧面板 tab，插件端 / 远控页 = 对话框）。任务已不在本会话列表里时
 * 不显入口——历史消息还留着 id，点了只会落到空处。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { prunePanelGroupCache } from "../../src/components/ChatApp";
import type { BackgroundTaskSummary } from "../../src/types";
import type { Message } from "wave-agent-sdk";
import {
  createMockVscode,
  renderChatApp,
  sendCommand,
  sendHostMessage,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

const TASK_ID = "bg-1";

const task: BackgroundTaskSummary = {
  id: TASK_ID,
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  description: "long-running build",
};

/** A tool row that already handed its work to a background task, i.e. what the
 *  transcript keeps after `Ctrl-B` / the auto-background timeout / a Workflow
 *  start. `backgroundTaskId` is what the SDK writes on the tool result. */
function toolRowMessage(name: string, backgroundTaskId?: string): Message {
  return {
    id: "msg-a1",
    role: "assistant",
    timestamp: "2024-01-01T00:00:00.000Z",
    blocks: [
      {
        type: "tool",
        name,
        parameters: "{}",
        compactParams: name.toLowerCase(),
        result: "Workflow started: audit-and-fix (bg-1)",
        stage: "end",
        success: true,
        id: "tool-1",
        ...(backgroundTaskId ? { backgroundTaskId } : {}),
      },
    ],
  };
}

function renderDesktop() {
  const vscode = createMockVscode();
  const view = render(<DesktopApp vscode={vscode} />);
  sendHostMessage(
    fixtures.desktopWorkdirState({ workdir: "/work/a", recentWorkdirs: [] }),
  );
  sendHostMessage(fixtures.authStatusResponse());
  return { vscode, unmount: view.unmount };
}

const visiblePane = (testId: string) =>
  screen.getAllByTestId(testId).find((p) => {
    const stack = p.closest(".desktop-panel-stack") as HTMLElement | null;
    return stack?.style.display !== "none";
  });

beforeEach(() => {
  prunePanelGroupCache(new Set());
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
});

describe("Tool row entry: desktop right panel", () => {
  it("opens the tasks tab straight on the task the row points at", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [task] });
      sendCommand("updateMessages", {
        messages: [toolRowMessage("Workflow", TASK_ID)],
      });
    });

    const entry = await screen.findByTestId(`tool-background-task-${TASK_ID}`);
    act(() => {
      fireEvent.click(entry);
    });

    // 面板 tab，不是居中对话框，而且直接落在详情而不是列表。
    expect(visiblePane("tasks-pane")).toBeInTheDocument();
    expect(screen.queryByTestId("background-task-manager")).toBeNull();
    expect(screen.getByTestId("tasks-pane-detail")).toHaveTextContent("bg-1");
    expect(screen.queryByTestId(`tasks-pane-row-${TASK_ID}`)).toBeNull();
  });

  it("re-opens the detail when the same row is clicked again after going back", async () => {
    renderDesktop();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [task] });
      sendCommand("updateMessages", {
        messages: [toolRowMessage("Bash", TASK_ID)],
      });
    });

    const entry = await screen.findByTestId(`tool-background-task-${TASK_ID}`);
    act(() => {
      fireEvent.click(entry);
    });
    fireEvent.click(screen.getByTestId("tasks-pane-back"));
    expect(screen.queryByTestId("tasks-pane-detail")).toBeNull();

    // 同一个 id 再点一次也要生效：定位请求是按对象身份消费的，不是按 id 比较。
    act(() => {
      fireEvent.click(entry);
    });
    expect(screen.getByTestId("tasks-pane-detail")).toHaveTextContent("bg-1");
  });

  it("shows no entry once the task is gone from the session", async () => {
    renderDesktop();
    act(() => {
      // 消息来自一个已经不在本会话里（会话被 /clear、重启后读历史）的任务。
      sendCommand("updateBackgroundTasks", { tasks: [] });
      sendCommand("updateMessages", {
        messages: [toolRowMessage("Bash", "bg-gone")],
      });
    });

    expect(await screen.findByText("Bash")).toBeInTheDocument();
    expect(screen.queryByTestId("tool-background-task-bg-gone")).toBeNull();
  });
});

describe("Tool row entry: plugin host dialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.waveHostType;
    // 上面的桌面端用例把测试工具里那个模块级的分屏状态（`desktopLayoutActive`）
    // 打开了，之后每条 host 消息都会被打上 paneId 路由到某个分屏——而这里渲染的
    // 是没有分屏的 ChatApp，消息就全丢了。推一份空分屏把它关掉。
    sendHostMessage({ command: "desktopPanes", panes: [] } as never);
  });

  it("opens the tasks dialog focused on the task", async () => {
    renderChatApp();
    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [task] });
      sendCommand("updateMessages", {
        messages: [toolRowMessage("Workflow", TASK_ID)],
      });
    });

    const entry = await screen.findByTestId(`tool-background-task-${TASK_ID}`);
    act(() => {
      fireEvent.click(entry);
    });

    const dialog = screen.getByTestId("background-task-manager");
    expect(dialog).toHaveTextContent(`[${TASK_ID}] shell`);
  });
});
