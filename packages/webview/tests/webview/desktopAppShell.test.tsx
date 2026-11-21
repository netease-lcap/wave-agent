/**
 * 桌面端外壳（侧边栏 / 会话树 / 工作目录 / 分支选择 / 账户卡片）的可见行为。
 * 迁移自 `e2e/desktop-app.e2e.ts`（原文件名叫 «Desktop App Screenshots»，实际是
 * 一条把桌面端首屏主路径走一遍的用例 + 两条控件用例）。
 *
 * 本套件跑在真 Chromium 里：`desktop-session-item--current`、状态槽里的
 * `svg[aria-label=…]`、分支菜单里的条目数，量的都是真渲染结果；宿主档由
 * `desktopHarness` 打开（`data-host="desktop"` + host-desktop.css）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  lastSent,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";
const DIR_C = "/Users/dev/projects/notes-app";

const session = (
  id: string,
  workdir: string,
  firstMessage: string,
  lastActiveAt: string,
) => ({
  id,
  sessionType: "main",
  workdir,
  createdAt: lastActiveAt,
  lastActiveAt,
  latestTotalTokens: 12000,
  firstMessage,
});

// A session tree entry. Status slots (FR-031 + Figma 13656:5470): the waiting
// dot and new-completed dot hint only for background sessions — the row never
// repeats a state already shown in the active chat or in another pane; the
// running loader is the exception and renders on any generating session,
// including the current one (2026-09-09 decision). A background generating
// session gets a loading ring, a tool-permission / plan / question
// confirmation gets an amber waiting dot. Both flags come straight from the
// tree data (the 5-per-directory cap was removed — a group may hold any number
// of sessions).
const treeSession = (
  sessionId: string,
  title: string,
  lastActiveAt: string,
  running = false,
  waitingConfirmation = false,
) => ({
  sessionId,
  title,
  lastActiveAt: new Date(lastActiveAt).getTime(),
  hasWorktree: false,
  running,
  waitingConfirmation,
});

const treeGroups = [
  {
    workdir: DIR_A,
    sessions: [
      treeSession(
        "sess-a1",
        "帮我修复登录页的样式问题",
        "2026-07-27T10:12:00Z",
        true,
      ),
      treeSession(
        "sess-a2",
        "给 bashTool 增加超时参数",
        "2026-07-26T09:40:00Z",
        false,
        true,
      ),
      treeSession(
        "sess-a3",
        "解释一下 listSessions 的实现",
        "2026-07-25T15:02:00Z",
        true,
      ),
      treeSession("sess-a4", "重构会话索引的持久化层", "2026-07-25T11:30:00Z"),
      treeSession(
        "sess-a5",
        "补全桌面端分屏的测试用例",
        "2026-07-24T18:05:00Z",
      ),
      treeSession(
        "sess-a6",
        "修复终端面板首次聚焦丢失",
        "2026-07-24T14:20:00Z",
      ),
      treeSession(
        "sess-a7",
        "梳理 worktree 隔离会话的边界",
        "2026-07-23T09:10:00Z",
      ),
    ],
  },
  {
    workdir: DIR_B,
    sessions: [
      treeSession("sess-b1", "订单接口偶发 500 排查", "2026-07-27T08:30:00Z"),
      treeSession("sess-b2", "给购物车加单元测试", "2026-07-24T11:20:00Z"),
    ],
  },
  {
    workdir: DIR_C,
    sessions: [
      treeSession("sess-c1", "支持 Markdown 导出", "2026-07-23T14:00:00Z"),
    ],
  },
];

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
  localStorage.clear();
});

/** 屏上「文字恰好是这段」的元素里，最内层那一个（去掉包住它的祖先）。 */
const exactTextEl = (text: string) =>
  Array.from(document.querySelectorAll<HTMLElement>("div, span, button"))
    .filter((el) => (el.textContent ?? "").trim() === text)
    .pop() ?? null;

