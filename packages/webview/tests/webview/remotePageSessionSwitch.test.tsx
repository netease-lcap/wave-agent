/**
 * The phone page is the shared webview plus a browser shim, so its header
 * differences are the only thing the shared UI has to know about it:
 *
 * - no 「历史对话」 — a disk-history list is not something the serving process
 *   can act on; one 「会话」 entry instead, which opens the **full-page** list of
 *   the sessions that process is running right now (spec remote/remote-web.md
 *   「手机端的会话列表与删除」). Switching still only moves this page's own view
 *   (spec「Web 页作为第五种宿主」场景 10);
 * - 「新建对话」 stays ( rebound to the remote new-session flow, spec
 *   remote/remote-web.md「Web 端也能发起新会话」).
 *
 * The other four hosts keep the borrowed dropdown untouched — that is asserted
 * here too, because "make the phone's list a page" must not become "change the
 * list everywhere".
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
  sendCommand,
  sendHostMessage,
  within,
} from "./test-utils";
import { fixtures } from "wave-webview-fixtures";

const SESSIONS = [
  {
    id: "session-1",
    sessionType: "main" as const,
    workdir: "/tmp/other",
    firstMessage: "另一个项目的会话",
    createdAt: new Date("2026-10-14T08:00:00Z"),
    lastActiveAt: new Date("2026-10-14T09:00:00Z"),
    latestTotalTokens: 100,
  },
  {
    id: "session-2",
    sessionType: "main" as const,
    workdir: "/repo",
    customTitle: "登录页",
    createdAt: new Date("2026-10-14T09:30:00Z"),
    lastActiveAt: new Date("2026-10-14T10:00:00Z"),
    latestTotalTokens: 200,
  },
];

function renderRemotePage() {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendCommand("updateSessions", { sessions: SESSIONS });
    sendCommand("updateCurrentSession", { session: SESSIONS[1] });
  });
  return rendered;
}

/** Open the full-page list from the header's 「会话」 entry. */
function openSessionPage() {
  act(() => {
    fireEvent.click(screen.getByTestId("session-switch-btn"));
  });
  return screen.getByTestId("remote-session-page");
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page session list", () => {
  it("keeps 新建对话 (rebound) and the session entry, drops 历史对话", () => {
    renderRemotePage();

    expect(screen.getByTestId("session-switch-btn")).toBeInTheDocument();
    expect(screen.getByTestId("new-session-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("history-btn")).not.toBeInTheDocument();
  });

  it("keeps both history buttons in every other host", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateSessions", { sessions: SESSIONS });
    });

    expect(screen.getByTestId("history-btn")).toBeInTheDocument();
    expect(screen.getByTestId("new-session-btn")).toBeInTheDocument();
    expect(screen.queryByTestId("session-switch-btn")).not.toBeInTheDocument();
  });

  it("opens a full page — 返回 + 会话, a search box, no borrowed dropdown", () => {
    renderRemotePage();
    const page = openSessionPage();

    expect(within(page).getByTestId("remote-session-page-back")).toBeVisible();
    expect(within(page).getByText("会话")).toBeInTheDocument();
    expect(
      within(page).getByTestId("remote-session-page-search"),
    ).toBeVisible();
    // The dropdown the plugin hosts use is not what the phone shows any more.
    expect(screen.queryByTestId("session-list-popup")).not.toBeInTheDocument();
  });

  it("keeps the plugin hosts on the borrowed dropdown", () => {
    renderChatApp();
    act(() => {
      sendCommand("updateSessions", { sessions: SESSIONS });
      fireEvent.click(screen.getByTestId("history-btn"));
    });

    expect(screen.getByTestId("session-list-popup")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-session-page")).not.toBeInTheDocument();
  });

  it("shows each row's project and last-active time", () => {
    renderRemotePage();
    const page = openSessionPage();

    const row = within(page).getByTestId("remote-session-row-session-1");
    expect(row).toHaveTextContent("另一个项目的会话");
    // 第二行 = 「项目目录名 · 最近活跃时间」——目录名而不是完整路径。
    expect(row).toHaveTextContent("other");
    expect(row).not.toHaveTextContent("/tmp/other");
    // 重命名过的那条用自定义标题（与其余四端同一个 formatSessionLabel）。
    expect(
      within(page).getByTestId("remote-session-row-session-2"),
    ).toHaveTextContent("登录页");
  });

  it("filters rows by title, case-insensitively", () => {
    renderRemotePage();
    const page = openSessionPage();

    act(() => {
      fireEvent.change(within(page).getByTestId("remote-session-page-search"), {
        target: { value: "登录" },
      });
    });

    expect(
      within(page).queryByTestId("remote-session-row-session-1"),
    ).not.toBeInTheDocument();
    expect(
      within(page).getByTestId("remote-session-row-session-2"),
    ).toBeInTheDocument();
  });

  it("switches on row click and returns to the conversation", () => {
    const { vscode } = renderRemotePage();
    const page = openSessionPage();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(
        within(page).getByTestId("remote-session-row-select-session-1"),
      );
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreSession",
        sessionId: "session-1",
      }),
    );
    // 点一行 = 切会话 + 自动返回对话页（spec 场景 3）。
    expect(screen.queryByTestId("remote-session-page")).not.toBeInTheDocument();
  });

  it("opens the row menu without switching", () => {
    const { vscode } = renderRemotePage();
    const page = openSessionPage();

    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(
        within(page).getByTestId("remote-session-more-session-1"),
      );
    });

    // 「⋯」有自己的可点区：只开面板，不切会话（spec 场景 3）。
    expect(screen.getByTestId("remote-session-actions")).toBeInTheDocument();
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "restoreSession" }),
    );
    expect(screen.getByTestId("remote-session-page")).toBeInTheDocument();
  });

  it("returns from the page without switching anything", () => {
    renderRemotePage();
    const page = openSessionPage();

    act(() => {
      fireEvent.click(within(page).getByTestId("remote-session-page-back"));
    });

    expect(screen.queryByTestId("remote-session-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-header")).toBeInTheDocument();
  });

  it("follows the shim's switched snapshot without a session-switch command", () => {
    // The switch is answered **locally** on the page: the shim re-points its own
    // sessionId and re-pulls, so what the UI sees is a plain cold-start snapshot
    // for another conversation — same message, no restoreSession round trip.
    renderRemotePage();

    act(() => {
      sendHostMessage(
        fixtures.setInitialState({
          messages: [],
          sessions: SESSIONS,
          session: SESSIONS[0],
        }),
      );
    });

    expect(screen.getByTestId("chat-header")).toHaveTextContent(
      "另一个项目的会话",
    );
  });

  /**
   * 忙时选会话**必须真的发得出去**（spec remote/remote-web.md「Web 页作为第五种宿主」
   * 场景 10 与「Web 端也能发起新会话」场景 10）：页面上这次「恢复」只改自己这份
   * `sessionId` 与视图，电脑侧那条会话照旧跑着——被静默忽略就是「点了没反应」，
   * 正是同一份 spec 禁止的形态。插件端的原地守卫不受影响（见
   * backgroundTaskBlocksSessionSwitch / compactingBlocksSessionSwitch）。
   */
  it("switches conversations while the watched session is generating, compacting or running a background task", () => {
    const { vscode } = renderRemotePage();

    act(() => {
      sendCommand("startStreaming");
      sendCommand("updateBackgroundTasks", {
        tasks: [
          {
            id: "bg-shell-1",
            type: "shell",
            status: "running",
            startTime: 1000,
            command: "sleep 300",
          },
        ],
      });
      sendCommand("compactionStateChange", { isCompacting: true });
    });

    const page = openSessionPage();
    vscode.postMessage.mockClear();
    act(() => {
      fireEvent.click(
        within(page).getByTestId("remote-session-row-select-session-1"),
      );
    });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "restoreSession",
        sessionId: "session-1",
      }),
    );
  });
});
