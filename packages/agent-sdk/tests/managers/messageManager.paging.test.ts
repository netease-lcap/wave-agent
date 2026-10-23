import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";
import { MESSAGE_RESIDENT_SIZE } from "../../src/constants/messageWindow.js";
import { readTranscriptPage } from "../../src/utils/transcriptPage.js";
import type { Message } from "../../src/types/messaging.js";

/**
 * 常驻窗口 + 转录读页这两条链路合成一个 `getMessagePage`（spec
 * ui/message-rendering-system.md「续页从转录读、两端不再常驻全量」）。
 *
 * 这里钉的是**内存与盘的分工**：窗口里有的在内存切片，窗口外的去盘上读，没落盘
 * 的尾部无论如何都要带上（它只存在于内存里）。分错了的表现是页面缺行、重复行，或
 * 者一个长期会话的第一屏又重新读完整份转录。
 */

vi.mock("../../src/utils/transcriptPage.js", () => ({
  readTranscriptPage: vi.fn(async () => ({
    messages: [],
    hasMore: false,
  })),
}));

// 磁盘那一侧全部替掉：这一组用例关心的是「内存与盘怎么分工」，不是 append 本身。
// 保留其余导出（`generateSessionId` 等）——它们跟持久化无关，被 manager 的构造
// 函数直接用。
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
  return Array.from({ length: count }, (_, i) => {
    const id = manager.addUserMessage({ content: `m${from + i}` });
    return id;
  });
}

const ids = (messages: { id?: string }[]): string[] =>
  messages.map((m) => m.id ?? "");

const diskMsg = (id: string): Message =>
  ({
    id,
    role: "user",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks: [{ type: "text", content: id }],
  }) as unknown as Message;

describe("MessageManager resident window", () => {
  beforeEach(() => {
    vi.mocked(readTranscriptPage).mockClear();
  });

  it("keeps only the newest MESSAGE_RESIDENT_SIZE display messages", () => {
    // 常驻窗口就是内存上限：工具图片的 base64 挂在消息上，全量留着等于整条会话
    // 的图片一直不释放。
    const manager = createManager();
    const all = add(manager, MESSAGE_RESIDENT_SIZE + 10);

    expect(ids(manager.getDisplayMessages())).toEqual(all.slice(10));
  });

  it("counts the whole thread even though the window is capped", () => {
    // 会话列表要的是全条数，窗口长度已经答不了它。
    const manager = createManager();
    add(manager, MESSAGE_RESIDENT_SIZE + 10);

    expect(manager.getDisplayMessages()).toHaveLength(MESSAGE_RESIDENT_SIZE);
    expect(manager.getThreadSummary().messageCount).toBe(
      MESSAGE_RESIDENT_SIZE + 10,
    );
  });

  it("remembers the first user text after that message leaves the window", () => {
    // 会话标题兜底读它——而那条消息早就被窗口挤掉了。
    const manager = createManager();
    add(manager, MESSAGE_RESIDENT_SIZE + 5);

    expect(manager.getThreadSummary().firstUserText).toBe("m0");
  });
});

