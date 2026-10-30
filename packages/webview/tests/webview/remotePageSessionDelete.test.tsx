/**
 * 远控 Web 页「会话」整页列表的**行级动作**（spec remote/remote-web.md「手机端的
 * 会话列表与删除」场景 4-11）：
 *
 * - 「⋯」→ 底部动作面板（重命名 / 删除会话），不做左右滑/长按；
 * - 重命名沿用既有的 `renameSession`（乐观更新 → requestId 关联 → 失败回滚），
 *   不新增协议；
 * - 删除是三步：⋯ → 删除会话 → 全屏确认卡片。卡片的内容按比例给全：固定一句
 *   「对话记录仍保留在这台电脑上」+ worktree 警告（同一份文案与流程）+ 会话正在
 *   回答时的红字与勾选；
 * - 删完回到列表、顶部一条「已删除」，**不**自动跳进别的会话。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
  sendHostMessage,
  within,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

const SESSIONS = [
  {
    id: "session-1",
    sessionType: "main" as const,
    workdir: "/repo/app",
    firstMessage: "给登录页加个校验",
    createdAt: new Date("2026-10-14T08:00:00Z"),
    lastActiveAt: new Date("2026-10-14T09:00:00Z"),
    latestTotalTokens: 100,
  },
  {
    id: "session-2",
    sessionType: "main" as const,
    workdir: "/repo/.wave/worktrees/feat",
    customTitle: "工作树里的会话",
    createdAt: new Date("2026-10-14T09:30:00Z"),
    lastActiveAt: new Date("2026-10-14T10:00:00Z"),
    latestTotalTokens: 200,
  },
];

/** Open the page on session-1 with whatever markers the test needs. */
function openPage(status?: {
  waiting: string[];
  running: string[];
  background?: string[];
  worktrees?: string[];
}) {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendHostMessage(
      fixtures.setInitialState({
        sessions: SESSIONS,
        session: SESSIONS[0],
        sessionStatus: status,
      }),
    );
  });
  act(() => {
    fireEvent.click(screen.getByTestId("session-switch-btn"));
  });
  return rendered;
}

/** ⋯ → 删除会话，i.e. the third step of the delete flow. */
function openDeleteConfirm(sessionId: string) {
  act(() => {
    fireEvent.click(screen.getByTestId(`remote-session-more-${sessionId}`));
  });
  act(() => {
    fireEvent.click(screen.getByTestId("remote-session-action-delete"));
  });
  return screen.getByTestId("confirm-dialog-overlay");
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page session row actions", () => {
  it("opens a bottom action sheet with 重命名 / 删除会话", () => {
    openPage();

    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-more-session-1"));
    });

    const sheet = screen.getByTestId("remote-session-actions");
    expect(
      within(sheet).getByTestId("remote-session-action-rename"),
    ).toHaveTextContent("重命名");
    expect(
      within(sheet).getByTestId("remote-session-action-delete"),
    ).toHaveTextContent("删除会话");
    // 不做左右滑删除、不做长按菜单：动作只从这一张面板进（spec 场景 4）。
    expect(
      sheet.querySelector('[data-testid="remote-session-swipe-delete"]'),
    ).toBeNull();
  });

  it("renames inline through the existing renameSession command", () => {
    const { vscode } = openPage();

    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-more-session-1"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-action-rename"));
    });

    const input = screen.getByTestId("remote-session-rename-input-session-1");
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.change(input, { target: { value: "新的标题" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "renameSession",
        sessionId: "session-1",
        title: "新的标题",
      }),
    );
    // 乐观更新：行标题立刻变（不等回执）。
    expect(
      screen.getByTestId("remote-session-row-session-1"),
    ).toHaveTextContent("新的标题");
  });

  it("rolls the inline rename back on Escape without sending anything", () => {
    const { vscode } = openPage();

    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-more-session-1"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-action-rename"));
    });

    const input = screen.getByTestId("remote-session-rename-input-session-1");
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.change(input, { target: { value: "写了一半" } });
      fireEvent.keyDown(input, { key: "Escape" });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "renameSession" }),
    );
    expect(
      screen.getByTestId("remote-session-row-session-1"),
    ).toHaveTextContent("给登录页加个校验");
  });

  it("does nothing when the inline rename is emptied", () => {
    const { vscode } = openPage();

    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-more-session-1"));
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-session-action-rename"));
    });

    const input = screen.getByTestId("remote-session-rename-input-session-1");
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.change(input, { target: { value: "   " } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "renameSession" }),
    );
    expect(
      screen.getByTestId("remote-session-row-session-1"),
    ).toHaveTextContent("给登录页加个校验");
  });
});

