import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { SessionList } from "../../src/components/SessionList";
import { createMockVscode, sendCommand } from "./test-utils";
import type { SessionMetadata } from "wave-agent-sdk/types";

/**
 * 会话目录缺失后的恢复（spec desktop/desktop-sessions.md「会话目录缺失后的恢复
 * （换文件夹继续）」场景 1/2/7）。三个落点：
 * - 侧栏行「目录缺失」缀标（行仍可点，点进去才有恢复入口）；
 * - 会话视图把输入框换成恢复提示（两个动作各自发一条既有/新增命令）；
 * - 桌面端 `/resume` 行的红点 + 「目录不存在」。
 *
 * 宿主的探测结果就是 `folderMissing` 这一个字段：本地会话缺目录才为 true，远端
 * 不写、探测失败也留空——组件侧不按端分叉，判据只有字段本身。
 */

const session = (sessionId: string, title: string, extra = {}) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  ...extra,
});

/** 一条「当前会话」的 SessionMetadata（`updateCurrentSession` 推的那份）。 */
const currentSessionMeta = (overrides: Partial<SessionMetadata> = {}) =>
  ({
    id: "s1",
    sessionType: "main",
    workdir: "/gone/project",
    createdAt: "2026-07-20T00:00:00.000Z",
    lastActiveAt: "2026-07-21T00:00:00.000Z",
    latestTotalTokens: 0,
    firstMessage: "聊了一半",
    ...overrides,
  }) as SessionMetadata;

function renderDesktopApp() {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/gone/project",
    recentWorkdirs: ["/gone/project"],
  });
  sendCommand("setInitialState", { messages: [] });
  return { ...result, vscode };
}

/** 窗口级 UI 偏好（分组折叠）持久化在 localStorage：不清掉会跨用例串。 */
afterEach(() => {
  localStorage.clear();
});

const posted = (
  vscode: { postMessage: ReturnType<typeof createMockVscode>["postMessage"] },
  command: string,
) =>
  vscode.postMessage.mock.calls
    .map((call) => call[0] as Record<string, unknown>)
    .filter((message) => message.command === command);

/** 布局矩形的左 / 右边缘。行内元素会不会互相压住，只能靠真浏览器量（CSS 生效）。 */
const rightEdge = (el: HTMLElement) => el.getBoundingClientRect().right;
const leftEdge = (el: HTMLElement | null) => {
  if (!el) throw new Error("measure target missing");
  return el.getBoundingClientRect().left;
};

describe("侧栏「目录缺失」标识", () => {
  it("只给 folderMissing 的行加缀标，悬停文案里带最后已知路径", () => {
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "/gone/project",
          sessions: [
            session("s1", "目录没了的对话", { folderMissing: true }),
            session("s2", "还好好的对话"),
          ],
        },
      ],
    });

    const badge = screen.getByTestId("desktop-session-folder-missing-s1");
    expect(badge).toHaveTextContent("目录缺失");
    expect(badge.getAttribute("title")).toContain("/gone/project");

    // 健康行上什么都不多出来。
    expect(
      screen.queryByTestId("desktop-session-folder-missing-s2"),
    ).not.toBeInTheDocument();
  });

  it("行仍然可点击：点进去才看得到恢复入口，不拦截 desktopSelectSession", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "/gone/project",
          sessions: [session("s1", "目录没了的对话", { folderMissing: true })],
        },
      ],
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("desktop-session-main-s1"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      workdir: "/gone/project",
      sessionId: "s1",
    });
  });

  it("与运行中/待确认的状态点共存，互不压制", () => {
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "/gone/project",
          sessions: [
            session("s1", "缺失且待确认", {
              folderMissing: true,
              waitingConfirmation: true,
            }),
            session("s2", "缺失且运行中", {
              folderMissing: true,
              running: true,
            }),
          ],
        },
      ],
    });

    const waiting = screen.getByTestId("desktop-session-item-s1");
    expect(
      waiting.querySelector(
        ".desktop-session-status-slot--waiting svg[aria-label='等待确认']",
      ),
    ).not.toBeNull();
    expect(
      screen.getByTestId("desktop-session-folder-missing-s1"),
    ).toBeInTheDocument();

    const running = screen.getByTestId("desktop-session-item-s2");
    expect(
      running.querySelector(
        ".desktop-session-status-slot--running svg[aria-label='正在运行']",
      ),
    ).not.toBeNull();
    expect(
      screen.getByTestId("desktop-session-folder-missing-s2"),
    ).toBeInTheDocument();
    // 几何也验一遍（真浏览器 + 真样式）：两个盒子不重叠，谁都没被压在下面。
    expect(
      rightEdge(screen.getByTestId("desktop-session-folder-missing-s2")),
    ).toBeLessThanOrEqual(
      leftEdge(
        running.querySelector<HTMLElement>(".desktop-session-status-slot"),
      ) + 1,
    );
  });

  it("没有状态点时也不钻到行右端「⋯」下面（行恒让位 32px）", () => {
    renderDesktopApp();
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: "/gone/project",
          sessions: [session("s1", "目录没了的对话", { folderMissing: true })],
        },
      ],
    });

    // 这条行没有状态点（无 running/waiting/newCompleted，也不是当前会话），所以
    // 让位只可能来自 `.desktop-session-item--folder-missing` 那条 padding-right。
    // 「⋯」按钮一直是渲染着的（只是 opacity:0），几何上就是它占的那 24px。
    const row = screen.getByTestId("desktop-session-item-s1");
    expect(row.querySelector(".desktop-session-status-slot")).toBeNull();
    expect(
      rightEdge(screen.getByTestId("desktop-session-folder-missing-s1")),
    ).toBeLessThanOrEqual(
      leftEdge(row.querySelector<HTMLElement>(".desktop-session-more-btn")) + 1,
    );
  });
});

