import { describe, it, expect } from "vitest";
import type { Message } from "../../src/types/messaging.js";
import {
  messageBytes,
  takePageFromMemory,
} from "../../src/utils/messageWindow.js";

/**
 * 两端的窗口都只留一页，所以「从内存里切一页」的算术成了公共路径：常驻窗口
 * （`displayMessages`）与宿主缓存都靠它回答首屏 / 翻更早。算术错一位的后果很具体
 * ——页面要么少一行、要么把同一行推两遍、要么在锚点上来回死循环。
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

describe("takePageFromMemory", () => {
  it("returns the newest rows when everything fits", () => {
    const page = takePageFromMemory(thread(5), 20);
    expect(ids(page.messages)).toEqual(ids(thread(5)));
    // 「这就是开头」：调用方据此停止再请求。
    expect(page.more).toBe(false);
  });

  it("returns at most `limit` rows and says more are left", () => {
    const page = takePageFromMemory(thread(30), 20);
    expect(ids(page.messages)).toEqual(
      Array.from({ length: 20 }, (_, i) => `m${i + 10}`),
    );
    expect(page.more).toBe(true);
  });

  it("ends before the given index, excluding it", () => {
    // 翻更早的形状：`end` 是锚点的下标，锚点本身已经在读者手里了。
    const page = takePageFromMemory(thread(10), 3, undefined, 7);
    expect(ids(page.messages)).toEqual(["m4", "m5", "m6"]);
    expect(page.more).toBe(true);
  });

  it("stops at the byte budget", () => {
    const heavy = msg("big", "x".repeat(4096));
    const list = [msg("m0"), heavy, msg("m1")];
    const page = takePageFromMemory(list, 20, 512);
    expect(ids(page.messages)).toEqual(["m1"]);
    expect(page.more).toBe(true);
  });

  it("always keeps one message, even when it alone blows the budget", () => {
    // 一条就超预算时也必须返回它：返回空页会让调用方拿同一个锚点反复重问，永远
    // 翻不动。
    const page = takePageFromMemory([msg("big", "x".repeat(4096))], 20, 1);
    expect(ids(page.messages)).toEqual(["big"]);
    expect(page.more).toBe(false);
  });

  it("answers an empty page for an empty list", () => {
    expect(takePageFromMemory([], 20)).toEqual({ messages: [], more: false });
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
