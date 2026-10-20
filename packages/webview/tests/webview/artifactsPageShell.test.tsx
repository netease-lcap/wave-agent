/**
 * 创作集整页与桌面壳的接线（spec desktop/desktop-artifacts.md 场景 1/9）：
 * 侧边栏入口 → 整页替换会话区（侧栏保留、当前对话不销毁）、入口高亮、返回
 * 回到会话视图、再次点击入口关闭、与插件市场/活动看板互斥。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import { createMockVscode, sendCommand } from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));
vi.mock("../../src/styles/SessionBoard.css", () => ({}));
vi.mock("../../src/styles/ArtifactsPage.css", () => ({}));
vi.mock("../../src/styles/PluginMarketPage.css", () => ({}));
vi.mock("../../src/styles/SettingsPage.css", () => ({}));

function renderReady() {
  const vscode = createMockVscode();
  render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: ["/work/a"],
  });
  sendCommand("setInitialState", { messages: [] });
  sendCommand("desktopSessionTree", {
    groups: [
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
    ],
  });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "s1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  return vscode;
}

describe("创作集整页（侧边栏入口）", () => {
  it("点入口打开整页：侧栏保留、当前对话仍选中，返回后回到会话视图", () => {
    renderReady();
    const entry = screen.getByTestId("desktop-artifacts");

    fireEvent.click(entry);
    expect(screen.getByTestId("artifacts-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-container")).not.toBeInTheDocument();
    expect(screen.getByTestId("desktop-sidebar")).toBeInTheDocument();
    expect(entry).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("desktop-session-item-s1").className).toContain(
      "desktop-session-item--current",
    );

    fireEvent.click(screen.getByTestId("artifacts-back"));
    expect(screen.queryByTestId("artifacts-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
    expect(entry).not.toHaveAttribute("aria-pressed", "true");
  });

  it("再次点击入口关闭整页（开关语义）", () => {
    renderReady();
    const entry = screen.getByTestId("desktop-artifacts");

    fireEvent.click(entry);
    expect(screen.getByTestId("artifacts-page")).toBeInTheDocument();
    fireEvent.click(entry);
    expect(screen.queryByTestId("artifacts-page")).not.toBeInTheDocument();
  });

  it("打开创作集只拉一次列表：切会话不重新拉取（场景 9）", async () => {
    const vscode = renderReady();
    fireEvent.click(screen.getByTestId("desktop-artifacts"));

    const listCalls = () =>
      vscode.postMessage.mock.calls.filter(
        ([msg]) => msg.command === "desktopArtifactsList",
      ).length;
    expect(listCalls()).toBe(1);

    await act(async () => {
      sendCommand("desktopSessionTree", {
        groups: [
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
              {
                sessionId: "s2",
                title: "chat two",
                lastActiveAt: Date.now(),
                hasWorktree: false,
              },
            ],
          },
        ],
      });
    });

    // 页面保持打开（整页与当前会话无关），也不因快照更新重拉
    expect(screen.getByTestId("artifacts-page")).toBeInTheDocument();
    expect(listCalls()).toBe(1);
  });

  it("选模板 → 请求宿主「新建会话并预填提示词」", () => {
    const vscode = renderReady();
    fireEvent.click(screen.getByTestId("desktop-artifacts"));
    fireEvent.click(screen.getByTestId("artifacts-new"));
    fireEvent.click(screen.getByTestId("artifacts-template-game"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopArtifactsNewFromTemplate",
        prompt: expect.stringContaining("帮我做一个网页小游戏"),
      }),
    );
    // 选完模板回到会话视图（新会话由宿主建好后到来）
    expect(screen.queryByTestId("artifacts-page")).not.toBeInTheDocument();
    expect(screen.getByTestId("chat-container")).toBeInTheDocument();
  });
});
