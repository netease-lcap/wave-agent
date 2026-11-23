import { describe, expect, it } from "vitest";
import type { MessageBlock } from "../../src/types";
import type { Message } from "wave-agent-sdk/types";
import {
  countTimelineBlocks,
  isTimelineBlock,
  rendersNothing,
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

/**
 * `rendersNothing` 是「整条消息都不渲染」的判据，Message（不出 `.message`
 * 外壳）、MessageList（对时间线 run 透明）与 estimateRowHeight（不占行高）
 * 共用同一份——三处各写一份就会出现「外壳没了但行高还在」这类偏差。
 */
describe("rendersNothing", () => {
  const messageOf = (
    blocks: MessageBlock[],
    role: "user" | "assistant" = "assistant",
  ) => ({ id: "m", role, timestamp: "", blocks }) as unknown as Message;

  it("empty / whitespace-only blocks render nothing", () => {
    expect(rendersNothing(messageOf([]))).toBe(true);
    expect(
      rendersNothing(
        messageOf([
          { type: "text", content: "  \n" },
          { type: "reasoning", content: "", stage: "end" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(true);
  });

  it("non-rendering block types (file_history / task_notification) don't count", () => {
    expect(
      rendersNothing(
        messageOf([
          { type: "file_history", ...{} },
          { type: "task_notification" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(true);
  });

  it("blocks that always render make it non-empty", () => {
    expect(
      rendersNothing(
        messageOf([{ type: "tool", id: "t1" }] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
    expect(
      rendersNothing(
        messageOf([
          { type: "compact", content: "summary" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
    // notice 是一条给用户看的通知行（hook 的循环进度等），不能被当作空消息吞掉。
    expect(
      rendersNothing(
        messageOf([
          { type: "notice", level: "info", content: "🔄 第 3 轮" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
  });

  it("an image block only renders on assistant messages that actually have an image", () => {
    const image = { type: "image", imageUrls: ["data:image/png;base64,AA"] };
    expect(
      rendersNothing(
        messageOf([image] as unknown as MessageBlock[], "assistant"),
      ),
    ).toBe(false);
    // 用户消息上的图片块不渲染（图片走正文里的 [imageN] 标签）。
    expect(
      rendersNothing(messageOf([image] as unknown as MessageBlock[], "user")),
    ).toBe(true);
    expect(
      rendersNothing(
        messageOf(
          [{ type: "image", imageUrls: [] }] as unknown as MessageBlock[],
          "assistant",
        ),
      ),
    ).toBe(true);
  });
});
