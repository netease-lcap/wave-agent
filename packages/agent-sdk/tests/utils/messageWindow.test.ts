import { describe, it, expect } from "vitest";
import type { Message } from "../../src/types/messaging.js";
import { takeTailFromMemory } from "../../src/utils/messageWindow.js";

/**
 * 一页只按条数收（规格 ui/message-rendering-system.md「首屏一页，上翻按需取更早」）。
 * 字节不再参与：工具图片的 base64 在下发 UI 前就被剥掉，按含图的字节砍页挡的是
 * 不会上线的量。
 */

const msg = (id: string, content = id): Message =>
  ({
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content }],
  }) as Message;

const thread = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => msg(`m${i}`));

const ids = (messages: Message[]): string[] => messages.map((m) => m.id ?? "");

describe("takeTailFromMemory", () => {
  it("returns everything when it all fits under the limit", () => {
    expect(ids(takeTailFromMemory(thread(5), 100))).toEqual(ids(thread(5)));
  });

  it("returns the newest `limit` rows", () => {
    expect(ids(takeTailFromMemory(thread(250), 100))).toEqual(
      Array.from({ length: 100 }, (_, i) => `m${i + 150}`),
    );
  });

  it("keeps a very large newest message rather than cutting it", () => {
    // 一条消息再大也算一条：按字节砍页会让带截图的会话首屏只剩这一条，
    // 而真正发出去的载荷里并没有这张图。
    const big = msg("big", "x".repeat(5 * 1024 * 1024));
    const list = [msg("m0"), big, msg("m1")];
    expect(ids(takeTailFromMemory(list, 20))).toEqual(["m0", "big", "m1"]);
  });

  it("answers an empty list for an empty list", () => {
    expect(takeTailFromMemory([], 20)).toEqual([]);
  });
});
