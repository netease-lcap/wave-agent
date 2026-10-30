/**
 * 远控页「新建对话」弹窗（spec remote/remote-web.md「Web 端也能发起新会话」）。
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
import type { BackgroundTaskSummary } from "../../src/types";

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
  // 建在 worktree 里的会话：`workdir` 是工作树路径，`repoRoot` 是它挂靠的仓库
  // （daemon 的 `listDaemonSessions` 按 createdWorkdir 推导后随行下发）。
  {
    id: "session-4",
    sessionType: "main" as const,
    workdir: "/repo/.wave/worktrees/spike",
    repoRoot: "/repo",
    firstMessage: "worktree 里的会话",
    createdAt: new Date("2026-10-14T06:00:00Z"),
    lastActiveAt: new Date("2026-10-14T07:30:00Z"),
    latestTotalTokens: 10,
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
    // 第四条会话建在 /repo 的 worktree 里，按 repoRoot 归并进 /repo——最近目录
    // 只列仓库根，工作树路径不出现（桌面端最近目录同口径）。
    const items = within(recents).getAllByTestId(
      "remote-new-session-recent-item",
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute("title", "/repo");
    expect(items[1]).toHaveAttribute("title", "/tmp/other");
  });

  it("asks the machine for its recent workdirs and appends them after the live ones", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);

    // 会话列表只是「活会话碰过的目录」的投影；机器侧那份（spec
    // core/recent-workdirs.md）才是持久的，且没有会话也照样有内容。开弹窗
    // 就问一次，且这条请求不挂 sessionId（机器没有会话时也得答）。
    const request = sentLastCommand(vscode, "getRecentWorkdirs");
    expect(request.requestId).toEqual(expect.any(String));
    expect(request.sessionId).toBeUndefined();

    act(() => {
      sendCommand("recentWorkdirsResponse", {
        requestId: request.requestId,
        dirs: ["/tmp/other", "/archive/old"],
      });
    });

    // /tmp/other 与活会话推出来的重复，只算一次且留在原位；机器独有的目录
    // 按机器给的顺序排在其后。
    const items = within(
      screen.getByTestId("remote-new-session-recents"),
    ).getAllByTestId("remote-new-session-recent-item");
    expect(items.map((item) => item.getAttribute("title"))).toEqual([
      "/repo",
      "/tmp/other",
      "/archive/old",
    ]);
  });

  it("drops a recent-workdirs reply that belongs to an earlier request", () => {
    const { vscode } = renderRemotePage();
    openDialog(vscode);

    act(() => {
      sendCommand("recentWorkdirsResponse", {
        requestId: "not-the-one-asked",
        dirs: ["/stale"],
      });
    });

    const items = within(
      screen.getByTestId("remote-new-session-recents"),
    ).getAllByTestId("remote-new-session-recent-item");
    expect(items.map((item) => item.getAttribute("title"))).toEqual([
      "/repo",
      "/tmp/other",
    ]);
    // 顺手确认这条回执确实没被当成「没问过也一样」的广播吞掉——它带了
    // requestId，就该按 requestId 认领。
    expect(sentLastCommand(vscode, "getRecentWorkdirs").requestId).not.toBe(
      "not-the-one-asked",
    );
  });

  it("lists the machine's workdirs even after every session is gone", () => {
    const { vscode } = renderRemotePage();
    // 会话一条不剩：列表推不出任何目录，弹窗只剩机器那份。
    act(() => {
      sendCommand("updateSessions", { sessions: [] });
    });
    openDialog(vscode);

    const request = sentLastCommand(vscode, "getRecentWorkdirs");
    act(() => {
      sendCommand("recentWorkdirsResponse", {
        requestId: request.requestId,
        dirs: ["/archive/old", "/gone/repo"],
      });
    });

    const items = within(
      screen.getByTestId("remote-new-session-recents"),
    ).getAllByTestId("remote-new-session-recent-item");
    expect(items.map((item) => item.getAttribute("title"))).toEqual([
      "/archive/old",
      "/gone/repo",
    ]);
  });

  it("fetches branches when a recent dir is picked and defaults to the current branch", () => {
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

    // 宿主 `listGitBranches` 的回执是一对 {branches, current}（桌面端
    // `desktopGitBranches` 同一份），不是裸的分支名数组。
    act(() => {
      sendCommand("newSessionBranches", {
        requestId: branchesReq.requestId,
        result: { branches: ["dev", "main"], current: "main" },
      });
    });

    const select = screen.getByTestId(
      "remote-new-session-branch-select",
    ) as HTMLSelectElement;
    // 基准分支默认 = 该目录的当前分支（不是列表第一项）。
    expect(select.value).toBe("main");

    // 与桌面端新建会话页同一条默认：worktree 开关默认勾选，名称输入随之出现。
    expect(
      screen.getByTestId("remote-new-session-worktree-check"),
    ).toBeChecked();
    expect(
      screen.getByTestId("remote-new-session-worktree-name"),
    ).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-create"));
    });
    expect(sentCommand(vscode, "newSessionCreate")).toMatchObject({
      workdir: "/repo",
      useWorktree: true,
      baseBranch: "main",
      name: undefined,
    });
  });

  it("falls back to the first branch when the repo has no current branch", () => {
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
        // detached HEAD：宿主回 current = null。
        result: { branches: ["main", "dev"], current: null },
      });
    });

    expect(
      (
        screen.getByTestId(
          "remote-new-session-branch-select",
        ) as HTMLSelectElement
      ).value,
    ).toBe("main");
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
        result: { branches: ["main", "dev"], current: "main" },
      });
    });

    // worktree 默认勾选，这里只需换分支 + 起名。
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

  it("creates without a worktree when the toggle is switched off", () => {
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
        result: { branches: ["main"], current: "main" },
      });
    });

    act(() => {
      fireEvent.click(screen.getByTestId("remote-new-session-worktree-check"));
    });
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
        result: { branches: ["main"], current: "main" },
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
        result: { branches: ["main"], current: "main" },
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

/**
 * 忙闲三态不构成页面上的禁用理由（spec remote/remote-web.md「Web 端也能发起新会话」
 * 场景 10）：页面上这个图标是「在机器上另起一条会话」，不是 IDE 的原地清空
 * `clearChat`——电脑侧那条会话照旧跑着，所以 streaming / 压缩中 / 有正在跑的
 * 后台任务时入口照常可用（反过来，IDE 端那条守卫一字不变）。
 */
