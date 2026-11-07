import { describe, expect, it } from "vitest";
import type { Message as MessageType } from "wave-agent-sdk/types";
import { estimateRowHeight } from "../../src/virtual/estimateRowHeight";

function messageOf(
  blocks: MessageType["blocks"],
  role: MessageType["role"] = "assistant",
): MessageType {
  return {
    id: "m",
    role,
    timestamp: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    blocks,
  } as MessageType;
}

const text = (content: string) => messageOf([{ type: "text", content }]);

const fence = (codeLines: number) =>
  "```ts\n" +
  Array.from(
    { length: codeLines },
    (_, n) => `const value_${n} = compute(${n});`,
  ).join("\n") +
  "\n```";

describe("estimateRowHeight", () => {
  it("一行短文本按「基础 + 一行正文」算", () => {
    expect(estimateRowHeight(text("短消息 0"))).toBe(34 + 22);
  });

  it("代码围栏按代码行高（18px）算，不按正文的 62 字折行猜", () => {
    // 34（基础）+ 22（一行「高回答」）+ 8（代码块内边距）+ 60 × 18
    expect(estimateRowHeight(text(`高回答：\n\n${fence(60)}`))).toBe(1144);
  });

  it("超过估算上限的内容一律封顶到挂载后实测", () => {
    expect(estimateRowHeight(text(`高回答：\n\n${fence(120)}`))).toBe(1200);
  });

  it("围栏外的文字仍按正文折行，两块各算各的", () => {
    const long = "这是一段很长的正文。".repeat(20);
    const proseOnly = estimateRowHeight(text(long)) - 34;
    expect(estimateRowHeight(text(`${long}\n\n${fence(10)}`))).toBe(
      34 + proseOnly + 8 + 10 * 18,
    );
  });

  it("多个块之间留出块间距", () => {
    const one = estimateRowHeight(text("第一段"));
    const two = estimateRowHeight(
      messageOf([
        { type: "text", content: "第一段" },
        { type: "text", content: "第二段" },
      ]),
    );
    expect(two).toBe(one + 22 + 6);
  });

  // 网关偶发只给一个 "\n" 作为 reasoning_content（模型报了 reasoning_tokens
  // 却没给真实文本）。这种块 Message.renderBlock 不会渲染，估算高度也不该
  // 替它留空间，否则首屏会凭空多出一段空白，等挂载后再被实测收掉。
  it("空白 reasoning 块不占高度预算，等同于没有这个块", () => {
    const withEmptyReasoning = messageOf([
      { type: "reasoning", content: "\n", stage: "end" },
    ]);
    const empty = messageOf([]);
    expect(estimateRowHeight(withEmptyReasoning)).toBe(
      estimateRowHeight(empty),
    );
  });

  it("有真实内容的 reasoning 块仍按既有高度预算算", () => {
    const withReasoning = messageOf([
      { type: "reasoning", content: "thinking it through", stage: "end" },
    ]);
    expect(estimateRowHeight(withReasoning)).toBeGreaterThan(
      estimateRowHeight(messageOf([])),
    );
  });
});

/**
 * 折行必须按**实际列宽**算：同一个「每行多少字」的常量在手机列上会把正文估矮
 * 一半、在桌面列上估高一倍，而估矮的那几百 px 会在行第一次被量到时一次性纠正——
 * 用户看到的正是「上滑时定位突然变了」。
 */
describe("estimateRowHeight 按列宽折行", () => {
  /** 中文一字两格，所以 n 个汉字 = 2n 个视觉字符。 */
  const cjk = (n: number) => "字".repeat(n);
  /** 手机列：390px 视口 ⇒ 正文 358px ⇒ 每行 55 个视觉字符（358 / 6.5）。 */
  const PHONE_TEXT_WIDTH = 358;
  const DESKTOP_TEXT_WIDTH = 768;

  it("手机列把同一段正文折得比桌面列多", () => {
    const message = text(cjk(60)); // 120 视觉字符
    expect(estimateRowHeight(message, { textWidth: PHONE_TEXT_WIDTH })).toBe(
      34 + 3 * 22,
    );
    expect(estimateRowHeight(message, { textWidth: DESKTOP_TEXT_WIDTH })).toBe(
      34 + 2 * 22,
    );
  });

  it("358px 列正好在 55 个视觉字符处折行", () => {
    expect(
      estimateRowHeight(text(cjk(27)), { textWidth: PHONE_TEXT_WIDTH }),
    ).toBe(34 + 22);
    expect(
      estimateRowHeight(text(cjk(28)), { textWidth: PHONE_TEXT_WIDTH }),
    ).toBe(34 + 2 * 22);
  });

  it("逐段折行：上一段段末的余数不会借给下一段", () => {
    const paragraph = cjk(30); // 60 视觉字符 ⇒ 55/行 ⇒ 每段两行
    const sixParagraphs = Array.from({ length: 6 }, () => paragraph).join(
      "\n\n",
    );
    const oneLongParagraph = cjk(30 * 6);
    expect(
      estimateRowHeight(text(sixParagraphs), { textWidth: PHONE_TEXT_WIDTH }),
    ).toBe(34 + 6 * 2 * 22);
    // 同等字符数挤在一段里只要 7 行：整块攒起来再除，段数越多就估得越矮。
    expect(
      estimateRowHeight(text(oneLongParagraph), {
        textWidth: PHONE_TEXT_WIDTH,
      }),
    ).toBe(34 + Math.ceil(360 / 55) * 22);
  });

  it("极窄列也有下限，不会把每行字数算成 0", () => {
    expect(estimateRowHeight(text(cjk(10)), { textWidth: 1 })).toBe(
      34 + Math.ceil(20 / 8) * 22,
    );
  });
});
