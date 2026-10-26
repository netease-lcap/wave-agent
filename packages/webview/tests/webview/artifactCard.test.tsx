import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import React from "react";
import { Message } from "../../src/components/Message";
import { ARTIFACT_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message as MessageType } from "wave-agent-sdk";

/**
 * 对话里的 artifact 卡片（PM 3500358560332032）：Artifact 工具发布成功时，
 * 工具块渲染成一张卡片，卡片上只有「在浏览器中打开」——artifact 只有 URL，
 * 本地没有文件。其它 action（list / read / 评论）保持文本渲染。
 *
 * 形态与 Bash 一致：工具行（绿点 + 工具名 + 参数摘要）保留在卡片上方，
 * 卡片作为这一块的内容挂在下面，而不是顶掉整行。
 */

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

interface BlockOptions {
  stage?: "streaming" | "end";
  metadata?: Record<string, unknown>;
  compactParams?: string;
  shortResult?: string;
  error?: string;
}

const artifactMessage = ({
  stage = "end",
  metadata,
  compactParams = "pages/index.html → https://codechat.test/code/artifact/abc",
  shortResult = "Published pages/index.html → https://codechat.test/code/artifact/abc",
  error,
}: BlockOptions = {}): MessageType =>
  ({
    id: "m1",
    role: "assistant",
    content: "",
    blocks: [
      {
        type: "tool",
        id: "b1",
        name: ARTIFACT_TOOL_NAME,
        stage,
        success: !error,
        error,
        parameters: JSON.stringify({
          action: "publish",
          file_path: "pages/index.html",
        }),
        compactParams,
        shortResult,
        metadata,
      },
    ],
  }) as unknown as MessageType;

const renderArtifact = (options: BlockOptions = {}) => {
  const vscode = { postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() };
  render(
    <Message
      message={artifactMessage(options)}
      vscode={vscode as never}
      workdir="/repo"
    />,
  );
  return { vscode };
};

const PUBLISHED_METADATA = {
  artifactUrl: "https://codechat.test/code/artifact/abc",
  artifactTitle: "运营活动原型",
  artifactVersion: "3",
};

describe("artifact 卡片", () => {
  it("发布成功 → 卡片显示标题与版本，只有一个「在浏览器中打开」动作", () => {
    renderArtifact({ metadata: PUBLISHED_METADATA });

    expect(screen.getByTestId("artifact-card")).toBeInTheDocument();
    expect(screen.getByText("运营活动原型")).toBeInTheDocument();
    expect(screen.getByText("已发布 · v3")).toBeInTheDocument();
    // 只有一个动作：没有下拉菜单。
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
  });

  it("保留工具行（工具名 + 参数摘要），卡片挂在其下方", () => {
    renderArtifact({ metadata: PUBLISHED_METADATA });

    const header = document.querySelector(".tool-container > .tool-block");
    const card = screen.getByTestId("artifact-card");

    // 与 Bash 同一形态：头部一行 + 内容挂在下面，工具行不能被卡片顶掉。
    expect(header).toBeInTheDocument();
    expect(header).toHaveTextContent(ARTIFACT_TOOL_NAME);
    expect(header?.querySelector(".compact-params")).toHaveTextContent(
      "pages/index.html",
    );
    expect(
      header!.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("点「在浏览器中打开」→ 发 openExternal，url 取 metadata", () => {
    const { vscode } = renderArtifact({ metadata: PUBLISHED_METADATA });

    fireEvent.click(screen.getByTestId("artifact-card-open"));

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openExternal",
      url: "https://codechat.test/code/artifact/abc",
    });
  });

  it("缺 artifactTitle 时用 URL 兜底，缺 version 时副信息只写「已发布」", () => {
    renderArtifact({
      metadata: { artifactUrl: "https://codechat.test/code/artifact/abc" },
    });

    expect(
      screen.getByText("https://codechat.test/code/artifact/abc"),
    ).toBeInTheDocument();
    expect(screen.getByText("已发布")).toBeInTheDocument();
  });

  it("没有 metadata（list / read / 评论等 action）保持文本渲染，不出卡片", () => {
    renderArtifact({ shortResult: "Listed 1 artifact (scope: mine)" });

    expect(screen.queryByTestId("artifact-card")).not.toBeInTheDocument();
    expect(
      screen.getByText("Listed 1 artifact (scope: mine)"),
    ).toBeInTheDocument();
  });

  it("流式中的块不出卡片；失败的发布出错误而不是卡片", () => {
    renderArtifact({ stage: "streaming", metadata: PUBLISHED_METADATA });
    expect(screen.queryByTestId("artifact-card")).not.toBeInTheDocument();

    renderArtifact({
      metadata: PUBLISHED_METADATA,
      error: "Artifact: authentication failed (HTTP 401)",
    });
    expect(screen.queryByTestId("artifact-card")).not.toBeInTheDocument();
    expect(
      screen.getByText("Artifact: authentication failed (HTTP 401)"),
    ).toBeInTheDocument();
  });
});
