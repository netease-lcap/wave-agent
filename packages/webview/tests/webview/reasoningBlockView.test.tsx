import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ReasoningBlockView } from "../../src/components/ReasoningBlockView";
import type { ReasoningBlock } from "../../src/types";

const renderContent = (content: string) => <div className="rc">{content}</div>;

describe("ReasoningBlockView", () => {
  // 网关偶发只给一个 "\n" 作为 reasoning_content（模型报了 reasoning_tokens
  // 却没给真实文本，见 docs/specs/core/stream-content-updates.md「思考用时
  // 展示」）。Message.renderBlock 已经在调用这个组件前过滤掉了，这里是第二
  // 道防线：任何忘记做那层判空的调用方，也不会渲染出一个没有内容的折叠壳。
  it("renders nothing when content is whitespace-only", () => {
    const block = {
      type: "reasoning",
      content: "\n",
      stage: "end",
      startTime: 1000,
      endTime: 2000,
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    expect(container.querySelector(".reasoning-block")).not.toBeInTheDocument();
  });

  it("renders nothing when content is an empty string", () => {
    const block = {
      type: "reasoning",
      content: "",
      stage: "streaming",
      startTime: 1000,
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    expect(container.querySelector(".reasoning-block")).not.toBeInTheDocument();
  });

  // 生成中固定为一行「标题 + 尾部」：默认收起、没有正文、没有折叠箭头、
  // 不是可切换的按钮。这条行为是「行高永不跳动」的前提（见 spec
  // core/stream-content-updates.md「思考块全程收起 + 流式尾部」）。
  it("renders a single collapsed header with a tail while streaming", () => {
    const block = {
      type: "reasoning",
      content: "thinking hard",
      stage: "streaming",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    const header = container.querySelector(".reasoning-header") as HTMLElement;
    expect(header.tagName).not.toBe("BUTTON");
    expect(header).toHaveClass("reasoning-header--static");
    expect(header).not.toHaveAttribute("aria-expanded");
    expect(container.querySelector(".reasoning-dot")).toBeInTheDocument();
    expect(container.querySelector(".reasoning-title")).toHaveTextContent(
      "思考",
    );
    expect(
      container.querySelector(".reasoning-chevron"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".reasoning-tail")).toHaveTextContent(
      "thinking hard",
    );
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("does not expand while streaming even if the header is clicked", async () => {
    const user = userEvent.setup();
    const block = {
      type: "reasoning",
      content: "streaming thoughts",
      stage: "streaming",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    await user.click(
      container.querySelector(".reasoning-header") as HTMLElement,
    );
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("shows the last 30 characters of the tail, newlines flattened", () => {
    const head = "开头".repeat(20);
    const block = {
      type: "reasoning",
      content: `${head}\n第一行\n第二行 ${"尾".repeat(20)}`,
      stage: "streaming",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    const tail = container.querySelector(".reasoning-tail") as HTMLElement;
    const expected = `${head}\n第一行\n第二行 ${"尾".repeat(20)}`
      .replace(/\n/g, "\\n")
      .slice(-30);
    expect(tail.textContent).toBe(`…${expected}`);
  });

  it("grows the tail as more content streams in", () => {
    const first = {
      type: "reasoning",
      content: "step one",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={first} renderContent={renderContent} />,
    );
    expect(container.querySelector(".reasoning-tail")).toHaveTextContent(
      "step one",
    );

    const second = {
      type: "reasoning",
      content: "step one, step two",
      stage: "streaming",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={second} renderContent={renderContent} />,
    );
    expect(container.querySelector(".reasoning-tail")).toHaveTextContent(
      "step one, step two",
    );
  });

  it("drops the tail and becomes togglable once the block finishes", async () => {
    const user = userEvent.setup();
    const streaming = {
      type: "reasoning",
      content: "live",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={streaming} renderContent={renderContent} />,
    );
    expect(container.querySelector(".reasoning-tail")).toBeInTheDocument();

    const ended = {
      type: "reasoning",
      content: "live",
      stage: "end",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );

    expect(container.querySelector(".reasoning-tail")).not.toBeInTheDocument();
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
    const header = container.querySelector(".reasoning-header") as HTMLElement;
    expect(header.tagName).toBe("BUTTON");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );

    // Togglable now: click opens the full trace, click again closes it.
    await user.click(header);
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "live",
    );
    expect(header).toHaveAttribute("aria-expanded", "true");
    await user.click(header);
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("starts collapsed when mounted already finished (e.g. loaded from history)", () => {
    const block = {
      type: "reasoning",
      content: "past thoughts",
      stage: "end",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
    expect(container.querySelector(".reasoning-tail")).not.toBeInTheDocument();
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
  });

  it("keeps a user-expanded block open when it re-renders as finished", async () => {
    const user = userEvent.setup();
    const ended = {
      type: "reasoning",
      content: "details",
      stage: "end",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );

    await user.click(
      container.querySelector(".reasoning-header") as HTMLElement,
    );
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    rerender(
      <ReasoningBlockView
        block={{ ...ended, endTime: 1234 } as ReasoningBlock}
        renderContent={renderContent}
      />,
    );
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "details",
    );
  });

  it("treats a block without stage as finished (legacy transcripts stay expandable)", async () => {
    const user = userEvent.setup();
    const block = {
      type: "reasoning",
      content: "legacy thoughts",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    const header = container.querySelector(".reasoning-header") as HTMLElement;
    expect(header.tagName).toBe("BUTTON");
    await user.click(header);
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "legacy thoughts",
    );
  });

  describe("elapsed time", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows final elapsed time when finished with start/end times", () => {
      const block = {
        type: "reasoning",
        content: "done",
        stage: "end",
        startTime: 1000,
        endTime: 16000,
      } as ReasoningBlock;
      const { container } = render(
        <ReasoningBlockView block={block} renderContent={renderContent} />,
      );

      expect(container.querySelector(".reasoning-title")).toHaveTextContent(
        "思考 (用时 15s)",
      );
    });

    it("shows only 思考 when startTime is missing", () => {
      const block = {
        type: "reasoning",
        content: "done",
        stage: "end",
        endTime: 16000,
      } as ReasoningBlock;
      const { container } = render(
        <ReasoningBlockView block={block} renderContent={renderContent} />,
      );

      const title = container.querySelector(".reasoning-title") as HTMLElement;
      expect(title).toHaveTextContent("思考");
      expect(title.textContent).not.toContain("用时");
    });

    it("shows only 思考 when endTime is earlier than startTime", () => {
      const block = {
        type: "reasoning",
        content: "done",
        stage: "end",
        startTime: 16000,
        endTime: 1000,
      } as ReasoningBlock;
      const { container } = render(
        <ReasoningBlockView block={block} renderContent={renderContent} />,
      );

      const title = container.querySelector(".reasoning-title") as HTMLElement;
      expect(title).toHaveTextContent("思考");
      expect(title.textContent).not.toContain("用时");
    });

    it("shows only 思考 when elapsed time rounds to 0s", () => {
      const block = {
        type: "reasoning",
        content: "done",
        stage: "end",
        startTime: 1000,
        endTime: 1000,
      } as ReasoningBlock;
      const { container } = render(
        <ReasoningBlockView block={block} renderContent={renderContent} />,
      );

      const title = container.querySelector(".reasoning-title") as HTMLElement;
      expect(title).toHaveTextContent("思考");
      expect(title.textContent).not.toContain("用时");
    });

    it("shows a growing 思考中 counter while in progress", () => {
      vi.useFakeTimers();
      vi.setSystemTime(1000);
      const block = {
        type: "reasoning",
        content: "live",
        stage: "streaming",
        startTime: 1000,
      } as ReasoningBlock;
      const { container } = render(
        <ReasoningBlockView block={block} renderContent={renderContent} />,
      );

      expect(container.querySelector(".reasoning-title")).toHaveTextContent(
        "思考中 0s",
      );

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(container.querySelector(".reasoning-title")).toHaveTextContent(
        "思考中 3s",
      );
    });
  });
});
