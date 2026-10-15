/**
 * 远控页「新建对话」弹窗（spec remote-control.md「Web 端也能发起新会话」）。
 *
 * 顶栏图标重绑后的完整链路都在页面侧闭环：最近目录/浏览 → newSessionListDirs /
 * newSessionListBranches → newSessionCreate（shim 转中继 listDirectories /
 * listGitBranches / initialize）。这里钉住组件层的契约：
 *
 * - 请求全部带 requestId，回执按 requestId 匹配（陈旧回执不得落 UI）；
 * - 分支/worktree 控件只在 listGitBranches 成功时出现（判据是回执本身，不是
 *   猜目录形状）；
 * - 创建成功 → 弹窗关闭（shim 已切到新会话并拉快照）；失败 → 错误落进弹窗，
 *   视图留在当前会话。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  fireEvent,
  renderChatApp,
  screen,
  sendCommand,
  within,
} from "./test-utils";

/** renderChatApp 回传的 vscode 是 vi.fn 替身（比 src 的 VsCodeApi 多 .mock）。 */
type MockVscode = ReturnType<typeof renderChatApp>["vscode"];

const SESSIONS = [
  {
    id: "session-1",
    sessionType: "main" as const,
    workdir: "/repo",
    firstMessage: "仓库里的会话",
    createdAt: new Date("2026-10-14T08:00:00Z"),
    lastActiveAt: new Date("2026-10-14T09:00:00Z"),
    latestTotalTokens: 100,
  },
  {
    id: "session-2",
    sessionType: "main" as const,
    workdir: "/repo",
    customTitle: "同仓库第二个",
    createdAt: new Date("2026-10-14T09:30:00Z"),
    lastActiveAt: new Date("2026-10-14T10:00:00Z"),
    latestTotalTokens: 200,
  },
  {
    id: "session-3",
    sessionType: "main" as const,
    workdir: "/tmp/other",
    firstMessage: "另一个项目",
    createdAt: new Date("2026-10-14T07:00:00Z"),
    lastActiveAt: new Date("2026-10-14T08:30:00Z"),
    latestTotalTokens: 50,
  },
];

function sentCommand(
  vscode: MockVscode,
  command: string,
): Record<string, unknown> {
  const call = vscode.postMessage.mock.calls.find(
    ([payload]) => (payload as Record<string, unknown>).command === command,
  );
  return call?.[0] as Record<string, unknown>;
}

