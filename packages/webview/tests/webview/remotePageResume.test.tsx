/**
 * 远控页的 `/resume`：接着**磁盘上的**历史会话聊
 * （spec remote/remote-web.md「手机端也能接着磁盘上的历史会话聊」）。
 *
 * 这条命令在四个入口上的落点各不相同，而差异**全部**由共享 UI 这一层分派：
 *
 * - 桌面端：向当前宿主扫盘（`desktopListResumeSessions`），居中弹窗、按项目平铺；
 * - 远控页：向**承接进程**要这台机器磁盘上的历史会话（`listResumeSessions`），
 *   打开整页列表；
 * - IDE 两端：没有扩宽的能力，仍旧把表头已经加载好的那份重开成下拉。
 *
 * 「和桌面端对齐」指的是**能力**对齐（能接着磁盘上的历史会话聊），不是把桌面端
 * 那套弹窗搬过来：手机上一屏只放得下一层，所以这里是整页。这份用例同时钉住
 * 「其余三个入口没被顺手改掉」。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  fireInput,
  renderChatApp,
  screen,
  sendCommand,
  within,
} from "./test-utils";

const DISK_SESSIONS = [
  {
    id: "disk-1",
    sessionType: "main" as const,
    workdir: "/old/repo",
    firstMessage: "上次那个登录 bug",
    createdAt: new Date("2026-10-20T08:00:00Z"),
    lastActiveAt: new Date(),
    latestTotalTokens: 0,
  },
  {
    id: "disk-2",
    sessionType: "main" as const,
    workdir: "/work/wave-agent-copy",
    customTitle: "发布脚本",
    createdAt: new Date("2026-10-21T08:00:00Z"),
    lastActiveAt: new Date(),
    latestTotalTokens: 0,
  },
];

/** Set contenteditable text with selection inside a text node and fire input. */
async function typeInInput(text: string) {
  const input = screen.getByTestId("message-input");
  const existing = input.textContent || "";
  const fullText = existing + text;
  input.textContent = fullText;

  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    const textNode = input.firstChild;
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  await fireInput(input, { data: text, inputType: "insertText" });
}

/** A live session, so the page has something being watched (input not gated off). */
const CURRENT = {
  id: "session-1",
  sessionType: "main" as const,
  workdir: "/repo",
  firstMessage: "当前这条",
  createdAt: new Date("2026-10-25T08:00:00Z"),
  lastActiveAt: new Date("2026-10-25T09:00:00Z"),
  latestTotalTokens: 100,
};

/** Type `/resume` and send it, as the phone's user would. */
async function sendResume({ remotePage = true } = {}) {
  if (remotePage) window.waveRemotePage = true;
  const rendered = renderChatApp();
  // 远控页在没有会话时把输入区整体置灰（spec remote/remote-web.md），所以先给
  // 它一条正在看的会话，否则这一步点不动——真实页面上也是先有会话再敲命令。
  act(() => {
    sendCommand("updateSessions", { sessions: [CURRENT] });
    sendCommand("updateCurrentSession", { session: CURRENT });
  });
  await typeInInput("/resume");
  act(() => {
    fireEvent.click(screen.getByTestId("send-btn"));
  });
  return rendered;
}

/** The newest message the UI posted to the host for `command`. */
function lastSent(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
  command: string,
) {
  const sent = vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message.command === command);
  return sent[sent.length - 1];
}

/** Answer the scan the page just asked for. */
function answerScan(
  vscode: ReturnType<typeof renderChatApp>["vscode"],
  sessions: unknown[],
  extra: Record<string, unknown> = {},
) {
  act(() => {
    sendCommand("resumeDiskSessions", {
      requestId: lastSent(vscode, "listResumeSessions").requestId,
      sessions,
      ...extra,
    });
  });
}

afterEach(() => {
  delete window.waveRemotePage;
});

