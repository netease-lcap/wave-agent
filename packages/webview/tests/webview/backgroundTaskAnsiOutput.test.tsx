import { describe, it, expect } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  fireEvent,
  sendCommand,
} from "./test-utils";
import type { BackgroundTaskSummary } from "../../src/types";

const runningTask: BackgroundTaskSummary = {
  id: "bg-ansi",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  description: "colored build log",
};

function openTaskDetail() {
  act(() => {
    sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
  });
  act(() => {
    sendCommand("showDialog", { dialogType: "tasks" });
  });
  fireEvent.click(screen.getByText("[bg-ansi] shell"));
}

function answerOutput(stdout: string) {
  act(() => {
    sendCommand("backgroundTaskOutput", {
      taskId: "bg-ansi",
      output: { stdout, stderr: "", status: "running", type: "shell" },
    });
  });
}

/**
 * 后台任务面板读的是原始日志（SDK 不再剥 ANSI，见 specs/core/bash-tools.md
 * 「ANSI 颜色代码」），所以它必须自己把转义序列渲染成颜色——否则用户看到的
 * 是一整屏 `ESC[32m`。
 */
describe("Background task detail renders terminal colors", () => {
  it("renders SGR colors from the stdout tail", () => {
    renderChatApp();
    openTaskDetail();
    answerOutput("\u001b[32m+ built\u001b[0m\n\u001b[31m- failed\u001b[0m\n");

    const green = screen.getByText("+ built");
    expect(green.className).toContain("ansi-fg-green");
    const red = screen.getByText("- failed");
    expect(red.className).toContain("ansi-fg-red");
    // 转义序列本身不能作为可见字符留在页面上。
    expect(document.body.textContent).not.toContain("\u001b");
  });

  it("leaves uncolored output as plain text", () => {
    renderChatApp();
    openTaskDetail();
    answerOutput("total 8\nsrc\n");

    expect(document.querySelector("[class*='ansi-']")).toBeNull();
    expect(screen.getByText(/total 8/)).toBeTruthy();
  });

  it("drops non-SGR control sequences (cursor / erase)", () => {
    renderChatApp();
    openTaskDetail();
    answerOutput("progress\u001b[2K\u001b[1Gdone\n");

    expect(document.body.textContent).toContain("progressdone");
    expect(document.body.textContent).not.toContain("\u001b");
  });
});
