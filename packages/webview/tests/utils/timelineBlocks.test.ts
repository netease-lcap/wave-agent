import { describe, expect, it } from "vitest";
import type { MessageBlock } from "../../src/types";
import {
  countTimelineBlocks,
  isTimelineBlock,
  timelineBlockBounds,
} from "../../src/utils/timelineBlocks";

describe("isTimelineBlock", () => {
  it("compact/tool blocks always count, regardless of content", () => {
    expect(
      isTimelineBlock({ type: "compact", content: "" } as MessageBlock),
    ).toBe(true);
    expect(
      isTimelineBlock({ type: "tool", id: "t1" } as unknown as MessageBlock),
    ).toBe(true);
  });

  it("text blocks only count when they have non-whitespace content", () => {
    expect(
      isTimelineBlock({ type: "text", content: "hi" } as MessageBlock),
    ).toBe(true);
    expect(isTimelineBlock({ type: "text", content: "" } as MessageBlock)).toBe(
      false,
    );
    expect(
      isTimelineBlock({ type: "text", content: "  \n" } as MessageBlock),
    ).toBe(false);
  });

  // 网关偶发只给一个 "\n" 作为 reasoning_content（模型报了 reasoning_tokens
  // 却没给真实文本，见 docs/specs/core/stream-content-updates.md「思考用时
  // 展示」）。Message.renderBlock 不渲染这种块，它就不该占一个时间线圆点——
  // 判据与 text 分支同源，否则会出现「线画到了不存在的圆点上」。
  it("reasoning blocks only count when they have non-whitespace content", () => {
    expect(
      isTimelineBlock({
        type: "reasoning",
        content: "thinking",
        stage: "end",
      } as MessageBlock),
    ).toBe(true);
    expect(
      isTimelineBlock({
        type: "reasoning",
        content: "\n",
        stage: "end",
      } as MessageBlock),
    ).toBe(false);
    expect(
      isTimelineBlock({
        type: "reasoning",
        content: "",
        stage: "streaming",
      } as MessageBlock),
    ).toBe(false);
  });

  it("unknown block types never count", () => {
    expect(isTimelineBlock({ type: "image" } as unknown as MessageBlock)).toBe(
      false,
    );
  });
});

describe("countTimelineBlocks / timelineBlockBounds", () => {
  it("skip a whitespace-only reasoning block when counting and locating bounds", () => {
    const blocks = [
      { type: "reasoning", content: "\n", stage: "end" },
      { type: "text", content: "hello" },
      { type: "tool", id: "t1" },
    ] as unknown as MessageBlock[];

    expect(countTimelineBlocks(blocks)).toBe(2);
    expect(timelineBlockBounds(blocks)).toEqual({ first: 1, last: 2 });
  });

  it("a message with only a whitespace-only reasoning block has no timeline bounds", () => {
    const blocks = [
      { type: "reasoning", content: "\n", stage: "end" },
    ] as unknown as MessageBlock[];

    expect(countTimelineBlocks(blocks)).toBe(0);
    expect(timelineBlockBounds(blocks)).toEqual({ first: -1, last: -1 });
  });
});
