/**
 * 桌面端多项目切换：「项目设置 / 个性化」显示的是**当前聚焦项目**，而不是
 * recents 头部或上一个项目的旧快照。
 *
 * 迁移自 `e2e/desktop-project-switch-settings.e2e.ts`。出处：
 *  - PR #2155 桌面「项目设置 → SDD 开关」不随聚焦会话的项目切换（host 已按聚焦
 *    pane 回包，但 webview 归属守卫用 effectiveWorkdir = recents 头优先，把正确
 *    回包当过期丢弃、SettingsPage 继续信任上一项目快照）。
 *  - PR #2152 桌面「个性化 → 项目级 AGENTS.md」只显示第一个项目的值（编辑器缓存
 *    不按 workdir 键控、只随首次加载填充且从不失效 → 每次打开重读当前项目）。
 *
 * 关键：`host.workdir`（`desktopWorkdirState.workdir`）是「当前聚焦项目」的权威
 * 来源；recents 头（`recentWorkdirs[0]`）恢复历史会话时不更新，因此这里刻意让
 * recents 头停在项目 A，把聚焦项目切到 B。
 *
 * 本套件跑在真 Chromium 里，设置页的开关/输入框/编辑器都是真 DOM 交互（复选框
 * 本体 opacity:0，交互点在样式化外层 `.settings-switch` 上）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: null,
  apiQuota: null,
};

const sessionTree = [
  {
    workdir: DIR_A,
    sessions: [
      {
        sessionId: "sess-a1",
        title: "项目 A 的会话",
        lastActiveAt: new Date("2026-07-27T10:12:00Z").getTime(),
        hasWorktree: false,
        running: false,
        waitingConfirmation: false,
      },
    ],
  },
  {
    workdir: DIR_B,
    sessions: [
      {
        sessionId: "sess-b1",
        title: "项目 B 的会话",
        lastActiveAt: new Date("2026-07-27T09:12:00Z").getTime(),
        hasWorktree: false,
        running: false,
        waitingConfirmation: false,
      },
    ],
  },
];

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 启动到「聚焦 pane 已在项目 A」的稳定态。 */
async function setupFocusedOnA() {
  const { vscode } = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopSessionTree", { groups: sessionTree });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  sendCommand("desktopAccountInfo", accountInfo);
  await expect
    .poll(() => isVisible('[data-testid="desktop-sidebar"]'))
    .toBe(true);
  return vscode;
}

/** 聚焦 pane 切到项目 B 的会话（recents 头保持 A，模拟恢复历史会话）。 */
function focusProjectB() {
  sendCommand("desktopWorkdirState", {
    workdir: DIR_B,
    recentWorkdirs: [DIR_A],
  });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-b1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
}

/** 侧栏账户卡「更多」→「设置」。 */
async function openSettings() {
  await expect
    .poll(() => isVisible('[data-testid="account-card-hotzone"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("account-card-hotzone"));
  await expect.poll(() => isVisible('[data-testid="more-menu"]')).toBe(true);
  await userEvent.click(screen.getByTestId("more-menu-settings"));
  await expect.poll(() => isVisible(".settings-page")).toBe(true);
}

async function closeSettings() {
  await userEvent.click(screen.getByRole("button", { name: "返回" }));
  await expect
    .poll(() => document.querySelectorAll(".settings-page").length)
    .toBe(0);
}

/** 左导航按文案点一项（`settings-nav-item` 里文字 + 图标，按含文字找）。 */
async function clickNavItem(label: string) {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(".settings-nav-item"),
  ).find((el) => (el.textContent ?? "").includes(label));
  expect(item).toBeTruthy();
  await userEvent.click(item!);
}

async function enterProjectSettings() {
  await clickNavItem("项目设置");
  await expect
    .poll(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(".settings-page h1"),
      ).some((el) => (el.textContent ?? "").trim() === "项目设置"),
    )
    .toBe(true);
}

const sddSwitch = () =>
  document.querySelector<HTMLInputElement>(
    '.settings-switch input[aria-label="启用 SDD 插件"]',
  );

/** 已发出的 `getProjectSettings` 条数（原文用 getTestMessages 数同一条命令）。 */
const projectSettingsRequests = (vscode: { postMessage: unknown }) =>
  sentCommands(vscode).filter(
    (message) => message.command === "getProjectSettings",
  ).length;

/** 从 `mark` 之后发出的指令里第一条 `command`（等价于 clearMessageLog 后取）。 */
const postedSince = (
  vscode: { postMessage: unknown },
  mark: number,
  command: string,
) =>
  sentCommands(vscode)
    .slice(mark)
    .find((message) => message.command === command);

/**
 * 从 `mark` 之后发出的「项目级 AGENTS.md 读取请求」。
 *
 * 打开设置页时默认停在「用户级」tab，它也会发一条 `getAgentsContent`（不带
 * workdir），所以必须像原文一样按 `scope === "project"` 一起筛。
 */
const projectAgentsRequest = (vscode: { postMessage: unknown }, mark = 0) =>
  sentCommands(vscode)
    .slice(mark)
    .find(
      (message) =>
        message.command === "getAgentsContent" && message.scope === "project",
    );

