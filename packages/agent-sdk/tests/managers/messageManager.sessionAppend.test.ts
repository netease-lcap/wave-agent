import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "path";
import { MessageManager } from "../../src/managers/messageManager.js";
import { toModSessionMessages } from "../../src/managers/modManager.js";
import * as sessionService from "../../src/services/session.js";
import { Container } from "../../src/utils/container.js";
import type { Message } from "../../src/types/index.js";
import type {
  ModSessionAppendDoor,
  ModSessionMessage,
} from "../../src/types/mods.js";

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: mockWarn, error: vi.fn() },
  setGlobalLogger: vi.fn(),
  isLoggerConfigured: () => true,
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(0),
  };
});

const WORKDIR = resolve("/fake/project");

function textMessage(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    blocks: [{ type: "text", content }],
    timestamp: new Date(0).toISOString(),
  };
}

/** 一条带工具调用的 assistant 消息：宿主一个 `tool` 块 = mods 面的两块。 */
function toolMessage(id: string): Message {
  return {
    id,
    role: "assistant",
    blocks: [
      { type: "text", content: "调用工具" },
      {
        type: "tool",
        id: "call_1",
        name: "Bash",
        parameters: '{"command":"ls"}',
        result: "a.ts",
        stage: "end",
      },
    ],
    timestamp: new Date(0).toISOString(),
  };
}

/** 一个只答 `session.append` 的假 ModManager（真的那套要编译 mods）。 */
function containerWith(
  dispatch: (
    message: ModSessionMessage,
    door: ModSessionAppendDoor,
    agentId?: string,
  ) => Promise<unknown>,
): Container {
  const container = new Container();
  container.register("ModManager", { dispatchSessionAppend: dispatch });
  return container;
}

function createManager(
  container: Container,
  messages: Message[],
): MessageManager {
  const manager = new MessageManager(container, {
    workdir: WORKDIR,
    callbacks: {},
  });
  manager.setMessages(messages);
  return manager;
}

function persistedRows(): Message[] {
  const calls = vi.mocked(sessionService.appendMessages).mock.calls;
  if (calls.length === 0) return [];
  return calls[calls.length - 1]![1] as Message[];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionService.appendMessages).mockResolvedValue(0);
});