describe("remote page new-session entry under busy states", () => {
  const runningTask: BackgroundTaskSummary = {
    id: "bg-shell-1",
    type: "shell",
    status: "running",
    startTime: 1000,
    command: "sleep 300",
  };

  it("stays usable while the machine generates, compacts or runs a background task", () => {
    renderRemotePage();
    const newSessionBtn = screen.getByTestId("new-session-btn");
    expect(newSessionBtn).not.toBeDisabled();

    act(() => {
      sendCommand("startStreaming");
    });
    expect(newSessionBtn).not.toBeDisabled();

    act(() => {
      sendCommand("endStreaming");
      sendCommand("compactionStateChange", { isCompacting: true });
    });
    expect(newSessionBtn).not.toBeDisabled();

    act(() => {
      sendCommand("compactionStateChange", { isCompacting: false });
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });
    expect(newSessionBtn).not.toBeDisabled();

    // 不只是「看着能点」：点下去真的打开新建会话流程。
    act(() => {
      fireEvent.click(newSessionBtn);
    });
    expect(screen.getByTestId("remote-new-session-dialog")).toBeInTheDocument();
  });

  it("still greys the IDE entry out in the very same states", () => {
    renderChatApp();
    const newSessionBtn = screen.getByTestId("new-session-btn");
    expect(newSessionBtn).not.toBeDisabled();

    act(() => {
      sendCommand("startStreaming");
    });
    expect(newSessionBtn).toBeDisabled();

    act(() => {
      sendCommand("endStreaming");
      sendCommand("updateBackgroundTasks", { tasks: [runningTask] });
    });
    expect(newSessionBtn).toBeDisabled();

    act(() => {
      sendCommand("updateBackgroundTasks", { tasks: [] });
    });
    expect(newSessionBtn).not.toBeDisabled();
  });
});
