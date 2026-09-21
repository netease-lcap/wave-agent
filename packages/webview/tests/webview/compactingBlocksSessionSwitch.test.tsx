import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  screen,
  fireEvent,
  act,
  sendCommand,
  fireInput,
} from "./test-utils";

/**
 * spec message-compact.md「压缩期间的会话保护（切换禁用 + SDK 写入兜底）」场景
 * 1/2/3：压缩进行中（isCompacting）时，「历史对话」选择与「新建对话 / `/clear`」
 * 被忽略、「新建对话」按钮禁用 —— 与 streaming/后台任务共用同一守卫位。压缩中
 * 原地切走/清空会让压缩摘要块写进切换后的会话（PM 缺陷 3478352534577408）。
 * 仅 IDE（VSCE/JB）端语义，桌面端并行会话模型不受影响。
 */

function setCompacting(isCompacting: boolean) {
  act(() => {
    sendCommand("compactionStateChange", { isCompacting });
  });
}

describe("Compaction blocks in-place session switches (IDE)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("disables the new-session button while compacting and recovers afterwards", () => {
    renderChatApp();
    const newSessionBtn = screen.getByTestId("new-session-btn");
    expect(newSessionBtn).not.toBeDisabled();

    setCompacting(true);
    expect(newSessionBtn).toBeDisabled();

    // Compaction ends → the guard lifts even though nothing else changed
    setCompacting(false);
    expect(newSessionBtn).not.toBeDisabled();
  });

  it("ignores new-session clicks while compacting and sends clearChat once it ends", () => {
    const { vscode } = renderChatApp();
    const newSessionBtn = screen.getByTestId("new-session-btn");

    setCompacting(true);
    vscode.postMessage.mockClear();

    act(() => {
      fireEvent.click(newSessionBtn);
    });
    const sent = vscode.postMessage.mock.calls.map((c) => c[0]);
    expect(
      sent.filter((m: Record<string, unknown>) => m.command === "clearChat"),
    ).toHaveLength(0);

    setCompacting(false);
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(newSessionBtn);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "clearChat" }),
    );
  });

  it("ignores the /clear slash command while compacting", async () => {
    const { vscode } = renderChatApp();

    setCompacting(true);
    vscode.postMessage.mockClear();

    // fireInput 必须真实派发：textContent 只改 DOM，不更新受控输入状态，
    // 空消息下发送按钮本就禁用——守卫会变成不可检验的死代码（假绿）
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

  it("ignores history session selection while compacting", () => {
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

    setCompacting(true);
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

  it("allows history session selection once compaction has ended", () => {
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

    // A finished compaction must not block (false → guard lifted)
    setCompacting(true);
    setCompacting(false);
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