describe("桌面多项目切换：项目设置 / AGENTS.md 跟随聚焦项目", () => {
  it("SDD 开关随聚焦项目切换：B 回包生效、A 旧快照不回显、过期回包被丢弃", async () => {
    await page.viewport(1280, 800);
    const vscode = await setupFocusedOnA();

    await openSettings();
    await enterProjectSettings();

    // 进入项目设置视图触发拉取
    await expect.poll(() => projectSettingsRequests(vscode)).toBe(1);

    // 项目 A 启用 SDD → 开关勾选且可用
    sendCommand("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await expect.poll(() => sddSwitch()?.disabled).toBe(false);
    expect(sddSwitch()!.checked).toBe(true);

    // 聚焦项目切到 B（recents 头仍为 A）→ 设置页按新 workdir 重拉
    focusProjectB();
    await expect.poll(() => projectSettingsRequests(vscode)).toBe(2);

    // 若此刻切项目但 B 的回包还没到：开关不得继续显示 A 的勾选（按未加载禁用）
    await expect.poll(() => sddSwitch()?.disabled).toBe(true);
    expect(sddSwitch()!.checked).toBe(false);

    // B 回包（未启用）→ 开关未勾选且可用
    sendCommand("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: {},
    });
    await expect.poll(() => sddSwitch()?.disabled).toBe(false);
    expect(sddSwitch()!.checked).toBe(false);

    // 迟到的 A 旧回包（归属不匹配）→ 被归属守卫丢弃，不得把开关翻回勾选。
    // 原文在这里 `waitForTimeout(150)`：给守卫一个「本会生效」的窗口，才验得出
    // 它真的被丢掉（守卫是同步判定的，窗口只为覆盖 React 刷新）。
    sendCommand("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sddSwitch()!.checked).toBe(false);
    await expect.poll(() => sddSwitch()?.disabled).toBe(false);
  });

  it("切回项目 A 时重新显示 A 的 SDD 值（往返切换不残留）", async () => {
    await page.viewport(1280, 800);
    await setupFocusedOnA();
    await openSettings();
    await enterProjectSettings();

    sendCommand("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await expect.poll(() => sddSwitch()?.checked).toBe(true);

    // A → B
    focusProjectB();
    sendCommand("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: { "sdd@builtin": false },
    });
    await expect.poll(() => sddSwitch()?.checked).toBe(false);

    // B → A（recents 头一直是 A；切回靠 host.workdir 变化）
    sendCommand("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    sendCommand("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    sendCommand("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await expect.poll(() => sddSwitch()?.checked).toBe(true);
    expect(sddSwitch()!.disabled).toBe(false);
  });

  it("点击开关按当前项目 scope 提交（切到 B 后点击仍 post setBuiltinPluginEnabled project）", async () => {
    await page.viewport(1280, 800);
    const vscode = await setupFocusedOnA();
    await openSettings();
    await enterProjectSettings();

    focusProjectB();
    // 切项目后必须等 webview 认下新「当前项目」再注入回包：settingsWorkdir 的
    // ref 同步在 passive effect 里，紧接着注入的回包会撞上旧身份被归属守卫当过期
    // 丢弃且不会重发，开关恒禁用（真机不会——host 只在 webview 按新 workdir 重拉
    // 后才回包）。重拉本身即「已切项目」的信号。
    await expect.poll(() => projectSettingsRequests(vscode)).toBe(2);
    sendCommand("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: {},
    });
    await expect.poll(() => sddSwitch()?.disabled).toBe(false);

    // 原文 `clearMessageLog()` —— 记下此刻的条数，之后只看切片。
    const mark = sentCommands(vscode).length;

    // 复选框本体 opacity:0，用户点的是样式化外层（与原文同一处）。
    const label = sddSwitch()!.closest(".settings-switch");
    expect(label).toBeTruthy();
    await userEvent.click(label!);

    await expect
      .poll(() => postedSince(vscode, mark, "setBuiltinPluginEnabled"))
      .toMatchObject({
        command: "setBuiltinPluginEnabled",
        pluginId: "sdd@builtin",
        enabled: true,
        scope: "project",
      });
  });

  it("个性化 → 项目级 AGENTS.md：关闭重开设置后按当前项目重读，不残留上一项目内容", async () => {
    await page.viewport(1280, 800);
    const vscode = await setupFocusedOnA();

    // 第一次打开：项目 A。项目级 tab 请求 A 的文件
    await openSettings();
    await clickNavItem("个性化");
    await userEvent.click(screen.getByRole("tab", { name: "项目级" }));

    await expect
      .poll(() => projectAgentsRequest(vscode))
      .toMatchObject({
        command: "getAgentsContent",
        scope: "project",
        workdir: DIR_A,
      });

    sendCommand("agentsContentResponse", {
      scope: "project",
      content: "# 项目 A 规范\n",
    });
    const editorValue = () =>
      (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value;
    await expect.poll(editorValue).toBe("# 项目 A 规范\n");

    // 关闭设置 → 聚焦切到项目 B（缓存须在每次打开时重置，否则继续显示 A）
    await closeSettings();
    focusProjectB();
    const mark = sentCommands(vscode).length;

    await openSettings();
    await clickNavItem("个性化");
    await userEvent.click(screen.getByRole("tab", { name: "项目级" }));

    // 重开后按当前项目 B 请求，workdir 归属键必须是 B
    await expect
      .poll(() => projectAgentsRequest(vscode, mark))
      .toMatchObject({
        command: "getAgentsContent",
        scope: "project",
        workdir: DIR_B,
      });

    sendCommand("agentsContentResponse", {
      scope: "project",
      content: "# 项目 B 规范\n",
    });
    // 修复前：编辑器缓存不失效 → 仍显示 A 的内容，断言先红
    await expect.poll(editorValue).toBe("# 项目 B 规范\n");
  });
});