describe("MessageManager.getMessagePage", () => {
  beforeEach(() => {
    vi.mocked(readTranscriptPage).mockReset();
    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [],
      hasMore: false,
    });
  });

  it("answers the first screen from memory and never touches the transcript", async () => {
    // 没落盘的一页全在窗口里：首屏不该产生任何读盘开销。
    const manager = createManager();
    const all = add(manager, 45);

    const page = await manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(25));
    expect(page.hasMore).toBe(true);
    expect(readTranscriptPage).not.toHaveBeenCalled();
  });

  it("tops the first screen up from the transcript when memory runs out", async () => {
    const manager = createManager();
    const persisted = add(manager, 5);
    await manager.saveSession();
    const pending = add(manager, 5, 100);

    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [diskMsg("d0")],
      hasMore: true,
    });

    const page = await manager.getMessagePage({ limit: 20 });

    expect(ids(page.messages)).toEqual(["d0", ...pending]);
    expect(page.hasMore).toBe(true);
    // 锚点是窗口里最后一条已落盘的消息，且只补差额。
    expect(readTranscriptPage).toHaveBeenCalledWith(expect.any(String), {
      before: persisted[persisted.length - 1],
      limit: 15,
    });
  });

  it("slices a resident before-anchor in memory", async () => {
    const manager = createManager();
    const all = add(manager, 30);

    const page = await manager.getMessagePage({ before: all[25], limit: 20 });

    expect(ids(page.messages)).toEqual(all.slice(5, 25));
    expect(page.hasMore).toBe(true);
    expect(readTranscriptPage).not.toHaveBeenCalled();
  });

  it("continues a resident before-anchor from the transcript when the window ends", async () => {
    const manager = createManager();
    const persisted = add(manager, 5);
    await manager.saveSession();
    add(manager, 3, 100);

    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [diskMsg("d0")],
      hasMore: false,
    });

    const page = await manager.getMessagePage({
      before: persisted[3],
      limit: 20,
    });

    expect(ids(page.messages)).toEqual(["d0", ...persisted.slice(0, 3)]);
    expect(page.hasMore).toBe(false);
    // 窗口第一条（已落盘的那条）是盘上读的锚点：它按定义在转录里。
    expect(readTranscriptPage).toHaveBeenCalledWith(expect.any(String), {
      before: persisted[0],
      limit: 17,
    });
  });

  it("reads a before-anchor that is not resident straight from the transcript", async () => {
    // 锚点不在窗口里 = 它只可能在转录里（或哪儿都没有），内存里没有可切的。
    const manager = createManager();
    add(manager, 3);
    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [diskMsg("d0")],
      hasMore: true,
    });

    const page = await manager.getMessagePage({ before: "old", limit: 20 });

    expect(ids(page.messages)).toEqual(["d0"]);
    expect(page.hasMore).toBe(true);
    expect(readTranscriptPage).toHaveBeenCalledWith(expect.any(String), {
      before: "old",
      limit: 20,
    });
  });

  it("answers a resident since-anchor with the window's own tail", async () => {
    const manager = createManager();
    const all = add(manager, 10);

    const page = await manager.getMessagePage({ since: all[6] });

    expect(ids(page.messages)).toEqual(all.slice(7));
    expect(page.hasMore).toBe(false);
    expect(readTranscriptPage).not.toHaveBeenCalled();
  });

  it("merges the un-flushed tail into a transcript since-page", async () => {
    // 尾部只存在于内存：光回盘上那一段会让页面丢掉用户正在看的内容。
    const manager = createManager();
    add(manager, 5);
    await manager.saveSession();
    const pending = add(manager, 3, 100);
    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [diskMsg("d0")],
      hasMore: false,
    });

    const page = await manager.getMessagePage({ since: "not-resident" });

    expect(ids(page.messages)).toEqual(["d0", ...pending]);
    expect(page.hasMore).toBe(false);
  });

  it("passes a reset through untouched", async () => {
    // 锚点不在了：调用方要的是「整份重取」，掺上内存尾部就成了半份补差。
    const manager = createManager();
    add(manager, 3);
    vi.mocked(readTranscriptPage).mockResolvedValue({
      messages: [],
      hasMore: false,
      reset: true,
    });

    await expect(manager.getMessagePage({ since: "gone" })).resolves.toEqual({
      messages: [],
      hasMore: false,
      reset: true,
    });
  });
});

describe("MessageManager.getDisplayThread", () => {
  beforeEach(() => {
    vi.mocked(readTranscriptPage).mockReset();
  });

  it("reads the whole thread from disk and overlays the newer in-memory copies", async () => {
    const { loadFullMessageThread } = await import(
      "../../src/services/session.js"
    );
    const manager = createManager();
    const ids0 = add(manager, 2);
    const onDisk = ids0.map((id, i) => ({
      id,
      role: "user",
      timestamp: "2026-01-01T00:00:00.000Z",
      blocks: [{ type: "text", content: `盘上第 ${i} 条` }],
    }));
    vi.mocked(loadFullMessageThread).mockResolvedValue({
      messages: onDisk as unknown as Message[],
      sessionIds: ["s"],
    });

    const thread = await manager.getDisplayThread();

    // 内存那份比盘上新（流式更新在落盘之后才到），同一 id 取内存的。
    expect(ids(thread)).toEqual(ids0);
    expect(thread[0].blocks).toEqual(manager.getDisplayMessages()[0].blocks);
  });

  it("appends the un-flushed tail exactly once", async () => {
    const { loadFullMessageThread } = await import(
      "../../src/services/session.js"
    );
    const manager = createManager();
    const persisted = add(manager, 2);
    await manager.saveSession();
    const pending = add(manager, 2, 100);
    vi.mocked(loadFullMessageThread).mockResolvedValue({
      messages: persisted.map(diskMsg),
      sessionIds: ["s"],
    });

    const thread = await manager.getDisplayThread();

    expect(ids(thread)).toEqual([...persisted, ...pending]);
  });
});