describe("remote page /resume", () => {
  it("opens a full page over the machine's disk transcripts, not a dropdown", async () => {
    window.waveRemotePage = true;
    const { vscode } = await sendResume();

    expect(screen.getByTestId("remote-resume-page")).toBeInTheDocument();
    expect(screen.getByTestId("remote-resume-page-search")).toBeVisible();
    // 桌面端那份居中弹窗不该跟着过来：页面上只有一层。
    expect(screen.queryByTestId("session-list-popup")).not.toBeInTheDocument();

    // `limit` 是按帧预算定的（规格场景 2）：超预算的回执在机器侧是报错而不是
    // 截断，所以上限只有页面这一侧能落实。
    expect(lastSent(vscode, "listResumeSessions")).toMatchObject({
      command: "listResumeSessions",
      limit: 200,
    });
    // 回执未到之前是加载态，不是空列表——否则用户会以为这台机器没有历史。
    expect(screen.getByText("正在加载...")).toBeInTheDocument();
  });

  it("renders a row per transcript with its label and full workdir", async () => {
    window.waveRemotePage = true;
    const { vscode } = await sendResume();
    answerScan(vscode, DISK_SESSIONS);

    const page = screen.getByTestId("remote-resume-page");
    const first = within(page).getByTestId("remote-resume-row-disk-1");
    expect(first).toHaveTextContent("上次那个登录 bug");
    // 完整路径而不是目录名：这份列表跨项目，两个同名目录必须能分辨
    //（桌面端那张同源列表也是完整路径）。
    expect(first).toHaveTextContent("/old/repo");
    // 重命名过的那条用自定义标题。
    expect(
      within(page).getByTestId("remote-resume-row-disk-2"),
    ).toHaveTextContent("发布脚本");

    // 搜索同时匹配标题与路径（「恢复某个项目的会话」是主用法）。
    act(() => {
      fireEvent.change(within(page).getByTestId("remote-resume-page-search"), {
        target: { value: "wave-agent-copy" },
      });
    });
    expect(
      within(page).queryByTestId("remote-resume-row-disk-1"),
    ).not.toBeInTheDocument();
    expect(
      within(page).getByTestId("remote-resume-row-disk-2"),
    ).toBeInTheDocument();
  });

  it("asks the host to seed a new session from the picked transcript", async () => {
    window.waveRemotePage = true;
    const { vscode } = await sendResume();
    answerScan(vscode, DISK_SESSIONS);

    const page = screen.getByTestId("remote-resume-page");
    act(() => {
      fireEvent.click(
        within(page).getByTestId("remote-resume-row-select-disk-1"),
      );
    });

    // 带上 workdir：宿主用它当新会话的工作目录（历史会话本身不带进来）。
    expect(lastSent(vscode, "resumeDiskSession")).toMatchObject({
      command: "resumeDiskSession",
      sessionId: "disk-1",
      workdir: "/old/repo",
    });
    // 在途时列表锁住并给一句话：连点不该发出两条 initialize。
    expect(screen.getByTestId("remote-resume-restoring")).toBeInTheDocument();
    expect(
      within(page).getByTestId("remote-resume-row-select-disk-2"),
    ).toBeDisabled();
    // 回执之前先留在这一页（不是点了就消失的「没反应」）。
    expect(screen.getByTestId("remote-resume-page")).toBeInTheDocument();
  });

  it("stays on the list with the reason when the workdir is gone", async () => {
    window.waveRemotePage = true;
    const { vscode } = await sendResume();
    answerScan(vscode, DISK_SESSIONS);

    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-resume-page")).getByTestId(
          "remote-resume-row-select-disk-1",
        ),
      );
    });

    // 手机上没有终端也没有 toast：原因必须留在这一页上（规格场景 5）。
    act(() => {
      sendCommand("resumeDiskSessionResult", {
        requestId: lastSent(vscode, "resumeDiskSession").requestId,
        error: "该会话的工作目录已不存在",
      });
    });

    expect(screen.getByTestId("remote-resume-error")).toHaveTextContent(
      "该会话的工作目录已不存在",
    );
    expect(screen.getByTestId("remote-resume-page")).toBeInTheDocument();
    // 失败后行要重新可点：用户可以直接换一条。
    expect(
      within(screen.getByTestId("remote-resume-page")).getByTestId(
        "remote-resume-row-select-disk-1",
      ),
    ).not.toBeDisabled();
  });

  it("closes once the host has switched the page to the restored session", async () => {
    window.waveRemotePage = true;
    const { vscode } = await sendResume();
    answerScan(vscode, DISK_SESSIONS);

    act(() => {
      fireEvent.click(
        within(screen.getByTestId("remote-resume-page")).getByTestId(
          "remote-resume-row-select-disk-1",
        ),
      );
    });
    act(() => {
      sendCommand("resumeDiskSessionResult", {
        requestId: lastSent(vscode, "resumeDiskSession").requestId,
        sessionId: "s-restored",
      });
    });

    // shim 已经把这一端的会话指针挪到新会话并拉了首屏快照——UI 只收尾。
    expect(screen.queryByTestId("remote-resume-page")).not.toBeInTheDocument();
  });

  it("ignores a reply from a scan that was closed and reopened", async () => {
    window.waveRemotePage = true;
    // `requestId` 是 `Date.now()`：固定时钟让两次请求的 id 一定不同
    //（同一毫秒里两次点 `/resume` 不该把两次扫描的回执混成一份）。
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const { vscode } = await sendResume();
      const staleRequestId = lastSent(vscode, "listResumeSessions").requestId;

      act(() => {
        fireEvent.click(screen.getByTestId("remote-resume-page-back"));
      });
      expect(
        screen.queryByTestId("remote-resume-page"),
      ).not.toBeInTheDocument();

      clock.mockReturnValue(2_000);
      await typeInInput("/resume");
      act(() => {
        fireEvent.click(screen.getByTestId("send-btn"));
      });
      expect(lastSent(vscode, "listResumeSessions").requestId).not.toBe(
        staleRequestId,
      );

      // 上一次扫描的回执迟到：这次扫描还在等自己的回执，不能被它填满。
      act(() => {
        sendCommand("resumeDiskSessions", {
          requestId: staleRequestId,
          sessions: DISK_SESSIONS,
        });
      });
      expect(screen.getByText("正在加载...")).toBeInTheDocument();
      expect(
        screen.queryByTestId("remote-resume-row-disk-1"),
      ).not.toBeInTheDocument();
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the IDE hosts on the borrowed dropdown", async () => {
    // 非远控页（VS Code / JB）：`/resume` 仍是「把表头那份列表重开成下拉」，
    // 不扫盘也不新开页——插件端没有扩宽范围的能力（spec 场景 7 的例外）。
    const { vscode } = await sendResume({ remotePage: false });

    expect(screen.getByTestId("session-list-popup")).toBeInTheDocument();
    expect(screen.queryByTestId("remote-resume-page")).not.toBeInTheDocument();
    expect(lastSent(vscode, "listResumeSessions")).toBeUndefined();
    expect(lastSent(vscode, "desktopListResumeSessions")).toBeUndefined();
  });
});