const statusIcon = (sessionId: string, slot: "running" | "waiting") =>
  document.querySelector(
    `[data-testid="desktop-session-item-${sessionId}"] ` +
      `.desktop-session-status-slot--${slot} svg[aria-label='${slot === "running" ? "正在运行" : "等待确认"}']`,
  );

describe("Desktop app shell", () => {
  it("first launch renders the welcome page and the session tree; a bound session is marked current with its status slots", async () => {
    await page.viewport(960, 640);

    // ── 1. First launch: no workdir selected ─────────────────────
    // Sidebar renders the session tree with all directory groups
    // expanded by default; the input area (including +/slash/permission/
    // send buttons) is disabled until the user picks a directory.
    // Recents must be EMPTY here: effectiveWorkdir falls back to
    // recentWorkdirs[0] when state.workdir is unset (ChatApp.tsx), so the
    // "no workdir" placeholder only renders when there is no recents list.
    renderDesktopApp();
    sendCommand("desktopWorkdirState", { recentWorkdirs: [] });
    sendCommand("desktopSessionTree", { groups: treeGroups });
    sendCommand("setInitialState", initialState);

    expect(isVisible('[data-testid="desktop-sidebar"]')).toBe(true);
    expect(
      (screen.getByTestId("desktop-workdir").textContent ?? "").includes(
        "选择工作目录",
      ),
    ).toBe(true);
    // Regression guard: the empty-messages body must render the welcome
    // page, not the LoadingLogo sweep. The sweep appeared before because
    // setInitialState was dispatched before ChatApp's listener attached.
    expect(document.querySelectorAll(".loading-logo").length).toBe(0);
    expect(isVisible('[data-testid="welcome-wordmark"]')).toBe(true);

    // ── 2. Session tree: workdir selected, all groups expanded ────
    // Status slots (FR-031 / Figma 13656:5470): the session restored into the
    // active chat (sess-a1) is marked current and keeps generating — per the
    // 2026-09-09 decision the running ring is NOT gated behind background-only,
    // so its row carries the loader too; sess-a2 awaits a confirmation → amber
    // waiting dot; sess-a3 keeps generating in the background → loading ring.
    // Every directory lists all of its sessions (no 5-per-directory cap),
    // newest-first.
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    sendCommand("setInitialState", {
      ...initialState,
      session: session(
        "sess-a1",
        DIR_A,
        "帮我修复登录页的样式问题",
        "2026-07-27T10:12:00Z",
      ),
    });
    // Bind the startup pane to sess-a1 the way a real host does when the user
    // opens a session: the sidebar's current-row state derives from
    // panes.find(focusedPaneId)?.sessionId (DesktopShell), so without this the
    // auto-created unbound pane leaves sess-a1 unmarked.
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });

    expect(isVisible('[data-testid="desktop-session-item-sess-a1"]')).toBe(
      true,
    );
    // sess-a1 became the active chat session → the row is marked current and
    // (running: true in the tree) shows the loading ring on its own row.
    await expect
      .poll(
        () =>
          document
            .querySelector('[data-testid="desktop-session-item-sess-a1"]')
            ?.className.includes("desktop-session-item--current") ?? false,
      )
      .toBe(true);
    await expect.poll(() => statusIcon("sess-a1", "running")).toBeTruthy();
    expect(isVisible("[data-testid='desktop-session-item-sess-a1']")).toBe(
      true,
    );
    await expect.poll(() => statusIcon("sess-a3", "running")).toBeTruthy();
    await expect.poll(() => statusIcon("sess-a2", "waiting")).toBeTruthy();
    // Other groups are expanded by default too
    expect(isVisible('[data-testid="desktop-session-item-sess-b1"]')).toBe(
      true,
    );

    // Collapse a group to show collapse/expand interactivity
    const groupHeaderText = () => exactTextEl("shop-server");
    expect(groupHeaderText()).toBeTruthy();
    await userEvent.click(groupHeaderText()!);
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-item-sess-b1"]'))
      .toBe(false);
    // Re-expand so the following steps see the default all-expanded state
    await userEvent.click(groupHeaderText()!);
    await expect
      .poll(() => isVisible('[data-testid="desktop-session-item-sess-b1"]'))
      .toBe(true);

    // ── 3. Workdir dropdown in the input area ─────────────────────
    await userEvent.click(screen.getByTestId("desktop-workdir"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-workdir-menu"]'))
      .toBe(true);
    await userEvent.keyboard("{Escape}");

    // ── 4. Core chat interaction (same as plugin hosts) ────────────
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createUserMessage(
          "帮我修复登录页的样式问题",
          "msg-u1",
        ),
        MockDataGenerator.createAssistantMessage(
          "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
          "msg-a1",
        ),
      ],
    });
    // Note: the workdir selector in the input only renders for a fresh
    // session (no messages yet) — by design (ChatApp.tsx).
    await expect.poll(() => isVisible(".message.user")).toBe(true);
    expect(isVisible(".message.assistant")).toBe(true);
  });

  it("worktree-isolated new-session page shows branch selector", async () => {
    await page.viewport(960, 640);

    // Single-pane (no desktopPanes) → ChatApp renders the new-session page
    // once a workdir is chosen. It then asks the host for the repo's branches
    // (desktopListGitBranches); the mock replies so the controls render.
    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    sendCommand("setInitialState", {
      ...initialState,
      isAuthenticated: true,
    });

    await expect
      .poll(() => lastSent(vscode, "desktopListGitBranches"), {
        timeout: 4000,
      })
      .toBeTruthy();
    sendCommand("desktopGitBranches", {
      workdir: DIR_A,
      result: {
        branches: ["main", "feature/login", "develop"],
        current: "main",
      },
    });

    await expect
      .poll(() => isVisible('[data-testid="desktop-worktree-controls"]'))
      .toBe(true);
    expect(isVisible('[data-testid="desktop-worktree-checkbox"]')).toBe(true);

    // Open the branch selector dropdown.
    await userEvent.click(screen.getByTestId("desktop-branch-selector"));
    await expect
      .poll(() => isVisible('[data-testid="desktop-branch-menu"]'))
      .toBe(true);
    expect(
      document.querySelectorAll('[data-testid="desktop-branch-item"]').length,
    ).toBe(3);
  });

  it("account card more menu lists settings / enterprise / logout", async () => {
    await page.viewport(960, 640);

    const { vscode } = renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A, DIR_B, DIR_C],
    });
    // Wait for ChatApp to mount and its message listener (a passive effect)
    // to attach before sending setInitialState — otherwise the auth status is
    // lost and the more menu renders "登录" instead of "退出登录".
    // desktopListGitBranches is posted in the same effect flush, so once it
    // lands the listener is ready.
    await expect
      .poll(() => lastSent(vscode, "desktopListGitBranches"), {
        timeout: 4000,
      })
      .toBeTruthy();
    sendCommand("setInitialState", {
      ...initialState,
      isAuthenticated: true,
    });
    // The sidebar account card only appears once the host pushes a
    // desktopAccountInfo snapshot.
    sendCommand("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      billing: null,
      apiQuota: null,
    });

    expect(isVisible('[data-testid="desktop-sidebar"]')).toBe(true);
    // v3 account card: the personal-info row is the hotzone opening the menu.
    await expect
      .poll(() => isVisible('[data-testid="account-card-hotzone"]'))
      .toBe(true);
    await userEvent.click(screen.getByTestId("account-card-hotzone"));
    await expect.poll(() => isVisible('[data-testid="more-menu"]')).toBe(true);
    expect(isVisible('[data-testid="more-menu-settings"]')).toBe(true);
    expect(isVisible('[data-testid="more-menu-enterprise"]')).toBe(true);
    expect(isVisible('[data-testid="more-menu-logout"]')).toBe(true);
  });
});