/** The LAST call of a command — repeated requests (browser navigation) supersedes. */
function sentLastCommand(
  vscode: MockVscode,
  command: string,
): Record<string, unknown> {
  const calls = vscode.postMessage.mock.calls.filter(
    ([payload]) => (payload as Record<string, unknown>).command === command,
  );
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

function openDialog(vscode: MockVscode) {
  act(() => {
    fireEvent.click(screen.getByTestId("new-session-btn"));
  });
  expect(screen.getByTestId("remote-new-session-dialog")).toBeInTheDocument();
  return vscode;
}

function renderRemotePage() {
  window.waveRemotePage = true;
  const rendered = renderChatApp();
  act(() => {
    sendCommand("updateSessions", { sessions: SESSIONS });
    sendCommand("updateCurrentSession", { session: SESSIONS[1] });
  });
  return rendered;
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page new-session dialog", () => {
  it("opens from the header button and lists deduplicated recent workdirs", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);

    const recents = screen.getByTestId("remote-new-session-recents");
    // /repo 出现两次，只列一次；顺序沿用会话列表的最近活跃序。条目是
    // desktop 同款两行式（basename + 父路径），完整路径在 title 上。
    const items = within(recents).getAllByTestId(
      "remote-new-session-recent-item",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("title", "/repo");
    expect(items[1]).toHaveAttribute("title", "/tmp/other");
  });

  it("fetches branches when a recent dir is picked and shows worktree controls", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);

    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-new-session-recents")).getAllByTestId(
          "remote-new-session-recent-item",
        )[0],
      );
    });

    const branchesReq = sentCommand(vscode, "newSessionListBranches");
    expect(branchesReq.workdir).toBe("/repo");
    expect(branchesReq.requestId).toBeTruthy();

    act(() => {
      sendCommand("newSessionBranches", {
        requestId: branchesReq.requestId,
        result: ["main", "dev"],
      });
    });

    const select = screen.getByTestId(
      "remote-new-session-branch-select",
    ) as HTMLSelectElement;
    expect(select.value).toBe("main");

    // worktree off by default: create sends a plain initialize shape.
    expect(
      screen.queryByTestId("remote-new-session-worktree-name"),
    ).not.toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    expect(sentCommand(vscode, "newSessionCreate")).toMatchObject({
      workdir: "/repo",
      useWorktree: false,
      baseBranch: undefined,
      name: undefined,
    });
  });

  it("creates a worktree session with the picked base branch and name", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);
    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-new-session-recents")).getAllByTestId(
          "remote-new-session-recent-item",
        )[0],
      );
    });
    const branchesReq = sentCommand(vscode, "newSessionListBranches");
    act(() => {
      sendCommand("newSessionBranches", {
        requestId: branchesReq.requestId,
        result: ["main", "dev"],
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-worktree-check"));
    });
    fireEvent.change(screen.getByTestId("remote-new-session-worktree-name"), {
      target: { value: "spike" },
    });
    fireEvent.change(screen.getByTestId("remote-new-session-branch-select"), {
      target: { value: "dev" },
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });

    expect(sentCommand(vscode, "newSessionCreate")).toMatchObject({
      workdir: "/repo",
      useWorktree: true,
      baseBranch: "dev",
      name: "spike",
    });
  });

  it("skips branch controls when the dir is not a git repo but stays creatable", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);
    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-new-session-recents")).getAllByTestId(
          "remote-new-session-recent-item",
        )[1],
      );
    });
    const branchesReq = sentCommand(vscode, "newSessionListBranches");
    act(() => {
      sendCommand("newSessionBranches", {
        requestId: branchesReq.requestId,
        result: null,
        error: "not a git repository",
      });
    });

    expect(
      screen.queryByTestId("remote-new-session-branch-select"),
    ).not.toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    expect(sentCommand(vscode, "newSessionCreate")).toMatchObject({
      workdir: "/tmp/other",
      useWorktree: false,
    });
  });

  it("browses directories through the shared browser panel and picks one", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);

    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-browse"));
    });

    const dirsReq = sentCommand(vscode, "newSessionListDirs");
    expect(dirsReq.dir).toBe("~");
    expect(dirsReq.requestId).toBeTruthy();

    act(() => {
      sendCommand("newSessionDirs", {
        requestId: dirsReq.requestId,
        resolvedPath: "/home/alice",
        dirs: ["code", "docs"],
      });
    });
    const browser = screen.getByTestId("desktop-remote-browser");
    expect(
      within(browser)
        .getAllByTestId("desktop-remote-browser-item")
        .map((i) => i.textContent),
    ).toEqual(["code", "docs"]);

    // Enter a subdir, then 选择此目录 — the dialog flips to the confirm step.
    act(() => {
      fireEvent.click(
        within(browser).getAllByTestId("desktop-remote-browser-item")[0],
      );
    });
    const navReq = sentLastCommand(vscode, "newSessionListDirs");
    act(() => {
      sendCommand("newSessionDirs", {
        requestId: navReq.requestId,
        resolvedPath: "/home/alice/code",
        dirs: ["app"],
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("desktop-remote-browser-select"));
    });

    expect(screen.getByTestId("remote-new-session-workdir")).toHaveTextContent(
      "/home/alice/code",
    );
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    expect(sentCommand(vscode, "newSessionCreate").workdir).toBe(
      "/home/alice/code",
    );
  });

  it("closes on the created reply and drops a stale one", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);
    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-new-session-recents")).getAllByTestId(
          "remote-new-session-recent-item",
        )[0],
      );
    });
    act(() => {
      sendCommand("newSessionBranches", {
        requestId: sentCommand(vscode, "newSessionListBranches").requestId,
        result: ["main"],
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    const createReq = sentCommand(vscode, "newSessionCreate");

    // 陈旧回执（不匹配在途 requestId）：不得关弹窗。
    act(() => {
      sendCommand("newSessionCreated", {
        requestId: "remote-new-session-999",
        sessionId: "s-elsewhere",
      });
    });
    expect(screen.getByTestId("remote-new-session-dialog")).toBeInTheDocument();

    act(() => {
      sendCommand("newSessionCreated", {
        requestId: createReq.requestId,
        sessionId: "s-new",
      });
    });
    expect(
      screen.queryByTestId("remote-new-session-dialog"),
    ).not.toBeInTheDocument();
  });

  it("keeps the dialog open with a visible error on a failed create", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);
    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-new-session-recents")).getAllByTestId(
          "remote-new-session-recent-item",
        )[0],
      );
    });
    act(() => {
      sendCommand("newSessionBranches", {
        requestId: sentCommand(vscode, "newSessionListBranches").requestId,
        result: ["main"],
      });
    });
    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    const createReq = sentCommand(vscode, "newSessionCreate");

    act(() => {
      sendCommand("newSessionCreateFailed", {
        requestId: createReq.requestId,
        error: "目录不存在或不可读：/repo",
      });
    });

    expect(screen.getByTestId("remote-new-session-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("remote-new-session-error")).toHaveTextContent(
      "目录不存在或不可读：/repo",
    );
  });
});
