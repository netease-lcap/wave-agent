import { describe, it, expect, vi } from "vitest";
import {
  renderChatApp,
  screen,
  act,
  fireEvent,
  sendCommand,
  waitFor,
} from "./test-utils";

/**
 * 头部标题就地编辑（spec ui/session-management.md「会话重命名入口：CLI 与 IDE
 * 插件」场景 8/9/10）。头部是 VSCE / JB / desktop 共用组件，三端一起获得该入口。
 */
function renderWithCurrentSession() {
  const rendered = renderChatApp();
  act(() => {
    sendCommand("updateCurrentSession", {
      session: {
        id: "s1",
        sessionType: "main",
        workdir: "/test/project",
        firstMessage: "首条用户消息",
        lastActiveAt: new Date("2026-07-22T13:46:00Z"),
        latestTotalTokens: 0,
      },
    });
  });
  return rendered;
}

const renameCalls = (vscode: { postMessage: ReturnType<typeof vi.fn> }) =>
  vscode.postMessage.mock.calls
    .map((c) => c[0] as Record<string, unknown>)
    .filter((m) => m.command === "renameSession");

/** 提交宿主回复（requestId 由请求原样带回）。 */
function replyRenamed(
  requestId: string,
  ok: boolean,
  error?: string,
  sessionId = "s1",
) {
  act(() => {
    sendCommand("sessionRenamed", {
      requestId,
      sessionId,
      title: "我的标题",
      ok,
      error,
    });
  });
}

describe("会话重命名 · 头部标题就地编辑", () => {
  it("点击标题进入就地编辑：输入框自动聚焦、初值为当前标题", async () => {
    renderWithCurrentSession();
    expect(screen.getByTestId("header-title")).toHaveTextContent(
      "首条用户消息",
    );

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });

    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    expect(input.value).toBe("首条用户消息");
    // 自动聚焦（场景 8）。
    await waitFor(() => expect(document.activeElement).toBe(input));
    // 全选：selectionStart..selectionEnd 覆盖全部内容（场景 8）。
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("首条用户消息".length);
    // 行内形态，不弹模态、不影响对话区。
    expect(screen.queryByTestId("session-list-popup")).not.toBeInTheDocument();
  });

  it("Enter 保存：先乐观更新标题，再向宿主发 renameSession", async () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "我的标题" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // 乐观更新：标题立即变（不等宿主回复）。
    expect(screen.getByTestId("header-title")).toHaveTextContent("我的标题");
    const calls = renameCalls(vscode);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: "renameSession",
      sessionId: "s1",
      title: "我的标题",
    });
    expect(typeof calls[0].requestId).toBe("string");
    expect((calls[0].requestId as string).length).toBeGreaterThan(0);
  });

  it("Enter 保存后紧跟的 blur 只提交一次（一次性闩锁）", () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "我的标题" } });
      fireEvent.keyDown(input, { key: "Enter" });
      // 浏览器在保存后随即失焦：同一次 act 内派发，走的就是闩锁那条路径（场景 9）。
      fireEvent.blur(input);
    });

    expect(renameCalls(vscode)).toHaveLength(1);
  });

  it("blur 保存标题（点击输入框之外）", () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "blur 保存" } });
    });
    act(() => {
      fireEvent.blur(input);
    });

    expect(screen.getByTestId("header-title")).toHaveTextContent("blur 保存");
    expect(renameCalls(vscode)[0]).toMatchObject({ title: "blur 保存" });
  });

  it("Esc 回滚：不发请求、退出编辑、标题不变", () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "不要这个" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("header-title")).toHaveTextContent(
      "首条用户消息",
    );
  });

  it("trim 后为空什么都不做：不发请求、标题不变", async () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
    });
    act(() => {
      fireEvent.blur(input);
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    expect(screen.getByTestId("header-title")).toHaveTextContent(
      "首条用户消息",
    );
  });

  it("输入法组合中的 Enter 不算提交", () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "中文输入中" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    });

    expect(renameCalls(vscode)).toHaveLength(0);
    // 仍处于编辑态（输入框还在）。
    expect(screen.getByTestId("header-title-input")).toBeInTheDocument();
  });

  it("按键不冒泡：编辑态按 Esc/Enter 不会触发宿主快捷键", () => {
    renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;

    // stopPropagation 的合成事件标记（宿主快捷键监听在更外层/窗口上）。
    const enter = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      input.dispatchEvent(enter);
    });

    expect(enter.defaultPrevented).toBe(true);
  });

  it("宿主回报失败：回滚原标题并给出可见提示", async () => {
    const { vscode } = renderWithCurrentSession();

    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    const input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "写盘失败" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    const requestId = renameCalls(vscode)[0].requestId as string;

    replyRenamed(requestId, false, "EACCES: permission denied");

    // 回滚为原标题，且失败必须可见（不得静默回滚）。
    await waitFor(() =>
      expect(screen.getByTestId("header-title")).toHaveTextContent(
        "首条用户消息",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("EACCES");
  });

  it("成功回复保持新标题，并清掉上一轮的失败提示", async () => {
    const { vscode } = renderWithCurrentSession();

    // 第一轮：失败 → 提示出现。
    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    let input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "第一次" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    replyRenamed(renameCalls(vscode)[0].requestId as string, false, "失败");
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    // 第二轮：成功 → 标题为新值、提示消失。
    act(() => {
      fireEvent.click(screen.getByTestId("header-title"));
    });
    input = screen.getByTestId("header-title-input") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "第二次" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    replyRenamed(renameCalls(vscode)[1].requestId as string, true);

    expect(screen.getByTestId("header-title")).toHaveTextContent("第二次");
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });

  it("消费「会话自定义标题」列表字段：宿主列表带回 customTitle 时头部显示它", () => {
    renderChatApp();

    act(() => {
      sendCommand("updateSessions", {
        sessions: [
          {
            id: "s1",
            sessionType: "main",
            workdir: "/test/project",
            firstMessage: "首条用户消息",
            customTitle: "CLI 改过的名字",
            lastActiveAt: new Date("2026-07-22T13:46:00Z"),
            latestTotalTokens: 0,
          },
        ],
      });
      sendCommand("updateCurrentSession", {
        session: {
          id: "s1",
          sessionType: "main",
          workdir: "/test/project",
          firstMessage: "首条用户消息",
          lastActiveAt: new Date("2026-07-22T13:46:00Z"),
          latestTotalTokens: 0,
        },
      });
    });

    // 显示优先级：自定义标题 > 首条消息截断（场景 3/12）。
    expect(screen.getByTestId("chat-header")).toHaveTextContent(
      "CLI 改过的名字",
    );
  });
});
