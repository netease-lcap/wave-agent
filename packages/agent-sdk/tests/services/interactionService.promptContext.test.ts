import { describe, expect, it, vi } from "vitest";
import { InteractionService } from "../../src/services/interactionService.js";
import type { InteractionContext } from "../../src/services/interactionService.js";

/**
 * `prompt.submit` 的上下文注入（spec ecosystem/plugin-mods.md「轮次内外的事
 * 件」）：mod 塞的 `context` 要在本轮请求发出前就位，而且**不改用户原文**、不
 * 在界面上多出一条用户消息（走 `isMeta` 隐藏消息）。
 *
 * 这里只钉三件事：注在用户消息之后、请求之前；空 context 什么都不加；被 hook
 * 拦下的 prompt 连 mod 都不问（那一轮根本不发请求）。
 */

function buildContext(options: { shouldBlock?: boolean } = {}): {
  context: InteractionContext;
  addUserMessage: ReturnType<typeof vi.fn>;
  sendAIMessage: ReturnType<typeof vi.fn>;
  collectPromptContext: ReturnType<typeof vi.fn>;
} {
  const addUserMessage = vi.fn(() => "msg-id");
  const sendAIMessage = vi.fn(async () => {});
  const collectPromptContext = vi.fn(async () => [] as string[]);
  const context = {
    messageManager: {
      addUserMessage,
      getSessionId: () => "s1",
      getTranscriptPath: () => "/tmp/transcript.jsonl",
    },
    slashCommandManager: {
      parseAndValidateSlashCommand: () => ({ isValid: false }),
      executeCommand: vi.fn(),
    },
    hookManager: {
      executeHooks: vi.fn(async () => []),
      processHookResults: vi.fn(() => ({
        shouldBlock: options.shouldBlock ?? false,
      })),
    },
    workdir: "/tmp/work",
    configurationService: { getMergedEnv: () => ({}) },
    aiManager: {
      setIsLoading: vi.fn(),
      sendAIMessage,
    },
    subagentManager: {},
    taskManager: {},
    modManager: { collectPromptContext },
    options: {},
    abortMessage: vi.fn(),
    switchWorkdir: vi.fn(async () => {}),
  } as unknown as InteractionContext;
  return { context, addUserMessage, sendAIMessage, collectPromptContext };
}

describe("InteractionService 的 prompt.submit 上下文注入", () => {
  it("mod 塞的 context 作为隐藏 meta 消息插在请求之前，用户原文原样", async () => {
    const { context, addUserMessage, sendAIMessage, collectPromptContext } =
      buildContext();
    collectPromptContext.mockResolvedValue([
      "<watch>status: green</watch>",
      "补充",
    ]);

    await InteractionService.sendMessage(context, "用户原话");

    expect(collectPromptContext).toHaveBeenCalledWith("用户原话");
    // 第一条是用户自己那句（原样），第二条是 mod 塞的隐藏消息。
    expect(addUserMessage).toHaveBeenCalledTimes(2);
    expect(addUserMessage.mock.calls[0][0]).toMatchObject({
      content: "用户原话",
    });
    expect(addUserMessage.mock.calls[1][0]).toEqual({
      content: "<watch>status: green</watch>\n\n补充",
      isMeta: true,
    });
    // 三条的顺序就是事实：先问 mod，再插上下文，最后才发请求。第二条
    // `addUserMessage` 才是注入的那次（第一条是用户自己那句）。
    const order = [
      collectPromptContext.mock.invocationCallOrder[0],
      addUserMessage.mock.invocationCallOrder[1],
      sendAIMessage.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("没 mod 塞东西时不多插任何消息", async () => {
    const { context, addUserMessage, sendAIMessage } = buildContext();

    await InteractionService.sendMessage(context, "用户原话");

    expect(addUserMessage).toHaveBeenCalledTimes(1);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
  });

  it("prompt 被 hook 拦下时连 mod 都不问（那一轮不发请求）", async () => {
    const { context, sendAIMessage, collectPromptContext } = buildContext({
      shouldBlock: true,
    });

    await InteractionService.sendMessage(context, "用户原话");

    expect(collectPromptContext).not.toHaveBeenCalled();
    expect(sendAIMessage).not.toHaveBeenCalled();
  });

  it("没有 ModManager 的调用方照常工作（可选注入）", async () => {
    const { context, addUserMessage, sendAIMessage } = buildContext();
    delete (context as { modManager?: unknown }).modManager;

    await InteractionService.sendMessage(context, "用户原话");

    expect(addUserMessage).toHaveBeenCalledTimes(1);
    expect(sendAIMessage).toHaveBeenCalledTimes(1);
  });
});
