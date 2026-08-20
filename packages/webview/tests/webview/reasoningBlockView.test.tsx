import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import React from "react";
import { ReasoningBlockView } from "../../src/components/ReasoningBlockView";
import type { ReasoningBlock } from "../../src/types";

const renderContent = (content: string) => <div className="rc">{content}</div>;

// 收起过渡时长（与组件内 COLLAPSE_TRANSITION_MS 一致），测试中推进假定时器模拟过渡结束。
const TRANSITION_MS = 200;

describe("ReasoningBlockView", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders content expanded by default", () => {
    const block = {
      type: "reasoning",
      content: "thinking hard",
      stage: "streaming",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    expect(container.querySelector(".reasoning-dot")).toBeInTheDocument();
    expect(container.querySelector(".reasoning-title")).toHaveTextContent(
      "思考",
    );
    expect(container.querySelector(".reasoning-chevron")).toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "thinking hard",
    );
  });

  it("collapses and expands when the header is clicked", () => {
    vi.useFakeTimers();
    const block = {
      type: "reasoning",
      content: "some thoughts",
      stage: "streaming",
    } as ReasoningBlock;
    const { container } = render(
      <ReasoningBlockView block={block} renderContent={renderContent} />,
    );

    const header = container.querySelector(".reasoning-header") as HTMLElement;

    // Collapse: 状态立即翻转，内容在 200ms 过渡期间保持挂载，之后卸载。
    act(() => {
      fireEvent.click(header);
    });
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-collapse")).not.toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();

    // Expand again: 内容先以 0fr 挂载，下一帧（rAF）翻转为展开态播放过渡。
    act(() => {
      fireEvent.click(header);
    });
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "some thoughts",
    );
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );

    act(() => {
      vi.advanceTimersByTime(20); // rAF 触发
    });
    expect(container.querySelector(".reasoning-chevron")).toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-collapse")).toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "some thoughts",
    );
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
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
  });

  it("auto-collapses once when stage transitions to end", () => {
    vi.useFakeTimers();
    const streaming = {
      type: "reasoning",
      content: "live",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={streaming} renderContent={renderContent} />,
    );
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    const ended = {
      type: "reasoning",
      content: "live",
      stage: "end",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );

    // 展示不足 1s：保持展开至满 1s 后才开始收起。
    expect(container.querySelector(".reasoning-chevron")).toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
    // 收起刚开始：内容仍挂载（200ms 过渡中）
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("collapses immediately when the block was already visible for at least 1s", () => {
    vi.useFakeTimers();
    const streaming = {
      type: "reasoning",
      content: "long thought",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={streaming} renderContent={renderContent} />,
    );

    // 模拟块已展示 1.5s（仍在流式阶段）
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    const ended = {
      type: "reasoning",
      content: "long thought",
      stage: "end",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );

    // 已满 1s → 立即开始收起（0ms 定时器）
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
    expect(container.querySelector(".reasoning-content")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("manual collapse during the pending auto-collapse wait cancels the wait", () => {
    vi.useFakeTimers();
    const streaming = {
      type: "reasoning",
      content: "quick",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={streaming} renderContent={renderContent} />,
    );

    const ended = {
      type: "reasoning",
      content: "quick",
      stage: "end",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );
    // 此刻待自动收起定时器（1000ms）尚未触发，仍处于展开态

    // 用户手动收起：立即生效，取消自动收起的等待
    act(() => {
      fireEvent.click(
        container.querySelector(".reasoning-header") as HTMLElement,
      );
    });
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );

    act(() => {
      vi.advanceTimersByTime(TRANSITION_MS);
    });
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();

    // 越过原定的自动收起时刻：不再有任何动作（无二次收起、无展开）
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(container.querySelector(".reasoning-chevron")).not.toHaveClass(
      "expanded",
    );
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();
  });

  it("lets the user re-expand after auto-collapse", () => {
    vi.useFakeTimers();
    const streaming = {
      type: "reasoning",
      content: "details",
      stage: "streaming",
    } as ReasoningBlock;
    const { container, rerender } = render(
      <ReasoningBlockView block={streaming} renderContent={renderContent} />,
    );

    const ended = {
      type: "reasoning",
      content: "details",
      stage: "end",
    } as ReasoningBlock;
    rerender(
      <ReasoningBlockView block={ended} renderContent={renderContent} />,
    );
    // 完成自动收起：1s 最短展示 + 200ms 过渡
    act(() => {
      vi.advanceTimersByTime(1000 + TRANSITION_MS);
    });
    expect(
      container.querySelector(".reasoning-content"),
    ).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(
        container.querySelector(".reasoning-header") as HTMLElement,
      );
    });
    act(() => {
      vi.advanceTimersByTime(20); // rAF 触发
    });
    expect(container.querySelector(".reasoning-content")).toHaveTextContent(
      "details",
    );
    expect(container.querySelector(".reasoning-chevron")).toHaveClass(
      "expanded",
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
