import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

/**
 * spec session-management.md「IDE 插件聊天头部」场景 6/7：当前会话存在正在运行
 * 的后台任务（shell 后台终端工具 / subagent 后台子代理 / workflow，status=running）
 * 时，"新建对话"按钮禁用、`/clear` 与历史会话选择被忽略 —— 防止原地清空/替换
 * 会话把正在跑的任务中断或与 UI 脱离。仅 IDE（VSCE/JB）端语义，桌面端并行会话
 * 模型不受影响。
 */

const runningShellTask: BackgroundTaskSummary = {
  id: "bg-shell-1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "sleep 300",
  description: "long-running build",
};

const runningSubagentTask: BackgroundTaskSummary = {
  id: "bg-subagent-1",
  type: "subagent",
  status: "running",
  startTime: 1000,
  description: "background subagent exploration",
};

const completedTask: BackgroundTaskSummary = {
  id: "bg-done-1",
  type: "shell",
  status: "completed",
  startTime: 1000,
  endTime: 2000,
  command: "echo done",
  exitCode: 0,
};

function pushBackgroundTasks(tasks: BackgroundTaskSummary[]) {
  act(() => {
    sendCommand("updateBackgroundTasks", { tasks });
  });
}

describe("Background tasks block in-place session switches (IDE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables the new-session button while a background shell/subagent is running", () => {
    renderChatApp();
    const newSessionBtn = screen.getByTestId("new-session-btn");
    expect(newSessionBtn).not.toBeDisabled();

    pushBackgroundTasks([runningShellTask]);
    expect(newSessionBtn).toBeDisabled();

    // Task ends → button recovers even if the list still holds the (completed) entry
    pushBackgroundTasks([{ ...runningShellTask, status: "completed" }]);
    expect(newSessionBtn).not.toBeDisabled();

    // A background subagent in flight blocks it again
    pushBackgroundTasks([runningSubagentTask]);
    expect(newSessionBtn).toBeDisabled();

    // Removed from the list → recovered
    pushBackgroundTasks([]);
    expect(newSessionBtn).not.toBeDisabled();
  });

  it("ignores new-session clicks while a background task runs and sends clearChat once it ends", () => {
    const { vscode } = renderChatApp();
    const newSessionBtn = screen.getByTestId("new-session-btn");

    pushBackgroundTasks([runningShellTask]);
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(newSessionBtn);
    });
    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(
      sent.filter((m: Record<string, unknown>) => m.command === "clearChat"),
    ).toHaveLength(0);

    // Completed tasks in the list no longer block → clearChat goes through
    pushBackgroundTasks([{ ...runningShellTask, status: "killed" }]);
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(newSessionBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "clearChat" }),
    );
  });

  it("ignores the /clear slash command while a background task runs", async () => {
    const { vscode } = renderChatApp();

    pushBackgroundTasks([runningShellTask]);
    vscode.postMessage.mockClear();

    const input = screen.getByTestId("message-input");
    act(() => {
      input.textContent = "/clear";
    });
    await fireInput(input, { data: "/clear", inputType: "insertText" });
    act(() => {
      fireEvent.click(screen.getByTestId("send-btn"));
    });

    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(
      sent.filter((m: Record<string, unknown>) => m.command === "clearChat"),
    ).toHaveLength(0);
    expect(
      sent.filter((m: Record<string, unknown>) => m.command === "sendMessage"),
    ).toHaveLength(0);
  });

  it("ignores history session selection while a background task runs", () => {
    const { vscode } = renderChatApp();

    const sessions = [
      {
        id: "session-1",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "First session hello",
        lastActiveAt: new Date("2023-12-01T10:00:00Z"),
        latestTotalTokens: 150,
      },
      {
        id: "session-2",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "Second session world",
        lastActiveAt: new Date("2023-12-01T11:00:00Z"),
        latestTotalTokens: 250,
      },
    ];
    act(() => {
      sendCommand("updateSessions", { sessions });
    });

    pushBackgroundTasks([runningSubagentTask]);
    vscode.postMessage.mockClear();

    // Open popup and try to select another session
    act(() => {
      fireEvent.click(screen.getByTestId("history-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-session-2"));
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "restoreSession" }),
    );
    // SessionListPopup always closes after a click (SessionListPopup.tsx 选择后
    // 调 onClose) —— guard 仅拦截加载本身，会话不被替换
    expect(screen.queryByTestId("session-list-popup")).not.toBeInTheDocument();
  });

  it("allows history session selection once no background task is running", () => {
    const { vscode } = renderChatApp();

    const sessions = [
      {
        id: "session-1",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "First session hello",
        lastActiveAt: new Date("2023-12-01T10:00:00Z"),
        latestTotalTokens: 150,
      },
    ];
    act(() => {
      sendCommand("updateSessions", { sessions });
    });

    // Only a completed task present → not blocking
    pushBackgroundTasks([completedTask]);
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(screen.getByTestId("history-btn"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("session-list-item-session-1"));
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreSession",
        sessionId: "session-1",
      }),
    );
  });
});
