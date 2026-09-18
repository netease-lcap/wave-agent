/**
 * 插件市场整页（spec ecosystem/plugin.md「插件市场」场景 1/2）：
 * 侧边栏「新对话」下方的入口 → 整页视图替换会话区（侧边栏保留、当前对话仍保持
 * 选中态）、入口开关与高亮、「返回当前会话」返回、与「活动」看板互斥（后开者优先）、
 * 两处入口渲染同一视图。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));
vi.mock("../../src/styles/PluginMarketPage.css", () => ({}));
vi.mock("../../src/styles/SettingsPage.css", () => ({}));

// 与 sessionBoard.test.tsx 同构的 DesktopApp 全流程渲染：workdir → 会话树。
function renderReady(groups: unknown) {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("setInitialState", { messages: [] });
  sendCommand("desktopSessionTree", { groups });
  return vscode;
}

const GROUPS = [
  {
    host: "local",
    workdir: "/work/a",
    sessions: [
      {
        sessionId: "s1",
        title: "chat one",
        lastActiveAt: Date.now(),
        hasWorktree: false,
      },
    ],
  },
];

/** host 回发两份列表——整页形态下视图也要能正常出内容（复用设置页那份视图）。 */
async function pushPlugins() {
  await act(async () => {
    sendCommand("listMarketplacesResponse", {
      marketplaces: [{ name: "wave-plugins-official" }],
    });
    sendCommand("listPluginsResponse", {
      // 锚点工程（spec A-018）：宿主回带当前工程，弹窗的 project / local 两档据此
      // 标明写进哪个工程
      anchorWorkdir: "/work/a",
      plugins: [
        {
          id: "git-workflow@wave-plugins-official",
          name: "Git Workflow",
          description: "集成 Git 工作流",
          marketplace: "wave-plugins-official",
          installed: false,
          latestVersion: "2.3.1",
        },
      ],
    });
  });
}

describe("插件市场整页（侧边栏入口）", () => {
  it("入口在「新对话」下方：点击打开整页，侧边栏保留，返回当前会话回到会话视图", async () => {
    renderReady(GROUPS);
    // 聚焦分屏绑着 s1（真宿主 pushPanes 带 sessionId）→ s1 是「当前对话」
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "s1", host: "local", row: 0 }],
      focusedPaneId: "pane-1",
    });
    const entry = screen.getByTestId("desktop-plugin-market");

    // 「新对话」下方 = 会话树之前（spec 场景 1 的位置要求）
    expect(
      screen.getByTestId("desktop-new-session").compareDocumentPosition(entry) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      entry.compareDocumentPosition(
        screen.getByTestId("desktop-session-tree"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(entry);
    expect(screen.getByTestId("plugin-market-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).not.toBeInTheDocument();
    // 侧边栏保留（整页只替换会话区，不像设置页那样盖住整个窗口）
    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    // 入口高亮
    expect(entry).toHaveAttribute("aria-pressed", "true");
    // 整页只替换会话区：当前对话仍保持常态选中样式，不因进入整页而取消选中
    expect(screen.getByTestId("desktop-session-item-s1").className).toContain(
      "desktop-session-item--current",
    );

    // 内容区渲染的是与设置页同一份插件市场视图
    await pushPlugins();
    expect(screen.getByText("Git Workflow")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plugin-market-back"));
    expect(screen.queryByTestId("plugin-market-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    expect(entry).not.toHaveAttribute("aria-pressed", "true");
  });

  it("再次点击入口关闭整页（开关语义，spec 场景 2）", () => {
    renderReady(GROUPS);
    const entry = screen.getByTestId("desktop-plugin-market");

    fireEvent.click(entry);
    expect(screen.getByTestId("plugin-market-page")).toBeInTheDocument();

    fireEvent.click(entry);
    expect(screen.queryByTestId("plugin-market-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });

  it("整页打开期间从侧边栏选中另一条对话：整页关闭并切到该对话（spec 场景 2）", async () => {
    const vscode = renderReady([
      {
        ...GROUPS[0],
        sessions: [
          ...GROUPS[0].sessions,
          {
            sessionId: "s2",
            title: "chat two",
            lastActiveAt: Date.now(),
            hasWorktree: false,
          },
        ],
      },
    ]);
    sendCommand("desktopPanes", {
      panes: [{ paneId: "pane-1", sessionId: "s1", host: "local", row: 0 }],
      focusedPaneId: "pane-1",
    });

    fireEvent.click(screen.getByTestId("desktop-plugin-market"));
    expect(screen.getByTestId("plugin-market-page")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-session-main-s2"));
    });

    // 插件视图以「打开时的当前工程」为锚点，切对话必先离开整页——否则锚点在页面
    // 停留期间被换掉，列表快照与随后的写操作就不是同一个工程了（A-018）
    expect(screen.queryByTestId("plugin-market-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "desktopSelectSession",
      workdir: "/work/a",
      sessionId: "s2",
    });
  });

  it("整页入口同样「打开界面即刷新清单」（A-013）：刷完收起「检查更新中…」", async () => {
    const vscode = renderReady(GROUPS);
    fireEvent.click(screen.getByTestId("desktop-plugin-market"));

    // 入口从设置页换成侧边栏整页，刷新时机不变：打开界面即触发一次只拉检出的刷新
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "refreshMarketplaces",
    });

    await act(async () => {
      sendCommand("listMarketplacesResponse", {
        marketplaces: [{ name: "wave-plugins-official" }],
      });
      sendCommand("listPluginsResponse", {
        anchorWorkdir: "/work/a",
        plugins: [
          {
            id: "code-reviewer@wave-plugins-official",
            name: "Code Reviewer",
            marketplace: "wave-plugins-official",
            installed: true,
            version: "3.1.2",
            latestVersion: "3.1.2",
            scope: "user",
          },
        ],
      });
    });

    // 刷新未完成：清单是进入前那份（已装 = 最新，没有「更新」），界面给出轻量提示
    expect(screen.getByText("检查更新中…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).toBeNull();

    // 宿主刷新结束、带 refreshed 标记补发最新清单 → 版本对比可达、提示收起
    await act(async () => {
      sendCommand("listPluginsResponse", {
        anchorWorkdir: "/work/a",
        refreshed: true,
        plugins: [
          {
            id: "code-reviewer@wave-plugins-official",
            name: "Code Reviewer",
            marketplace: "wave-plugins-official",
            installed: true,
            version: "3.1.2",
            latestVersion: "3.2.0",
            scope: "user",
          },
        ],
      });
    });
    expect(screen.queryByText("检查更新中…")).toBeNull();
    expect(screen.getByRole("button", { name: "更新" })).toBeInTheDocument();
  });

  it("与「活动」看板互斥：后开者优先（spec 场景 1）", () => {
    renderReady(GROUPS);

    // 先看板 → 再开插件市场：看板让位
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.getByTestId("session-board")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("desktop-plugin-market"));
    expect(screen.queryByTestId("session-board")).not.toBeInTheDocument();
    expect(screen.getByTestId("plugin-market-page")).toBeInTheDocument();

    // 再点「活动」：插件市场让位、看板回归
    fireEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    expect(screen.queryByTestId("plugin-market-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-board")).toBeInTheDocument();
    expect(screen.getByTestId("desktop-plugin-market")).not.toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
