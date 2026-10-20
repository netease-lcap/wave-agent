import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import React from "react";
import { PreviewPane } from "../../src/components/PreviewPane";

/**
 * 预览窗口「发布为 Artifact」（spec desktop/desktop-artifacts.md「预览窗口发布
 * 为 artifact」）：只有本地 .html/.htm 预览出按钮；确认后发
 * `desktopArtifactPublish`；回包成功出轻提示、401 提示先登录、409 给「强制覆盖」。
 */

vi.mock("../../src/styles/DesktopApp.css", () => ({}));

const URL_UNDER_TEST = "http://127.0.0.1:53001/index.html";

function renderPane(options: { filePath?: string; url?: string } = {}) {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  render(
    <PreviewPane
      url={options.url ?? URL_UNDER_TEST}
      vscode={vscode as never}
      width={640}
      filePath={options.filePath ?? "/repo/index.html"}
    />,
  );
  return vscode;
}

const sent = (vscode: { postMessage: ReturnType<typeof vi.fn> }) =>
  vscode.postMessage.mock.calls.map(([msg]) => msg as Record<string, unknown>);

const publishRequest = (vscode: { postMessage: ReturnType<typeof vi.fn> }) =>
  [...sent(vscode)]
    .reverse()
    .find((m) => m.command === "desktopArtifactPublish");

const reply = (message: Record<string, unknown>) => {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: message }));
  });
};

const openDialog = () => {
  fireEvent.click(screen.getByTestId("preview-publish"));
  expect(screen.getByTestId("preview-publish-dialog")).toBeInTheDocument();
};

beforeEach(() => {
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
});

describe("预览窗口发布为 Artifact", () => {
  it("本地 HTML 文件预览出「发布」，点了先给确认弹层", () => {
    const vscode = renderPane();
    openDialog();
    expect(screen.getByText(/发布后会在创作集列表中展示/)).toBeInTheDocument();
    // 只是弹层，还没发请求
    expect(publishRequest(vscode)).toBeUndefined();
  });

  it("确认后发 desktopArtifactPublish，标题取文件名", () => {
    const vscode = renderPane();
    openDialog();
    fireEvent.click(screen.getByTestId("preview-publish-confirm"));

    expect(publishRequest(vscode)).toMatchObject({
      command: "desktopArtifactPublish",
      filePath: "/repo/index.html",
      title: "index.html",
      force: false,
    });
  });

  it("成功后弹层关闭并出现「已发布」轻提示（含打开链接）", () => {
    const vscode = renderPane();
    openDialog();
    fireEvent.click(screen.getByTestId("preview-publish-confirm"));
    const req = publishRequest(vscode);

    reply({
      command: "desktopArtifactPublish",
      requestId: req?.requestId,
      ok: true,
      url: "https://codechat.test/code/artifact/abc",
      slug: "abc",
    });

    expect(
      screen.queryByTestId("preview-publish-dialog"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("preview-publish-toast")).toHaveTextContent(
      "已发布",
    );
    fireEvent.click(screen.getByText("打开"));
    expect(sent(vscode)).toContainEqual({
      command: "openExternal",
      url: "https://codechat.test/code/artifact/abc",
    });
  });

  it("未登录（authRequired）就地提示先登录，不静默成功", () => {
    const vscode = renderPane();
    openDialog();
    fireEvent.click(screen.getByTestId("preview-publish-confirm"));
    const req = publishRequest(vscode);

    reply({
      command: "desktopArtifactPublish",
      requestId: req?.requestId,
      authRequired: true,
      error: "authentication failed (HTTP 401)",
    });

    expect(screen.getByTestId("preview-publish-error")).toHaveTextContent(
      "请先登录后再发布",
    );
    expect(
      screen.queryByTestId("preview-publish-toast"),
    ).not.toBeInTheDocument();
  });

  it("版本冲突（409）给「强制覆盖」，点了带 force 重发", () => {
    const vscode = renderPane();
    openDialog();
    fireEvent.click(screen.getByTestId("preview-publish-confirm"));
    const first = publishRequest(vscode);

    reply({
      command: "desktopArtifactPublish",
      requestId: first?.requestId,
      conflict: true,
      error: "a newer version exists",
    });

    expect(screen.getByTestId("preview-publish-error")).toHaveTextContent(
      "a newer version exists",
    );
    fireEvent.click(screen.getByTestId("preview-publish-force"));
    expect(publishRequest(vscode)).toMatchObject({ force: true });
  });

  it("localhost dev server 页面不给「发布」", () => {
    renderPane({ filePath: "" });
    expect(screen.queryByTestId("preview-publish")).not.toBeInTheDocument();
  });

  it("非 HTML 文件不给「发布」", () => {
    renderPane({ filePath: "/repo/notes.md" });
    expect(screen.queryByTestId("preview-publish")).not.toBeInTheDocument();
  });
});
