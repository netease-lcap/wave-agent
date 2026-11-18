import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import { Agent } from "../../src/agent.js";
import { HookManager } from "../../src/managers/hookManager.js";
import type { Message } from "../../src/types/index.js";
import type { SessionData } from "../../src/services/session.js";

vi.mock("fs/promises");

// Only the restore lookup is stubbed; everything else in the session service
// (paths, transcript helpers) stays real so the ordering under test is the
// production one.
vi.mock("../../src/services/session.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/session.js")>();
  return { ...actual, handleSessionRestoration: vi.fn() };
});

/**
 * SessionStart 钩子与「创建时就恢复会话」的先后（spec
 * `automation/session-hooks.md` 用户故事「创建时恢复：先恢复、再跑钩子」）。
 *
 * 恢复 `restoreSessionId` / `continueLastSession` 会整表替换消息列表，所以钩子
 * 必须在恢复**之后**跑，否则注入的 `additionalContext` 被冲掉；并且这条路径的
 * `source` 是 `"resume"`（Claude Code：`SessionStart` runs again on resume so
 * hooks can refresh their context）。
 */

const workdir = "/test/workdir";

function textMessage(
  id: string,
  role: "user" | "assistant",
  text: string,
): Message {
  return {
    id,
    role,
    blocks: [{ type: "text", content: text }],
    timestamp: new Date().toISOString(),
  };
}

function restoredSession(id: string, extra: Message[] = []): SessionData {
  return {
    id,
    messages: [
      textMessage("history-1", "user", "历史第一问"),
      textMessage("history-2", "assistant", "历史第一答"),
      ...extra,
    ],
    metadata: {
      workdir,
      lastActiveAt: new Date().toISOString(),
      latestTotalTokens: 0,
    },
  };
}

function wrapped(context: string): string {
  return `<system-reminder>\nSessionStart hook additional context: ${context}\n</system-reminder>`;
}

describe("SessionStart hooks with restore-at-create", () => {
  let activeAgent: Agent | undefined;
  let sessionStart: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    // Spied on the prototype: the hook runs inside `Agent.create`, so an
    // instance-level spy would be installed too late.
    sessionStart = vi
      .spyOn(HookManager.prototype, "executeSessionStartHooks")
      .mockResolvedValue({ results: [] });
  });

  afterEach(async () => {
    sessionStart.mockRestore();
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("restoreSessionId: 钩子上下文落在恢复出的消息之后", async () => {
    const sessionId = "8f1c6a2e-4b7d-4c1e-9b0a-2d5f7c3a1e60";
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      restoredSession(sessionId),
    );
    sessionStart.mockResolvedValue({
      results: [],
      additionalContext: "恢复时的项目上下文",
    });

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      restoreSessionId: sessionId,
    });

    const messages = activeAgent.messages;
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    const last = messages[messages.length - 1];
    expect(last.isMeta).toBe(true);
    expect(last.blocks[0]).toMatchObject({
      type: "text",
      content: wrapped("恢复时的项目上下文"),
    });
  });

  it("restoreSessionId: 钩子以 resume 执行，参数指向恢复出的会话", async () => {
    const sessionId = "3a9f5c07-2b64-4e18-8d71-5c0e9a4b2f63";
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      restoredSession(sessionId),
    );

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      restoreSessionId: sessionId,
    });

    // 钩子参数描述的是「刚恢复出来的那个会话」，不是创建时那个空会话。
    expect(sessionStart).toHaveBeenCalledTimes(1);
    const [source, hookSessionId, transcriptPath] = sessionStart.mock.calls[0];
    expect(source).toBe("resume");
    expect(hookSessionId).toBe(sessionId);
    expect(transcriptPath).toBe(activeAgent.sessionFilePath);
    expect(transcriptPath).toContain(sessionId);
  });

  it("continueLastSession: 同样按 resume 注入到恢复出的消息之后", async () => {
    const sessionId = "0c4b9d31-7e26-4f88-9a3d-6b1e8f2c5d47";
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      restoredSession(sessionId),
    );
    sessionStart.mockResolvedValue({
      results: [],
      additionalContext: "续聊上下文",
    });

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      continueLastSession: true,
    });

    const messages = activeAgent.messages;
    expect(messages).toHaveLength(3);
    expect(messages[2].isMeta).toBe(true);
    expect(messages[2].blocks[0]).toMatchObject({
      type: "text",
      content: wrapped("续聊上下文"),
    });

    const [source, hookSessionId] = sessionStart.mock.calls[0];
    expect(source).toBe("resume");
    expect(hookSessionId).toBe(sessionId);
  });

  it("恢复出的对话里已有同一份上下文时不叠加第二份（平台层去重）", async () => {
    const sessionId = "5d2a7f64-9c13-4a58-b6e2-3f8d1c0b7a29";
    const previous = wrapped("恢复时的项目上下文");
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      restoredSession(sessionId, [
        {
          id: "previous-startup-context",
          role: "user",
          blocks: [{ type: "text", content: previous }],
          timestamp: new Date().toISOString(),
          isMeta: true,
        },
      ]),
    );
    sessionStart.mockResolvedValue({
      results: [],
      additionalContext: "恢复时的项目上下文",
    });

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      restoreSessionId: sessionId,
    });

    const matching = activeAgent.messages.filter((message) =>
      message.blocks.some(
        (block) => block.type === "text" && block.content === previous,
      ),
    );
    expect(matching).toHaveLength(1);
  });

  it("恢复时不注入 initialUserMessage（保持现状：仅 startup 注入）", async () => {
    const sessionId = "1e7c3b85-6a04-4d92-8f51-9c2b4e7a3d10";
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      restoredSession(sessionId),
    );
    sessionStart.mockResolvedValue({
      results: [],
      initialUserMessage: "只该在 startup 出现的指令",
    });

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      restoreSessionId: sessionId,
    });

    expect(activeAgent.messages).toHaveLength(2);
  });

  it("新会话仍是 startup：空表注入，initialUserMessage 照旧", async () => {
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(undefined);
    sessionStart.mockResolvedValue({
      results: [],
      additionalContext: "启动上下文",
      initialUserMessage: "启动指令",
    });

    activeAgent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
    });

    const messages = activeAgent.messages;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", isMeta: true });
    expect(messages[0].blocks[0]).toMatchObject({
      type: "text",
      content: wrapped("启动上下文"),
    });
    expect(messages[1]).toMatchObject({ role: "user", isMeta: true });
    expect(messages[1].blocks[0]).toMatchObject({
      type: "text",
      content: "启动指令",
    });

    const [source, hookSessionId] = sessionStart.mock.calls[0];
    expect(source).toBe("startup");
    expect(hookSessionId).not.toBe("");
  });
});