describe("session.append：消息落进转录之前", () => {
  it("插件改掉文本块：落库的是改写后的版本，内存里也是（验收场景 1）", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({
      message: {
        ...message,
        content: message.content.map((block) =>
          block.type === "text"
            ? { ...block, text: block.text.replace("sk-123", "***") }
            : block,
        ),
      },
    }));

    const manager = createManager(containerWith(dispatch), [
      textMessage("m1", "key is sk-123"),
    ]);

    await manager.saveSession();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(persistedRows()).toHaveLength(1);
    expect(persistedRows()[0]!.blocks[0]).toMatchObject({
      type: "text",
      content: "key is ***",
    });
    // 同一个会话里后续请求与 `$.session.messages()` 读的是这一版。
    expect(manager.getMessages()[0]!.blocks[0]).toMatchObject({
      content: "key is ***",
    });
  });

  it("钩子拿到的消息与 $.session.messages() 同形（验收场景 6）", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({ message }));
    const manager = createManager(containerWith(dispatch), [toolMessage("m1")]);

    await manager.saveSession();

    // 只问一次、问的是一条消息，且与读侧投影逐字段相同。
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toEqual(
      toModSessionMessages(manager.getMessages())[0],
    );
    expect(dispatch.mock.calls[0]![0]).toMatchObject({
      id: "m1",
      role: "assistant",
      content: [
        { type: "text", text: "调用工具" },
        { type: "tool_use", id: "call_1", name: "Bash" },
        { type: "tool_result", tool_use_id: "call_1", content: "a.ts" },
      ],
    });
  });

  it("door 只有 prompt / response / tool-result 三档，宿主注入的行没有门", async () => {
    const doors: string[] = [];
    const dispatch = vi.fn(
      async (message: ModSessionMessage, door: ModSessionAppendDoor) => {
        doors.push(door);
        return { message };
      },
    );
    const prompt: Message = { ...textMessage("m1", "用户敲的"), role: "user" };
    const toolResult: Message = {
      id: "m3",
      role: "user",
      blocks: [
        {
          type: "tool",
          id: "call_1",
          name: "Bash",
          parameters: '{"command":"ls"}',
          result: "a.ts",
          stage: "end",
        },
      ],
      timestamp: new Date(0).toISOString(),
    };
    const meta: Message = {
      ...textMessage("m4", "记忆注入"),
      role: "user",
      isMeta: true,
    };

    const manager = createManager(containerWith(dispatch), [
      prompt,
      textMessage("m2", "模型的回答"),
      toolResult,
      meta,
    ]);

    await manager.saveSession();

    // `note` 不在这张表里：宿主注入的行（`isMeta`）压根不派发，
    // CC 那一档是插件自己写行的门，我们没有那个入口。
    expect(doors).toEqual(["prompt", "response", "tool-result"]);
  });

  it("插件返回 { deny }：这一行不存，但仍留在界面上（验收场景 2）", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({
      message,
      uuid: message.id,
      deny: "脱敏失败，丢弃这一条",
    }));

    const manager = createManager(containerWith(dispatch), [
      textMessage("m1", "secret"),
    ]);

    await manager.saveSession();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(sessionService.appendMessages).not.toHaveBeenCalled();
    expect(manager.getMessages()).toHaveLength(1);
  });

  it("插件改了 role：按原样存并记一条 warn（验收场景 3）", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({
      message: {
        ...message,
        role: "system",
        content: message.content.map((block) =>
          block.type === "text" ? { ...block, text: "被改了" } : block,
        ),
      },
    }));

    const manager = createManager(containerWith(dispatch), [
      textMessage("m1", "原始文本"),
    ]);

    await manager.saveSession();

    expect(persistedRows()[0]).toMatchObject({ id: "m1", role: "assistant" });
    expect(persistedRows()[0]!.blocks[0]).toMatchObject({
      content: "原始文本",
    });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("改了消息的身份"),
    );
  });

  it("插件改了块的数量：按原样存并记一条 warn", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({
      message: { ...message, content: [] },
    }));

    const manager = createManager(containerWith(dispatch), [
      textMessage("m1", "原始文本"),
    ]);

    await manager.saveSession();

    expect(persistedRows()[0]!.blocks[0]).toMatchObject({
      content: "原始文本",
    });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("改了块的数量"),
    );
  });

  it("钩子抛错：消息按原样存，不因为插件坏了就丢（验收场景 5）", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });

    const manager = createManager(containerWith(dispatch), [
      textMessage("m1", "原始文本"),
    ]);

    await manager.saveSession();

    expect(persistedRows()).toHaveLength(1);
    expect(persistedRows()[0]!.blocks[0]).toMatchObject({
      content: "原始文本",
    });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("session.append 钩子失败"),
    );
  });

  it("工具块的改写落不回宿主形状：忽略并记一条 warn", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({
      message: {
        ...message,
        content: message.content.map((block) =>
          block.type === "tool_result"
            ? { ...block, content: "被改的结果" }
            : block,
        ),
      },
    }));

    const manager = createManager(containerWith(dispatch), [toolMessage("m1")]);

    await manager.saveSession();

    expect(persistedRows()[0]!.blocks[1]).toMatchObject({ result: "a.ts" });
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining("工具块的正文"),
    );
  });

  it("isMeta 的行不派发（它们不进 $.session.messages()）", async () => {
    const dispatch = vi.fn(async (message: ModSessionMessage) => ({ message }));
    const meta: Message = {
      ...textMessage("m1", "记忆注入"),
      role: "user",
      isMeta: true,
    };

    // 伴随一条真消息，否则会先被「meta-only 不落盘」那条规则截住。
    const manager = createManager(containerWith(dispatch), [
      meta,
      textMessage("m2", "真消息"),
    ]);

    await manager.saveSession();

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ id: "m2" });
    expect(persistedRows().map((row) => row.id)).toEqual(["m1", "m2"]);
  });

  it("容器里没有 ModManager 时照常落库（纯服务调用 / 测试）", async () => {
    const manager = createManager(new Container(), [
      textMessage("m1", "原始文本"),
    ]);

    await manager.saveSession();

    expect(persistedRows()).toHaveLength(1);
    expect(persistedRows()[0]!.blocks[0]).toMatchObject({
      content: "原始文本",
    });
  });
});