describe("会话视图的恢复提示", () => {
  it("当前会话目录缺失：提示出现、composer 不渲染（占的是 composer 那个槽位）", () => {
    renderDesktopApp();
    sendCommand("updateCurrentSession", {
      session: currentSessionMeta({ folderMissing: true }),
    });

    const recovery = screen.getByTestId("session-folder-recovery");
    expect(recovery).toHaveTextContent(
      "当前工作目录已不存在。选择一个新文件夹继续这场对话。",
    );
    expect(recovery.getAttribute("class")).toContain("session-folder-recovery");
    // 与 composer 同一个槽位（`.input-area-container` 的流内子元素）——消息列表
    // 高度不受影响，提示也盖不住消息。
    expect(recovery.parentElement?.className).toContain("input-area-container");
    // 输入框整块不挂载：既不接受发送，`/` 面板之类的入口也一起消失。
    expect(screen.queryByTestId("input-container")).not.toBeInTheDocument();
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();

    // 最后已知路径留在提示里，方便认出是哪一场对话。
    expect(
      screen.getByTestId("session-folder-recovery-path"),
    ).toHaveTextContent("/gone/project");
  });

  it("两个动作各发一条命令：「选择文件夹」→ desktopRelocateSession，「删除会话」→ desktopDeleteSession", () => {
    const { vscode } = renderDesktopApp();
    sendCommand("updateCurrentSession", {
      session: currentSessionMeta({ folderMissing: true }),
    });
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("session-folder-recovery-choose"));
    expect(posted(vscode, "desktopRelocateSession")).toEqual([
      { command: "desktopRelocateSession", sessionId: "s1", paneId: "pane-1" },
    ]);

    fireEvent.click(screen.getByTestId("session-folder-recovery-delete"));
    expect(posted(vscode, "desktopDeleteSession")).toEqual([
      { command: "desktopDeleteSession", sessionId: "s1", paneId: "pane-1" },
    ]);
  });

  it("folderMissing 变假后提示消失、composer 回来", () => {
    renderDesktopApp();
    sendCommand("updateCurrentSession", {
      session: currentSessionMeta({ folderMissing: true }),
    });
    expect(screen.getByTestId("session-folder-recovery")).toBeInTheDocument();

    // 宿主搬迁成功后会重推当前会话（新目录、folderMissing 不再为 true）。
    sendCommand("updateCurrentSession", {
      session: currentSessionMeta({
        workdir: "/work/new",
        folderMissing: false,
      }),
    });

    expect(
      screen.queryByTestId("session-folder-recovery"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("input-container")).toBeInTheDocument();
  });

  it("健康会话不出现恢复提示，composer 照常", () => {
    renderDesktopApp();
    sendCommand("updateCurrentSession", { session: currentSessionMeta() });

    expect(
      screen.queryByTestId("session-folder-recovery"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("input-container")).toBeInTheDocument();
  });
});

describe("`/resume` 行的「目录不存在」", () => {
  const listSession = (
    id: string,
    firstMessage: string,
    extra: Partial<SessionMetadata> = {},
  ) =>
    ({
      id,
      sessionType: "main",
      workdir: "/gone/project",
      firstMessage,
      lastActiveAt: new Date("2023-12-01T10:00:00Z"),
      latestTotalTokens: 0,
      ...extra,
    }) as SessionMetadata;

  it("带该字段的行出红点 + 文案，不带的行没有", () => {
    render(
      <SessionList
        sessions={[
          listSession("gone", "目录没了的对话", { folderMissing: true }),
          listSession("ok", "还好好的对话"),
        ]}
        onSessionSelect={() => {}}
      />,
    );

    const marker = screen.getByTestId("session-list-folder-missing-gone");
    expect(marker).toHaveTextContent("目录不存在");
    // 红点：一个只作装饰的点（不参与无障碍朗读），颜色由 CSS 的 currentColor 给。
    expect(marker.querySelector("span[aria-hidden='true']")).not.toBeNull();

    expect(
      screen.queryByTestId("session-list-folder-missing-ok"),
    ).not.toBeInTheDocument();
  });

  it("不占远控页的「待确认 / 运行中」状态槽：那个槽没传就整块不渲染", () => {
    render(
      <SessionList
        sessions={[
          listSession("gone", "目录没了的对话", { folderMissing: true }),
        ]}
        onSessionSelect={() => {}}
      />,
    );

    expect(
      screen.queryByTestId("session-list-status-gone"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("session-list-folder-missing-gone"),
    ).toBeInTheDocument();
  });
});
