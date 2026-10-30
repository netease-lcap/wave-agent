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
    expect(estimateRowHeight(text(`${long}\n\n${fence(10)}`))).toBe(
      34 + Math.ceil((long.length * 2) / 62) * 22 + 8 + 10 * 18,
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
});
