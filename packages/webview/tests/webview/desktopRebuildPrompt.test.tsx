/**
 * 插件变更重建确认框（desktop 专属，spec core/agent-config.md
 * 「配置变更的构造期副作用与重建」场景 4/6）：
 * host 推 `desktopRebuildPrompt {total, busy}` → 弹两按钮确认框（立即重启 /
 * 稍后重启，`Esc` 等同「稍后重启」，无「取消」），选择后回
 * `desktopRebuildDecision {restart}`。
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { DesktopApp } from "../../src/components/DesktopApp";
import {
  createMockVscode,
  sendCommand,
  sendHostMessage,
  fixtures,
} from "./test-utils";

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

/** 渲染桌面根（已选 workdir），并推一个重建确认框。 */
function renderWithPrompt(total: number, busy: number) {
  const vscode = createMockVscode();
  const result = render(<DesktopApp vscode={vscode} />);
  sendCommand("desktopWorkdirState", {
    workdir: "/work/a",
    recentWorkdirs: [],
    host: "local",
  });
  sendCommand("desktopPanes", {
    panes: [{ paneId: "pane-1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  act(() => {
    sendHostMessage(fixtures.desktopRebuildPrompt({ total, busy }));
  });
  return { ...result, vscode };
}

describe("desktopRebuildPrompt", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the N/M copy with 立即重启 / 稍后重启 and no 取消", () => {
    renderWithPrompt(3, 1);

    expect(
      screen.getByText("插件变更需要重启对话才能生效。"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("将重启 3 个对话，其中 1 个正在执行任务暂不重启。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("confirm-dialog-confirm")).toHaveTextContent(
      "立即重启",
    );
    expect(screen.getByTestId("confirm-dialog-cancel")).toHaveTextContent(
      "稍后重启",
    );
    expect(screen.queryByText("取消")).not.toBeInTheDocument();
  });

  it("posts restart:true and closes on 立即重启", () => {
    const { vscode } = renderWithPrompt(2, 0);
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("confirm-dialog-confirm"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopRebuildDecision",
        restart: true,
      }),
    );
    expect(
      screen.queryByText("插件变更需要重启对话才能生效。"),
    ).not.toBeInTheDocument();
  });

  it("posts restart:false and closes on 稍后重启", () => {
    const { vscode } = renderWithPrompt(2, 2);
    vscode.postMessage.mockClear();

    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopRebuildDecision",
        restart: false,
      }),
    );
    expect(
      screen.queryByText("插件变更需要重启对话才能生效。"),
    ).not.toBeInTheDocument();
  });

  it("treats Esc as 稍后重启 (never as a silent restart)", () => {
    const { vscode } = renderWithPrompt(1, 1);
    vscode.postMessage.mockClear();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "desktopRebuildDecision",
        restart: false,
      }),
    );
    expect(
      screen.queryByText("插件变更需要重启对话才能生效。"),
    ).not.toBeInTheDocument();
  });
});
