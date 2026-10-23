import { describe, it, expect } from "vitest";
import type { Message } from "../../src/types/messaging.js";
import {
  messageBytes,
  takeTailFromMemory,
} from "../../src/utils/messageWindow.js";

/**
 * 三端列表不分页（规格 ui/message-rendering-system.md「首屏就是整份列表，不分页」），
 * 只有远控页从尾部切一段：那边隔着一层中继，单帧超预算会被静默丢弃，所以既要条数
 * 上限也要字节上限。算术错一位的后果很具体——手机上要么少几十条，要么收到一个
 * 中继根本发不出去的超大帧。
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

  it("stops at the byte budget, newest first", () => {
    const heavy = msg("big", "x".repeat(4096));
    const list = [msg("m0"), heavy, msg("m1")];
    expect(ids(takeTailFromMemory(list, 20, 512))).toEqual(["m1"]);
  });

  it("always keeps one message, even when it alone blows the budget", () => {
    // 一条就超预算时也必须返回它：返回空列表会让手机拿到一个永远是空的列表。
    const big = msg("big", "x".repeat(4096));
    expect(ids(takeTailFromMemory([big], 20, 1))).toEqual(["big"]);
  });

  it("answers an empty list for an empty list", () => {
    expect(takeTailFromMemory([], 20)).toEqual([]);
  });
});

describe("messageBytes", () => {
  it("counts UTF-8 bytes, not characters", () => {
    // 预算按堆上的字节算：中文一个字三字节，按字符数估会低估三倍。
    const message = msg("m0", "中文");
    expect(messageBytes(message)).toBe(
      Buffer.byteLength(JSON.stringify(message), "utf8"),
    );
    expect(messageBytes(message)).toBeGreaterThan(
      JSON.stringify(message).length,
    );
  });
});
