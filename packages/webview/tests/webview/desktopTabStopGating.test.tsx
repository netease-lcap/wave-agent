import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { WRITE_TOOL_NAME, BASH_TOOL_NAME } from "wave-agent-sdk";
import { Message } from "../../src/components/Message";
import { WriteToolPreview } from "../../src/components/WriteToolPreview";
import { MockDataGenerator } from "../fixtures/mockData";
import type { ToolBlock } from "../../src/types";

// Mermaid is heavy and irrelevant here; stub it out (same as markdownSanitize).
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

// 新增的可聚焦滚动区（代码块 pre / 表格滚动容器 / bash 输出 / 写入预览）只在
// 桌面宿主注入 tabindex：焦点环样式只写在 host-desktop.css 的 `[data-host="desktop"]`
// 层，IDE 宿主注入后拿不到可见焦点，只会凭白多出 Tab 停靠点（WCAG 2.4.3）。
// 结构变化（表格包裹层）与真无障碍改进（checkbox aria-label）两端都保留。
const MARKDOWN = [
  "- [x] 已完成条目",
  "- [ ] 未完成条目",
  "```js\nconst x = 1;\n```",
  "| 名称 | 数量 |\n| --- | --- |\n| a | 1 |",
].join("\n\n");

const renderMessage = () =>
  render(
    <Message
      message={MockDataGenerator.createAssistantMessage(MARKDOWN)}
      vscode={{ postMessage: vi.fn(), getState: vi.fn(), setState: vi.fn() }}
    />,
  );

describe("桌面端专属 tab stop gating", () => {
  afterEach(() => {
    delete window.waveHostType;
  });

  describe("Message markdown", () => {
    it("桌面宿主：代码块 pre 与表格滚动容器可键盘聚焦", () => {
      window.waveHostType = "desktop";
      const { container } = renderMessage();

      expect(
        container.querySelector('.markdown-content pre[tabindex="0"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('.md-table-scroll[tabindex="0"]'),
      ).not.toBeNull();
    });

    it("IDE 宿主：不注入 tabindex，但保留表格包裹层与 checkbox 可访问名", () => {
      const { container } = renderMessage();

      expect(container.querySelector(".markdown-content pre")).not.toBeNull();
      expect(
        container.querySelector(".markdown-content pre[tabindex]"),
      ).toBeNull();
      // 包裹层是结构变化（F-06），两端都保留——只是不加 tab stop
      const wrapper = container.querySelector(".md-table-scroll");
      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute("tabindex")).toBeNull();
      // 真无障碍改进不受 gate 影响
      const checkbox = container.querySelector(
        '.markdown-content input[type="checkbox"]',
      );
      expect(checkbox?.getAttribute("aria-label")).toBe("已完成");
    });
  });

  describe("WriteToolPreview", () => {
    const block = {
      type: "tool",
      name: WRITE_TOOL_NAME,
      parameters: JSON.stringify({ file_path: "/a/b.md", content: "l1\nl2" }),
      stage: "end",
      success: true,
      shortResult: "File created",
      id: "write_1",
    } as unknown as ToolBlock;

    const renderPreview = () =>
      render(
        <WriteToolPreview
          toolBlock={block}
          vscode={{ postMessage: vi.fn() }}
        />,
      );

    it("桌面宿主：写入预览滚动区可键盘聚焦", () => {
      window.waveHostType = "desktop";
      const { container } = renderPreview();
      expect(
        container.querySelector('.write-preview-scroll[tabindex="0"]'),
      ).not.toBeNull();
    });

    it("IDE 宿主：写入预览滚动区不加 tab stop", () => {
      const { container } = renderPreview();
      expect(container.querySelector(".write-preview-scroll")).not.toBeNull();
      expect(
        container.querySelector(".write-preview-scroll[tabindex]"),
      ).toBeNull();
    });
  });

  describe("bash 命令输出", () => {
    const renderBash = () =>
      render(
        <Message
          message={MockDataGenerator.createAssistantMessageWithTool(
            "",
            BASH_TOOL_NAME,
            JSON.stringify({ command: "ls -la" }),
            "total 0",
          )}
          vscode={{
            postMessage: vi.fn(),
            getState: vi.fn(),
            setState: vi.fn(),
          }}
        />,
      );

    it("桌面宿主：输出区可键盘聚焦", () => {
      window.waveHostType = "desktop";
      const { container } = renderBash();
      expect(
        container.querySelector('.bash-command-output[tabindex="0"]'),
      ).not.toBeNull();
    });

    it("IDE 宿主：输出区不加 tab stop", () => {
      const { container } = renderBash();
      expect(container.querySelector(".bash-command-output")).not.toBeNull();
      expect(
        container.querySelector(".bash-command-output[tabindex]"),
      ).toBeNull();
    });
  });
});
