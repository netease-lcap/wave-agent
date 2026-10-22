import { describe, it, expect } from "vitest";
import type { Message } from "wave-agent-sdk";
import {
  InvalidMessageWindowError,
  sliceMessageWindow,
} from "../../src/remote/messageWindow.js";

/**
 * The window arithmetic is the wire contract shared by every host that answers
 * `getMessages` (spec ui/remote-control.md §5). The three local GUI hosts now
 * push one page and page backwards through it (spec ui/message-rendering-system.md「首屏只进一
 * 页」), so an off-by-one here either hides rows or sends them twice.
 */

const msg = (id: string): Message =>
  ({
    id,
    role: "user",
    timestamp: "0",
    blocks: [{ type: "text", content: id }],
  }) as Message;

const thread = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => msg(`m${String(i)}`));

describe("sliceMessageWindow", () => {
  it("answers the whole list, untouched, when no window was asked for", () => {
    const all = thread(5);
    // 老宿主 / 老调用方走这条路径：没有窗口参数就是「全量」，不能被悄悄截成
    // 一页 —— 那是调用方察觉不到的失败（它要了一份有界页，拿回了整条会话，或
    // 反过来）。
    expect(sliceMessageWindow(all, undefined)).toBeUndefined();
    expect(sliceMessageWindow(all, {})).toBeUndefined();
  });

  it("returns exactly one page when the anchor sits one page from the start", () => {
    const all = thread(201);
    // 正好一页：`before` 指向第 200 条之前的边界 —— 取回前 200 条，且再往前的
    // 一条都没有了。
    const page = sliceMessageWindow(all, { before: "m200", limit: 200 });
    expect(page?.messages.map((m) => m.id)).toEqual(
      all.slice(0, 200).map((m) => m.id),
    );
    expect(page?.hasMore).toBe(false);
    expect(page?.total).toBe(201);
  });

  it("walks the thread one page at a time without repeating a row", () => {
    // 翻页的真实形状：读者一页一页往上走，每一页的锚点是上一页的第一条。任何一
    // 版实现只要把锚点当成包含式，第一页的最后一行就会在第二页里再出现一次。
    const all = thread(450);
    let before: string | undefined = all[400].id;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const page = sliceMessageWindow(all, { before, limit: 200 });
      if (!page) throw new Error("windowed request must return a slice");
      seen.unshift(...page.messages.map((m) => m.id));
      if (!page.hasMore) break;
      before = page.messages[0].id;
    }
    expect(seen).toEqual(all.slice(0, 400).map((m) => m.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("stops paging when the backward anchor is gone", () => {
    // 锚点被 rewind / clear 截掉了：回空页 + hasMore:false。回「整段」或
    // hasMore:true 都会让调用方拿一个永远解不出的锚点继续问下去。
    const page = sliceMessageWindow(thread(5), {
      before: "gone",
      limit: 20,
    });
    expect(page).toEqual({ messages: [], hasMore: false, total: 5 });
  });

  it("reads the tail when only a limit is given, and says whether history is left", () => {
    const all = thread(45);
    const page = sliceMessageWindow(all, { limit: 20 });
    expect(page?.messages.map((m) => m.id)).toEqual(
      all.slice(25).map((m) => m.id),
    );
    expect(page?.hasMore).toBe(true);

    // 全部装得下一页：hasMore:false 是「这就是开头」，页面据此显示提示并停止
    // 再请求。
    const whole = sliceMessageWindow(all, { limit: 200 });
    expect(whole?.messages).toHaveLength(45);
    expect(whole?.hasMore).toBe(false);
  });

  it("resolves a repeated anchor to its LAST occurrence", () => {
    // 压缩会把同一条消息重新加进展示流，所以 id 在列表里可以重复出现：锚点必须
    // 解析成读者可能看到的最新那一份。解析到**第一份**会把读者已经看过的两条
    // 重新推一遍（["b","x","c"]），而那是补差路径要避免的。
    const all = [msg("a"), msg("x"), msg("b"), msg("x"), msg("c")];
    const page = sliceMessageWindow(all, { since: "x" });
    expect(page?.messages.map((m) => m.id)).toEqual(["c"]);
  });

  it("asks for a rebuild when the incremental anchor vanished", () => {
    const page = sliceMessageWindow(thread(3), { since: "gone" });
    expect(page).toEqual({ messages: [], reset: true, total: 3 });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects limit=%s instead of silently widening the read",
    (limit) => {
      // 静默放宽读是调用方唯一察觉不到的失败方式：它要了一份有界页，拿回了
      // 整条会话。
      expect(() => sliceMessageWindow(thread(3), { limit })).toThrow(
        InvalidMessageWindowError,
      );
    },
  );
});
