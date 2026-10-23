import { describe, it, expect, vi } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import { MESSAGE_SLICE_MAX_BYTES } from "../../src/constants/messageWindow.js";

/**
 * `getMessages` 就是在这份内存列表上取数（spec ui/message-rendering-system.md
 * 「首屏就是整份列表，不分页」）：三个本机宿主不传参数、拿整份；远控页按中继的
 * 单帧预算拿尾部 `limit` 条；`since` 是重连补差的锚点，锚点没了就让它整份重取。
 *
 * 列表从最近一次压缩开始，所以它的最早一条就是界面能到达的最早一条——压缩前的
 * 消息没有列表入口，也没有读盘路径去找它们。
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
  it("gives the whole list when nothing is asked for", () => {
    const manager = createManager();
    const all = add(manager, 45);

    expect(ids(manager.getMessagePage({}).messages)).toEqual(all);
  });

  it("slices the tail when a limit is given", () => {
    const manager = createManager();
    const all = add(manager, 45);

    expect(ids(manager.getMessagePage({ limit: 20 }).messages)).toEqual(
      all.slice(25),
    );
  });

  it("answers a limit larger than the list with the whole list", () => {
    const manager = createManager();
    const all = add(manager, 5);

    expect(ids(manager.getMessagePage({ limit: 100 }).messages)).toEqual(all);
  });

  it("answers a since-anchor with everything after it", () => {
    // 同一 id 在列表里可能出现多次（压缩重建保留轮次），锚点按**最后一次**解析，
    // 否则补差会跨过手机正在看的位置。
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

    const page = manager.getMessagePage({ since: all[1] });

    expect(ids(page.messages)).toEqual([]);
  });

  it("catches up from the newest copy of a repeated anchor", () => {
    const manager = createManager();
    const all = add(manager, 4);
    const msg = (id: string) => manager.getMessages().find((m) => m.id === id)!;
    manager.setMessages([msg(all[0]), msg(all[1]), msg(all[2])]);

    expect(ids(manager.getMessagePage({ since: all[1] }).messages)).toEqual([
      all[2],
    ]);
  });

  it("asks for a re-pull when the since-anchor is gone", () => {
    // 锚点不在了（压缩 / 回滚 / 换会话）：回一个空列表会被读成「没有更新的消息」。
    const manager = createManager();
    add(manager, 3);

    expect(manager.getMessagePage({ since: "gone" })).toEqual({
      messages: [],
      reset: true,
    });
  });

  it("takes at least one message even when it alone blows the byte budget", () => {
    // 单条就超预算时也得返回它：否则手机拿到的永远是空列表。
    const manager = createManager();
    manager.setMessages([
      {
        id: "huge",
        role: "user",
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [
          { type: "text", content: "x".repeat(MESSAGE_SLICE_MAX_BYTES) },
        ],
      },
    ]);

    expect(ids(manager.getMessagePage({ limit: 20 }).messages)).toEqual([
      "huge",
    ]);
  });
});

describe("MessageManager list after compaction", () => {
  it("serves the folded list, never pre-compaction history", async () => {
    const manager = createManager();
    const before = add(manager, 6);
    manager.addAssistantMessage("a1");
    manager.addAssistantMessage("a2");

    await manager.compactMessagesAndUpdateSession("summary");

    const list = manager.getMessages();
    expect(list[0].blocks[0].type).toBe("compact");

    // 列表就是这份折叠后的列表：整份口径下拿到的条数等于它。
    expect(manager.getMessagePage({}).messages).toHaveLength(list.length);

    // 压缩前的消息没有列表入口：拿它们的 id 当补差锚点会走「重取整份」。
    expect(manager.getMessagePage({ since: before[0] })).toEqual({
      messages: [],
      reset: true,
    });
  });
});
