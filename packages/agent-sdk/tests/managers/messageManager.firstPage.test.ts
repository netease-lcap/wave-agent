import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { Message } from "../../src/types/messaging.js";
import { Container } from "../../src/utils/container.js";

/**
 * 首屏那一页（spec ui/message-rendering-system.md「首屏按条数填满，压缩边界不截断
 * 这一页」）：内存里的列表从最近一次压缩开始，压缩过的会话可能只剩摘要块加保留的
 * 轮次，直接发出去用户就只看到压缩块那一小段。所以不足一页时从转录补齐到 `limit`。
 *
 * 读盘在这里被整个 mock 掉：真转录的倒读行为由 `tests/utils/transcriptPage.test.ts`
 * 覆盖，这一层只关心「怎么补、怎么去重、补不齐时怎么办」。
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
  return { ...actual, readTranscriptPage: vi.fn() };
});

const container = new Container();

function createManager() {
  return new MessageManager(container, { callbacks: {}, workdir: "/test" });
}

const message = (id: string): Message => ({
  id,
  role: "user",
  timestamp: "2026-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content: id }],
});

const compactBlock = (id: string): Message => ({
  id,
  role: "assistant",
  timestamp: "2026-01-01T00:00:00.000Z",
  blocks: [{ type: "compact", content: "summary" }],
});

const ids = (messages: { id?: string }[]): string[] =>
  messages.map((item) => item.id ?? "");

async function readPage() {
  const mod = await import("../../src/utils/transcriptPage.js");
  return vi.mocked(mod.readTranscriptPage);
}

/** 一次读盘的回包。`hasMore` 缺省为「上面还有」。 */
function transcriptPage(messageIds: string[], hasMore = true) {
  return { messages: messageIds.map(message), hasMore };
}

describe("MessageManager.getMessagePage 首屏补齐", () => {
  beforeEach(async () => {
    (await readPage()).mockReset();
  });

  it("compaction 折叠后的会话也按条数填满，压缩前的消息就在首屏里", async () => {
    const manager = createManager();
    // 压缩后的内存口径：摘要块 + 保留的两轮。
    manager.setMessages([
      compactBlock("compact"),
      message("p1"),
      message("p2"),
    ]);
    const read = await readPage();
    // 转录里保留的轮次排在摘要块**之前**（append-only）：p1/p2 与内存重复。
    read.mockResolvedValueOnce(transcriptPage(["h3", "h4", "h5", "p1", "p2"]));
    read.mockResolvedValueOnce(transcriptPage(["h1", "h2"]));

    const page = await manager.getMessagePage({ limit: 8 });

    // 5 + 3 = 8：第二轮只补去重后还差的那两条。
    expect(ids(page.messages)).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "compact",
      "p1",
      "p2",
    ]);
    expect(page.hasMore).toBe(true);
    // 第二轮从第一轮最早的（去重前的）那条往前接，锚点不断。
    expect(read.mock.calls[1][1]).toEqual({ before: "h3", limit: 2 });
    // 补进来的不进内存：模型上下文与常驻量都不变。
    expect(manager.getMessages()).toHaveLength(3);
  });

  it("页首落在转录的第一条时报告到头", async () => {
    const manager = createManager();
    manager.setMessages([compactBlock("compact"), message("p1")]);
    const read = await readPage();
    read.mockResolvedValueOnce(transcriptPage(["h1"], false));

    const page = await manager.getMessagePage({ limit: 10 });

    // 这一趟读页自己就说了「上面没有了」，不必再读一次确认。
    expect(read).toHaveBeenCalledTimes(1);
    expect(ids(page.messages)).toEqual(["h1", "compact", "p1"]);
    expect(page.hasMore).toBe(false);
  });

  it("读盘失败时退回内存这一页，并留下一次上翻机会", async () => {
    const manager = createManager();
    manager.setMessages([compactBlock("compact"), message("p1")]);
    const read = await readPage();
    read.mockRejectedValueOnce(new Error("EIO: disk on fire"));

    const page = await manager.getMessagePage({ limit: 10 });

    // 首屏任何时候都不给空表，也不把一次抖动说成「没有更早」。
    expect(ids(page.messages)).toEqual(["compact", "p1"]);
    expect(page.hasMore).toBe(true);
  });

  it("锚点不在转录里时按「可能还有」处理，不用空表或终点顶上去", async () => {
    const manager = createManager();
    manager.setMessages([compactBlock("compact"), message("p1")]);
    const read = await readPage();
    read.mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      anchorLost: true,
    });

    const page = await manager.getMessagePage({ limit: 10 });

    expect(ids(page.messages)).toEqual(["compact", "p1"]);
    expect(page.hasMore).toBe(true);
  });

  it("内存正好一页时只探一条，不把页撑大", async () => {
    const manager = createManager();
    const all = Array.from({ length: 10 }, (_, i) => message(`m${i}`));
    manager.setMessages(all);
    const read = await readPage();
    read.mockResolvedValueOnce(transcriptPage(["older"]));

    const page = await manager.getMessagePage({ limit: 10 });

    expect(read.mock.calls[0][1]).toEqual({ before: "m0", limit: 1 });
    expect(ids(page.messages)).toEqual(ids(all));
    expect(page.hasMore).toBe(true);
  });

  it("探测到转录也没有更早时报告到头", async () => {
    const manager = createManager();
    const all = Array.from({ length: 10 }, (_, i) => message(`m${i}`));
    manager.setMessages(all);
    const read = await readPage();
    read.mockResolvedValueOnce(transcriptPage([], false));

    const page = await manager.getMessagePage({ limit: 10 });

    expect(ids(page.messages)).toEqual(ids(all));
    expect(page.hasMore).toBe(false);
  });

  it("内存比一页长时不读盘", async () => {
    const manager = createManager();
    const all = Array.from({ length: 12 }, (_, i) => message(`m${i}`));
    manager.setMessages(all);
    const read = await readPage();

    const page = await manager.getMessagePage({ limit: 10 });

    expect(read).not.toHaveBeenCalled();
    expect(ids(page.messages)).toEqual(ids(all.slice(2)));
    expect(page.hasMore).toBe(true);
  });
});
