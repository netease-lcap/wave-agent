import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import type { Message } from "../../src/types/messaging.js";
import { Container } from "../../src/utils/container.js";

/**
 * `getMessages` 在内存列表上取数，遇到压缩边界之前的锚点才读转录
 * （spec ui/message-rendering-system.md「首屏一页，上翻按需取更早」）：
 *
 * - 不带参数 = 整份（内部调用），仍是压缩后的上下文；
 * - `limit` = 首屏那一页，回包带 `hasMore`；
 * - `since` = 重连补差的锚点，锚点没了让调用方整份重取；
 * - `before` = 上翻取更早，锚点不在内存里时才去读转录。
 *
 * 测试里没有真转录文件（ENOENT），所以「读盘」那一侧一律回空页——读盘本身的行为
 * 由 `tests/utils/transcriptPage.test.ts` 覆盖。
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

vi.mock("../../src/utils/transcriptPage.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/transcriptPage.js")>();
  // 默认透传真实现（其余用例靠「没有转录文件 = 空页」），个别用例换成受控回包。
  return { ...actual, readTranscriptPage: vi.fn(actual.readTranscriptPage) };
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
  it("gives the whole list when nothing is asked for", async () => {
    const manager = createManager();
    const all = add(manager, 45);

    expect(ids((await manager.getMessagePage({})).messages)).toEqual(all);
  });

  it("slices the tail when a limit is given, and says there is more", async () => {
    const manager = createManager();
    const all = add(manager, 45);

    const page = await manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(25));
    expect(page.hasMore).toBe(true);
  });

  it("answers a limit larger than the list with the whole list", async () => {
    const manager = createManager();
    const all = add(manager, 5);

    const page = await manager.getMessagePage({ limit: 100 });

    expect(ids(page.messages)).toEqual(all);
    // 内存里就这么多，转录也没有（ENOENT）：没有更早的了。
    expect(page.hasMore).toBe(false);
  });

  it("keeps the whole page when messages carry large tool images", async () => {
    // 一页只按条数收。工具图片的 base64 在发给 UI 前就被剥掉（README：
    // packages/code/src/stdio/uiPayload.ts），按含图的字节砍页会把有图的会话
    // 首屏砍成一两条，而线上载荷里根本没有那张图。
    const manager = createManager();
    manager.setMessages(
      Array.from({ length: 30 }, (_, i) => ({
        id: `m${i}`,
        role: "assistant" as const,
        timestamp: "2026-01-01T00:00:00.000Z",
        blocks: [
          {
            type: "tool" as const,
            id: `t${i}`,
            name: "Read",
            stage: "end" as const,
            result: "ok",
            images: [{ data: "x".repeat(2 * 1024 * 1024) }],
          },
        ],
      })),
    );

    const page = await manager.getMessagePage({ limit: 30 });

    // 30 × 2 MiB = 60 MiB：旧的 4 MiB 字节预算只会留 2 条。
    expect(page.messages).toHaveLength(30);
    expect(page.hasMore).toBe(false);
  });

  it("answers a since-anchor with everything after it", async () => {
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

    const page = await manager.getMessagePage({ since: all[1] });

    expect(ids(page.messages)).toEqual([]);
  });

  it("catches up from the newest copy of a repeated anchor", async () => {
    const manager = createManager();
    const all = add(manager, 4);
    const msg = (id: string) => manager.getMessages().find((m) => m.id === id)!;
    manager.setMessages([msg(all[0]), msg(all[1]), msg(all[2])]);

    expect(
      ids((await manager.getMessagePage({ since: all[1] })).messages),
    ).toEqual([all[2]]);
  });

  it("asks for a re-pull when the since-anchor is gone", async () => {
    // 锚点不在了（压缩 / 回滚 / 换会话）：回一个空列表会被读成「没有更新的消息」。
    const manager = createManager();
    add(manager, 3);

    await expect(manager.getMessagePage({ since: "gone" })).resolves.toEqual({
      messages: [],
      reset: true,
    });
  });

  it("serves a before-anchor out of memory while it is still resident", async () => {
    // 刚显示过的那些还在内存里：翻一页不必读盘。
    const manager = createManager();
    const all = add(manager, 45);

    const page = await manager.getMessagePage({
      before: all[25],
      limit: 20,
    });

    expect(ids(page.messages)).toEqual(all.slice(5, 25));
    // 上面还有 5 条（内存里就有），所以不是尽头。
    expect(page.hasMore).toBe(true);
  });

  it("reads the transcript once the anchor is above the resident window", async () => {
    // 锚点不在内存里 = 落在压缩边界之前：整页交给转录（这里没有文件，回空页）。
    const manager = createManager();
    add(manager, 6);

    await expect(
      manager.getMessagePage({ before: "pre-compaction-id", limit: 20 }),
    ).resolves.toEqual({ messages: [], hasMore: false });
  });

  it("stops at the start of what it can see and says so", async () => {
    const manager = createManager();
    const all = add(manager, 3);

    const page = await manager.getMessagePage({ before: all[2], limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(0, 2));
    // 内存到头了，转录也没有更早的：这是尽头。
    expect(page.hasMore).toBe(false);
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
    expect((await manager.getMessagePage({})).messages).toHaveLength(
      list.length,
    );

    // 压缩前的消息不在内存里：拿它们的 id 当补差锚点会走「重取整份」。
    await expect(manager.getMessagePage({ since: before[0] })).resolves.toEqual(
      {
        messages: [],
        reset: true,
      },
    );
  });
});

describe("MessageManager reading a page while the session moves", () => {
  // 参考物在同一位置做 revalidation：读盘期间会话换掉了，这一页就是上一个会话的，
  // 拼进新列表等于串会话。判据是「读完再比一次会话身份」，变了按新路径重读一次。
  const stub = async () => {
    const mod = await import("../../src/utils/transcriptPage.js");
    return vi.mocked(mod.readTranscriptPage);
  };

  // mock 函数在同一个文件里跨用例共享，调用次数要各算各的。
  beforeEach(async () => {
    (await stub()).mockClear();
  });

  it("re-reads instead of grafting the old session's page onto the new one", async () => {
    const read = await stub();
    const manager = createManager();
    add(manager, 3);
    const stalePath = manager.getTranscriptPath();

    read.mockImplementationOnce(async () => {
      manager.clearMessages();
      return {
        messages: [{ id: "stale" } as Message],
        hasMore: true,
      };
    });
    read.mockImplementationOnce(async () => ({
      messages: [],
      hasMore: false,
    }));

    const page = await manager.getMessagePage({ before: "ghost", limit: 10 });

    expect(ids(page.messages)).toEqual([]);
    expect(page.anchorLost).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(2);
    // 第二次走的是新会话的转录，不是刚才那份。
    expect(read.mock.calls[1][0]).toBe(manager.getTranscriptPath());
    expect(read.mock.calls[1][0]).not.toBe(stalePath);
  });

  it("calls the anchor lost when the session keeps moving under it", async () => {
    const read = await stub();
    const manager = createManager();
    add(manager, 3);

    const staleThenSwapped = async () => {
      manager.clearMessages();
      return { messages: [{ id: "stale" } as Message], hasMore: true };
    };
    read
      .mockImplementationOnce(staleThenSwapped)
      .mockImplementationOnce(staleThenSwapped);
    await expect(
      manager.getMessagePage({ before: "ghost", limit: 10 }),
    ).resolves.toEqual({ messages: [], hasMore: false, anchorLost: true });
    expect(read).toHaveBeenCalledTimes(2);
  });
});
