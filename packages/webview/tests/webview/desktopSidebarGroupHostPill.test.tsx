/**
 * 分组头一行里「项目名 + 主机标签 pill」的宽度预算（spec
 * `docs/specs/desktop/desktop-wsl.md` 场景 16/17）。
 *
 * 迁移自 `e2e/desktop-sidebar-group-host-pill.e2e.ts`。那一行共 170px（侧栏 260 −
 * 侧栏内衬 24 − 组头内衬 16 − 文件夹/间隙/chevron 49）。pill 原上限 40%（≈98px）
 * 只给项目名留 71px，用户在 Windows（字形更宽）看到的是「wave-ag… + Ubuntu-24.04 (…」
 * ——项目名被挤没（用户反馈 2026-11-05）。现在 pill 收在 30%（≈76px）：项目名
 * 完整、pill 截断（全文在 title 与菜单里）。
 *
 * `scrollWidth` / `clientWidth` 只有真布局才有值，所以本套件跑在真 Chromium 里。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR = "/home/liuyiqi02/github/wave-agent";
const WSL_LABEL = "Ubuntu-24.04 (WSL)";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 屏上的分组头（DOM 顺序 = 视觉顺序）。 */
const groupHeaders = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".desktop-session-group-header"),
  );

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Sidebar group header host pill vs project name", () => {
  it("keeps the project name whole and lets the host pill truncate", async () => {
    await page.viewport(1180, 760);

    renderDesktopApp();
    sendCommand("desktopWorkdirState", {
      workdir: DIR,
      recentWorkdirs: [DIR],
    });
    sendCommand("desktopSessionTree", {
      groups: [
        {
          host: "wsl:Ubuntu-24.04",
          // spec desktop-wsl.md 场景 16/17：分组标签显示「Ubuntu (WSL)」而不是
          // 内部主机标识。
          hostLabel: WSL_LABEL,
          workdir: DIR,
          sessions: [treeSession("s1", "clone lewis617 的 claude-code 仓库")],
        },
        {
          host: "local",
          workdir: "/home/liuyiqi02/github/wave-agent-docs",
          sessions: [treeSession("s2", "本地分组")],
        },
      ],
    });
    sendCommand("setInitialState", initialState);

    await expect.poll(() => groupHeaders().length).toBe(2);
    const headers = groupHeaders();

    // 1. 项目名不被截断：文字宽度没有超过盒子（否则会出现省略号）。
    const name = headers[0].querySelector<HTMLElement>(
      ".desktop-session-group-name",
    )!;
    expect(name).toBeTruthy();
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    expect((name.textContent ?? "").trim()).toBe("wave-agent");

    // 2. 让位的是 pill：它被收在上限内，文字溢出（title 有全文）。
    await expect
      .poll(
        () =>
          headers[0].querySelectorAll<HTMLElement>(
            ".desktop-session-group-host",
          ).length,
      )
      .toBe(1);
    const pill = headers[0].querySelector<HTMLElement>(
      ".desktop-session-group-host",
    )!;
    expect(pill.getAttribute("title")).toBe(WSL_LABEL);
    expect(pill.clientWidth).toBeLessThanOrEqual(80);
    expect(pill.scrollWidth).toBeGreaterThan(pill.clientWidth);

    // 3. 本地分组照旧不带 pill（只有远程/WSL 分组才有）。
    expect(
      headers[1].querySelectorAll(".desktop-session-group-host").length,
    ).toBe(0);
  });
});
