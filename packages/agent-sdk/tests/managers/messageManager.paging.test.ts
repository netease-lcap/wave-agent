import { describe, it, expect, vi } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import { MESSAGE_PAGE_MAX_BYTES } from "../../src/constants/messageWindow.js";

/**
 * 取页就是在这份内存列表上切片（spec ui/message-rendering-system.md
 * 「列表就是压缩后的上下文，跨压缩边界不再回溯」）。
 *
 * 这里钉三件事：页从列表尾往回数、锚点按**最后一次出现**解析、翻到列表最早一条
 * 就给出「没有更早的」。列表本身从最近一次压缩开始，所以「更早」的边界是压缩点，
 * 不是会话起点——压缩前的消息不在这份列表里，也没有读盘路径去找它们。
 */

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/session.js")>();
  return {
    ...actual,
    appendMessages: vi.fn(async () => {}),
    createSession: vi.fn(async () => {}),
    loadFullMessageThread: vi.fn(async () => ({
      messages: [],
      sessionIds: [],
    })),
  };
});

const container = new Container();

function createManager(callbacks: MessageManagerCallbacks = {}) {
  return new MessageManager(container, { callbacks, workdir: "/test" });
}

/** Append `count` user messages and return their ids in order. */
function add(manager: MessageManager, count: number, from = 0): string[] {
  return Array.from({ length: count }, (_, i) =>
    manager.addUserMessage({ content: `m${from + i}` }),
  );
}

const ids = (messages: { id?: string }[]): string[] =>
  messages.map((m) => m.id ?? "");

describe("MessageManager.getMessagePage", () => {
  it("gives the newest page for a first screen and says there is more", () => {
    const manager = createManager();
    const all = add(manager, 45);

    const page = manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(25));
    expect(page.hasMore).toBe(true);
  });

  it("stops at the earliest entry of the list", () => {
    const manager = createManager();
    const all = add(manager, 5);

    const page = manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(all);
    expect(page.hasMore).toBe(false);
  });

  it("slices before an anchor, exclusive of the anchor itself", () => {
    const manager = createManager();
    const all = add(manager, 30);

    const page = manager.getMessagePage({ before: all[25], limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(5, 25));
    expect(page.hasMore).toBe(true);
  });

  it("reaches the start of the list and then reports no more", () => {
    const manager = createManager();
    const all = add(manager, 30);

    const first = manager.getMessagePage({ before: all[10], limit: 20 });
    expect(ids(first.messages)).toEqual(all.slice(0, 10));
    expect(first.hasMore).toBe(false);

    // 已经到最早一条：同一个锚点再问一次也不会有新东西。
    const again = manager.getMessagePage({ before: all[0], limit: 20 });
    expect(again.messages).toEqual([]);
    expect(again.hasMore).toBe(false);
  });

  it("resolves an anchor to its last occurrence", () => {
    // 同一 id 在列表里可能出现多次（压缩重建保留轮次），锚点必须按最后一次解析，
    // 否则翻页会跨过用户正在看的位置。
    const manager = createManager();
    const all = add(manager, 4);
    const msg = (id: string) => manager.getMessages().find((m) => m.id === id)!;
    // a b c d a b
    manager.setMessages([
      msg(all[0]),
      msg(all[1]),
      msg(all[2]),
      msg(all[3]),
      msg(all[0]),
      msg(all[1]),
    ]);

    const page = manager.getMessagePage({ before: all[1], limit: 10 });

    // 最后一次出现的 all[1] 是第 6 条，它之前是 a b c d a。
    expect(ids(page.messages)).toEqual([
      all[0],
      all[1],
      all[2],
      all[3],
      all[0],
    ]);
    expect(page.hasMore).toBe(false);
  });

  it("answers a since-anchor with everything after it", () => {
    const manager = createManager();
    const all = add(manager, 10);

    const page = manager.getMessagePage({ since: all[6] });

    expect(ids(page.messages)).toEqual(all.slice(7));
    expect(page.hasMore).toBe(false);
  });

  it("asks for a tail re-pull when the since-anchor is gone", () => {
    // 锚点不在了（压缩 / 回滚 / 换会话）：回一个空页会被读成「没有更新的消息」。
    const manager = createManager();
    add(manager, 3);

    expect(manager.getMessagePage({ since: "gone" })).toEqual({
      messages: [],
      hasMore: false,
      reset: true,
    });
  });

  it("asks for a tail re-pull when the before-anchor is gone", () => {
    const manager = createManager();
    add(manager, 3);

    expect(manager.getMessagePage({ before: "gone" })).toEqual({
      messages: [],
      hasMore: false,
      reset: true,
    });
  });

  it("takes at least one message even when it alone blows the byte budget", () => {
    // 单条就超预算时也得返回它：否则调用方拿同一个锚点反复重问，永远翻不动。
    const manager = createManager();
    manager.setMessages([
      {
        id: "huge",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [{ type: "text", content: "x".repeat(MESSAGE_PAGE_MAX_BYTES) }],
      },
    ]);
    const page = manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(["huge"]);
    expect(page.hasMore).toBe(false);
  });
});

describe("MessageManager list after compaction", () => {
  it("pages over the folded list, never over pre-compaction history", async () => {
    const manager = createManager();
    const before = add(manager, 6);
    manager.addAssistantMessage("a1");
    manager.addAssistantMessage("a2");

    await manager.compactMessagesAndUpdateSession("summary");

    const list = manager.getMessages();
    expect(list[0].blocks[0].type).toBe("compact");

    // 首屏就是这份折叠后的列表的尾页；「更早」的边界是压缩点。
    const page = manager.getMessagePage({ limit: 2 });
    expect(ids(page.messages)).toEqual(ids(list.slice(-2)));

    // 压缩前的消息没有列表入口：拿它们的 id 当锚点会走「重取尾页」。
    expect(manager.getMessagePage({ before: before[0] })).toEqual({
      messages: [],
      hasMore: false,
      reset: true,
    });
  });
});