describe("remote page session delete", () => {
  it("shows the fixed sentence and deletes a plain session", () => {
    const { vscode } = openPage();
    const card = openDeleteConfirm("session-1");

    // ① 固定一句：删的是这台机器上正在跑的会话，不是磁盘记录。
    expect(card).toHaveTextContent(
      "对话记录仍保留在这台电脑上，可以从桌面端恢复。",
    );
    // 不是 worktree 的会话：没有工作树那段，也没有勾选。
    expect(
      within(card).queryByTestId("remote-session-delete-worktree-warning"),
    ).not.toBeInTheDocument();
    expect(
      within(card).queryByTestId("remote-session-delete-ack"),
    ).not.toBeInTheDocument();
    const confirm = within(card).getByTestId("confirm-dialog-confirm");
    expect(confirm).toHaveTextContent("删除会话");
    expect(confirm).not.toBeDisabled();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(confirm);
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "deleteSession",
        sessionId: "session-1",
        removeWorktree: false,
      }),
    );
  });

  it("checks a worktree's changes before it may be confirmed", () => {
    const { vscode } = openPage({
      waiting: [],
      running: [],
      worktrees: ["session-2"],
    });

    vscode.postMessage.mockClear();
    const card = openDeleteConfirm("session-2");

    // ② 先问改动：确认键禁用，卡片说「正在检查…」。
    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "getSessionWorktreeChanges");
    expect(asked).toMatchObject({ sessionId: "session-2" });
    expect(
      within(card).getByTestId("remote-session-delete-worktree-warning"),
    ).toHaveTextContent("正在检查该 worktree 的改动…");
    const confirm = within(card).getByTestId("confirm-dialog-confirm");
    expect(confirm).toBeDisabled();

    act(() => {
      sendHostMessage({
        command: "sessionWorktreeChanges",
        requestId: asked?.requestId as string,
        sessionId: "session-2",
        changes: { files: 2, commits: 1 },
      });
    });

    // ③ 计数回来：逐字复用桌面端那份文案，按钮改成「删除会话与工作树」。
    expect(
      within(card).getByTestId("remote-session-delete-worktree-warning"),
    ).toHaveTextContent(
      "该会话的 worktree 目录与临时分支将一并删除：2 个未提交文件、临时分支上 1 个未合并提交，删除后不可恢复。",
    );
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveTextContent("删除会话与工作树");

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(confirm);
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "deleteSession",
        sessionId: "session-2",
        removeWorktree: true,
      }),
    );
  });

  it("degrades to the generic warning when the counts cannot be read", () => {
    const { vscode } = openPage({
      waiting: [],
      running: [],
      worktrees: ["session-2"],
    });

    const card = openDeleteConfirm("session-2");
    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "getSessionWorktreeChanges");

    act(() => {
      sendHostMessage({
        command: "sessionWorktreeChanges",
        requestId: asked?.requestId as string,
        sessionId: "session-2",
        changes: null,
      });
    });

    // 未知不等于干净：降级成泛警告，但确认键照常可点（不许静默删）。
    expect(
      within(card).getByTestId("remote-session-delete-worktree-warning"),
    ).toHaveTextContent(
      "该会话的 worktree 目录与临时分支将一并删除，未提交的改动将丢失。",
    );
    expect(
      within(card).getByTestId("confirm-dialog-confirm"),
    ).not.toBeDisabled();
  });

  it("keeps a clean worktree silent but still deletes it with the session", () => {
    const { vscode } = openPage({
      waiting: [],
      running: [],
      worktrees: ["session-2"],
    });

    const card = openDeleteConfirm("session-2");
    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "getSessionWorktreeChanges");

    act(() => {
      sendHostMessage({
        command: "sessionWorktreeChanges",
        requestId: asked?.requestId as string,
        sessionId: "session-2",
        changes: { files: 0, commits: 0 },
      });
    });

    // 干净工作树按同一份文案的既有规则不显示警告，但按钮仍是「与工作树」。
    expect(
      within(card).getByTestId("remote-session-delete-worktree-warning"),
    ).toHaveTextContent("");
    expect(
      within(card).getByTestId("confirm-dialog-confirm"),
    ).toHaveTextContent("删除会话与工作树");
  });

  it("requires an acknowledgement before deleting a session that is still answering", () => {
    const { vscode } = openPage({
      waiting: [],
      running: ["session-1"],
      background: ["session-1"],
    });

    const card = openDeleteConfirm("session-1");

    // ③ 正在回答：红字 + 必须勾选。
    expect(
      within(card).getByTestId("remote-session-delete-running-warning"),
    ).toHaveTextContent("会终止这条会话正在进行的回答");
    const confirm = within(card).getByTestId("confirm-dialog-confirm");
    expect(confirm).toBeDisabled();

    act(() => {
      fireEvent.click(within(card).getByTestId("remote-session-delete-ack"));
    });

    expect(confirm).not.toBeDisabled();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(confirm);
    });
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "deleteSession",
        sessionId: "session-1",
      }),
    );
  });

  it("stays on the list with 已删除 after a successful delete", () => {
    const { vscode } = openPage();

    const card = openDeleteConfirm("session-1");
    vscode.postMessage.mockClear();
    let requestId = "";
    act(() => {
      fireEvent.click(within(card).getByTestId("confirm-dialog-confirm"));
    });
    requestId = (vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "deleteSession")?.requestId ??
      "") as string;

    act(() => {
      sendHostMessage({
        command: "sessionDeleted",
        requestId,
        sessionId: "session-1",
        ok: true,
        worktreeRemoved: false,
      });
    });

    // 回到列表 + 顶部一条「已删除」，且不自动跳进别的会话（没有 restoreSession）。
    expect(screen.getByTestId("remote-session-page")).toBeInTheDocument();
    expect(
      screen.getByTestId("remote-session-deleted-banner"),
    ).toHaveTextContent("已删除");
    expect(
      screen.queryByTestId("confirm-dialog-overlay"),
    ).not.toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "restoreSession" }),
    );
  });

  it("says so when the session went but its worktree did not", () => {
    const { vscode } = openPage({
      waiting: [],
      running: [],
      worktrees: ["session-2"],
    });

    const card = openDeleteConfirm("session-2");
    const asked = vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "getSessionWorktreeChanges");
    act(() => {
      sendHostMessage({
        command: "sessionWorktreeChanges",
        requestId: asked?.requestId as string,
        sessionId: "session-2",
        changes: { files: 0, commits: 0 },
      });
    });

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(within(card).getByTestId("confirm-dialog-confirm"));
    });
    const requestId = (vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "deleteSession")?.requestId ??
      "") as string;

    act(() => {
      sendHostMessage({
        command: "sessionDeleted",
        requestId,
        sessionId: "session-2",
        ok: true,
        worktreeRemoved: false,
      });
    });

    // 「删了一半」既不是彻底成功也不是彻底失败：会话删了，工作树没删，说清楚。
    expect(
      screen.getByTestId("remote-session-deleted-banner"),
    ).toHaveTextContent("工作树没跟着删掉");
  });

  it("keeps the card open with the error when the delete is refused", () => {
    const { vscode } = openPage();

    const card = openDeleteConfirm("session-1");
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(within(card).getByTestId("confirm-dialog-confirm"));
    });
    const requestId = (vscode.postMessage.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .find((message) => message.command === "deleteSession")?.requestId ??
      "") as string;

    act(() => {
      sendHostMessage({
        command: "sessionDeleted",
        requestId,
        sessionId: "session-1",
        ok: false,
        error: "Session not found",
      });
    });

    // 不静默关卡片：错误留在卡上、确认键重新可点（可以让用户重试或取消）。
    expect(screen.getByTestId("remote-session-delete-error")).toHaveTextContent(
      "Session not found",
    );
    expect(
      within(card).getByTestId("confirm-dialog-confirm"),
    ).not.toBeDisabled();
    expect(screen.queryByTestId("remote-session-deleted-banner")).toBeNull();
  });
});
