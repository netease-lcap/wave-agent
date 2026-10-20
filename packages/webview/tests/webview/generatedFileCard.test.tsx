import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { WRITE_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "wave-agent-sdk";

/**
 * 对话中的生成文件卡片（spec desktop/desktop-artifacts.md「对话中的生成文件
 * 卡片」）：Write 写出页面/文档 → 出卡片；卡片菜单三项分别走 openFile /
 * desktopOpenFileExternal / desktopRevealInFolder；点卡片外或 Esc 关闭菜单。
 */

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

const writeMessage = (
  filePath: string,
  stage: "streaming" | "end" = "end",
): MessageType =>
  ({
    id: "m1",
    role: "assistant",
    content: "",
    blocks: [
      {
        type: "tool",
        id: "b1",
        name: WRITE_TOOL_NAME,
        stage,
        success: true,
        parameters: JSON.stringify({
          file_path: filePath,
          content: "<h1>x</h1>",
        }),
      },
    ],
  }) as unknown as MessageType;

const renderWrite = (filePath: string, stage: "streaming" | "end" = "end") => {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  const onOpenFile = vi.fn();
  render(
    <Message
      message={writeMessage(filePath, stage)}
      vscode={vscode as never}
      workdir="/repo"
      onOpenFile={onOpenFile}
    />,
  );
  return { vscode, onOpenFile };
};

const posted = (vscode: { postMessage: ReturnType<typeof vi.fn> }) =>
  vscode.postMessage.mock.calls.map(([msg]) => msg as Record<string, unknown>);

beforeEach(() => {
  window.waveHostType = "desktop";
});

afterEach(() => {
  delete window.waveHostType;
});

describe("生成文件卡片", () => {
  it("页面文件写出后显示卡片（文件名 + 相对路径），不显示写入内容预览", () => {
    renderWrite("pages/index.html");
    expect(screen.getByTestId("generated-file-card")).toBeInTheDocument();
    expect(screen.getByText("index.html")).toBeInTheDocument();
    expect(screen.getByText("pages/index.html")).toBeInTheDocument();
  });

  it("流式中的块不出卡片（参数还不完整）", () => {
    renderWrite("pages/index.html", "streaming");
    expect(screen.queryByTestId("generated-file-card")).not.toBeInTheDocument();
  });

  it("菜单三项：打开文件 → onOpenFile(绝对路径)；在浏览器中打开 / 所在文件夹 → 桌面命令", () => {
    const { vscode, onOpenFile } = renderWrite("pages/index.html");

    fireEvent.click(screen.getByTestId("generated-file-card-toggle"));
    const menu = screen.getByTestId("generated-file-card-menu");
    expect(menu).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);

    fireEvent.click(screen.getByTestId("generated-file-open"));
    expect(onOpenFile).toHaveBeenCalledWith(
      "/repo/pages/index.html",
      undefined,
      undefined,
    );
    expect(
      screen.queryByTestId("generated-file-card-menu"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("generated-file-card-toggle"));
    fireEvent.click(screen.getByTestId("generated-file-open-browser"));
    expect(posted(vscode)).toContainEqual({
      command: "desktopOpenFileExternal",
      path: "/repo/pages/index.html",
    });

    fireEvent.click(screen.getByTestId("generated-file-card-toggle"));
    fireEvent.click(screen.getByTestId("generated-file-open-folder"));
    expect(posted(vscode)).toContainEqual({
      command: "desktopRevealInFolder",
      path: "/repo/pages/index.html",
    });
  });

  it("Esc 关闭菜单，且不触发卡片的其它动作", () => {
    const { vscode } = renderWrite("index.html");
    fireEvent.click(screen.getByTestId("generated-file-card-toggle"));
    expect(screen.getByTestId("generated-file-card-menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId("generated-file-card-menu"),
    ).not.toBeInTheDocument();
    expect(posted(vscode)).toHaveLength(0);
  });

  it("点卡片外关闭菜单", () => {
    renderWrite("index.html");
    fireEvent.click(screen.getByTestId("generated-file-card-toggle"));
    expect(screen.getByTestId("generated-file-card-menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(
      screen.queryByTestId("generated-file-card-menu"),
    ).not.toBeInTheDocument();
  });

  it("文档与源码不出卡片（保留写入内容预览，文档由文件面板打开）", () => {
    renderWrite("report.md");
    expect(screen.queryByTestId("generated-file-card")).not.toBeInTheDocument();
    cleanup();
    renderWrite("src/index.ts");
    expect(screen.queryByTestId("generated-file-card")).not.toBeInTheDocument();
  });

  it("非桌面宿主不出卡片（另两条动作是桌面端独有命令）", () => {
    delete window.waveHostType;
    renderWrite("index.html");
    expect(screen.queryByTestId("generated-file-card")).not.toBeInTheDocument();
  });
});
