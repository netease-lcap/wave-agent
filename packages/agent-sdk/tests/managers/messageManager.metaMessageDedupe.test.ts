import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";

vi.mock("fs/promises", () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    loadFullMessageThread: vi.fn().mockImplementation(async (sessionId) => ({
      messages: [],
      sessionIds: [sessionId],
    })),
  };
});

vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
}));

/**
 * 平台层去重（Claude Code changelog 2.1.295 的语义）：同一份注入内容已在对话
 * 里就不再追加，内容变了就刷新，压缩把副本折进摘要后下次再加回来。
 *
 * 这四个 case 是四个注入点共用的**同一份判断**，所以钉在这里；各注入点的接线
 * 另有各自的测试。
 */
describe("MessageManager - meta message dedupe", () => {
  const workdir = "/test/workdir";
  const INJECTED = `<system-reminder>\nSessionStart hook additional context: project notes\n</system-reminder>`;

  let messageManager: MessageManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    } as unknown as Record<string, unknown>);
    messageManager = new MessageManager(container, { callbacks: {}, workdir });
  });

  const metaTexts = () =>
    messageManager
      .getMessages()
      .filter((message) => message.isMeta)
      .flatMap((message) =>
        message.blocks.flatMap((block) =>
          block.type === "text" ? [block.content] : [],
        ),
      );

  it("skips the copy that is already in the conversation", () => {
    expect(messageManager.addMetaMessageIfAbsent(INJECTED)).toBe(true);
    expect(messageManager.addMetaMessageIfAbsent(INJECTED)).toBe(false);

    expect(metaTexts()).toEqual([INJECTED]);
  });

  it("appends when the content changed, so a stale copy is refreshed", () => {
    messageManager.addMetaMessageIfAbsent(INJECTED);

    const changed = `<system-reminder>\nSessionStart hook additional context: project notes v2\n</system-reminder>`;
    expect(messageManager.addMetaMessageIfAbsent(changed)).toBe(true);

    expect(metaTexts()).toEqual([INJECTED, changed]);
  });

  it("does not treat a real user message with the same text as the injected copy", () => {
    // 用户自己打出一模一样的文本不该挡住注入：判据是「meta 用户消息」。
    messageManager.addUserMessage({ content: INJECTED });

    expect(messageManager.addMetaMessageIfAbsent(INJECTED)).toBe(true);
    expect(metaTexts()).toEqual([INJECTED]);
  });

  it("appends again after /clear, which empties the list", () => {
    messageManager.addMetaMessageIfAbsent(INJECTED);
    messageManager.clearMessages();

    expect(messageManager.addMetaMessageIfAbsent(INJECTED)).toBe(true);
    expect(metaTexts()).toEqual([INJECTED]);
  });

  it("appends again after compaction, whose fold drops the old copy", async () => {
    // 实证：会话文件是追加式保存的，但去重看的是**内存列表**。压缩把它折成
    // `[summary, ...最近两轮]`，落在头部的那份副本就不再是列表的一部分。
    messageManager.addMetaMessageIfAbsent(INJECTED);
    messageManager.addUserMessage({ content: "first question" });
    messageManager.addAssistantMessage("first answer");
    messageManager.addUserMessage({ content: "second question" });
    messageManager.addAssistantMessage("second answer");

    await messageManager.compactMessagesAndUpdateSession("summary of it all");

    expect(metaTexts()).toEqual([]);
    expect(messageManager.getMessages()[0].blocks[0]).toMatchObject({
      type: "compact",
    });

    expect(messageManager.addMetaMessageIfAbsent(INJECTED)).toBe(true);
    expect(metaTexts()).toEqual([INJECTED]);
  });
});
