import { describe, expect, it } from "vitest";
import type { MessageBlock } from "../../src/types";
import type { Message } from "wave-agent-sdk/types";
import {
  blockRendersContent,
  hasTimelineDot,
  rendersNothing,
} from "../../src/utils/timelineBlocks";

describe("blockRendersContent", () => {
  it("compact/tool blocks always count, regardless of content", () => {
    expect(
      blockRendersContent({ type: "compact", content: "" } as MessageBlock),
    ).toBe(true);
    expect(
      blockRendersContent({
        type: "tool",
        id: "t1",
      } as unknown as MessageBlock),
    ).toBe(true);
  });

  it("text blocks only count when they have non-whitespace content", () => {
    expect(
      blockRendersContent({ type: "text", content: "hi" } as MessageBlock),
    ).toBe(true);
    expect(
      blockRendersContent({ type: "text", content: "" } as MessageBlock),
    ).toBe(false);
    expect(
      blockRendersContent({ type: "text", content: "  \n" } as MessageBlock),
    ).toBe(false);
  });

  // 网关偶发只给一个 "\n" 作为 reasoning_content（模型报了 reasoning_tokens
  // 却没给真实文本，见 docs/specs/core/stream-content-updates.md「思考用时
  // 展示」）。Message.renderBlock 不渲染这种块，它就不该让整条消息多出一个
  // 圆点——判据与 text 分支同源，否则会出现「线画到了不存在的圆点上」。
  it("reasoning blocks only count when they have non-whitespace content", () => {
    expect(
      blockRendersContent({
        type: "reasoning",
        content: "thinking",
        stage: "end",
      } as MessageBlock),
    ).toBe(true);
    expect(
      blockRendersContent({
        type: "reasoning",
        content: "\n",
        stage: "end",
      } as MessageBlock),
    ).toBe(false);
    expect(
      blockRendersContent({
        type: "reasoning",
        content: "",
        stage: "streaming",
      } as MessageBlock),
    ).toBe(false);
  });

  it("unknown block types never count", () => {
    expect(
      blockRendersContent({ type: "image" } as unknown as MessageBlock),
    ).toBe(false);
  });
});

const messageOf = (
  blocks: MessageBlock[],
  role: "user" | "assistant" = "assistant",
) => ({ id: "m", role, timestamp: "", blocks }) as unknown as Message;

/**
 * 行级圆点（spec ui/message-rendering-system.md「时间线圆点按助手回合出现
 * （行级）」）：判据只看「这条助手消息有没有可渲染内容块」，与块数无关。
 */
describe("hasTimelineDot", () => {
  it("块再多也只回答「有」——一条助手消息最多一个点", () => {
    expect(
      hasTimelineDot(
        messageOf([
          { type: "reasoning", content: "想了想", stage: "end" },
          { type: "text", content: "hello" },
          { type: "tool", id: "t1" },
          { type: "tool", id: "t2" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(true);
  });

  it("用户消息不出点（它本身就是 run 的断点）", () => {
    expect(
      hasTimelineDot(
        messageOf([{ type: "text", content: "hi" }] as MessageBlock[], "user"),
      ),
    ).toBe(false);
  });

  it("可渲染内容块全为空时不出点", () => {
    expect(
      hasTimelineDot(
        messageOf([
          { type: "reasoning", content: "\n", stage: "end" },
          { type: "text", content: "  \n" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
    expect(hasTimelineDot(messageOf([]))).toBe(false);
  });

  // notice 是一条给用户看的通知行：它照常渲染，但不属于「回合内容」，所以不出点，
  // 也不参与 run 的起止（与下一条 rendersNothing 的「通知不算空」不冲突）。
  it("只有 notice 通知块的消息渲染那一行，但不出点", () => {
    expect(
      hasTimelineDot(
        messageOf([
          { type: "notice", level: "info", content: "🔄 第 3 轮" },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
  });

  // 图片块本来就渲染在时间线行之外（renderImageBlock 不包 .timeline-row），
  // 行级化之后也不该让整条消息凭空多出圆点。
  it("助手消息上的图片块不产生圆点", () => {
    expect(
      hasTimelineDot(
        messageOf([
          { type: "image", imageUrls: ["data:image/png;base64,AA"] },
        ] as unknown as MessageBlock[]),
      ),
    ).toBe(false);
  });
});

/**
 * `rendersNothing` 是「整条消息都不渲染」的判据，MessageList（不出 `.message`
 * 外壳、不占虚拟行）与 estimateRowHeight（不占行高）共用同一份——两处各写一份
 * 就会出现「外壳没了但行高还在」这类偏差。
 */
describe("rendersNothing", () => {
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
