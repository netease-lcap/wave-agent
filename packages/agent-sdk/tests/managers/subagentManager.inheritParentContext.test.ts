/**
 * @file `inheritParentContext` (the fork a `/subtask` starts) and the
 * `/subtask` command's refusal branches.
 *
 * The fork's one risk is contamination, so the snapshot tests assert both
 * directions: the subagent never gains messages the parent appends later, and
 * the parent never gains the subagent's own turns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type {
  GatewayConfig,
  Message,
  ModelConfig,
} from "../../src/types/index.js";
import { EXIT_PLAN_MODE_TOOL_NAME } from "../../src/constants/tools.js";

import { Container } from "../../src/utils/container.js";

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../src/services/aiService.js", () => ({
  sendAIMessage: vi.fn().mockResolvedValue({
    content: "Mock AI response",
    toolCalls: [],
    usage: { totalTokens: 10 },
  }),
}));
vi.mock("../../src/utils/customCommands.js", () => ({
  loadCustomSlashCommands: vi.fn().mockReturnValue([]),
}));

const FORK_CONFIG: SubagentConfiguration = {
  name: "fork",
  description: "This session, continued with its full conversation.",
  disallowedTools: [EXIT_PLAN_MODE_TOOL_NAME],
  systemPrompt: "",
  filePath: "",
  scope: "builtin",
  priority: 0,
};

/**
 * A parent conversation carrying the three shapes a fork has to bring along:
 * plain text, an assistant turn with a finished tool call (its result included
 * — nothing may be re-run), and a second user turn.
 *
 * Built per test: the isolation assertions mutate the parent's blocks in place
 * to prove the subagent holds a copy, and a shared fixture would leak that.
 */
function parentConversation(): Message[] {
  return [
    {
      id: "msg-user-1",
      role: "user",
      timestamp: "2026-11-18T10:00:00.000Z",
      blocks: [{ type: "text", content: "把 auth 流程讲一遍", stage: "end" }],
    },
    {
      id: "msg-assistant-1",
      role: "assistant",
      timestamp: "2026-11-18T10:00:05.000Z",
      blocks: [
        { type: "text", content: "auth 走的是 src/auth.ts", stage: "end" },
        {
          type: "tool",
          id: "call-1",
          name: "Read",
          parameters: '{"file_path":"/repo/src/auth.ts"}',
          stage: "end",
          success: true,
          result: "export function login() {}",
        },
      ],
    },
    {
      id: "msg-user-2",
      role: "user",
      timestamp: "2026-11-18T10:00:10.000Z",
      blocks: [{ type: "text", content: "那把它改成 JWT", stage: "end" }],
    },
  ];
}

let parentMessages: Message[] = parentConversation();

/** Text of every text block in the list, in order — the readable fingerprint. */
function textOf(messages: Message[]): string[] {
  return messages.flatMap((message) =>
    message.blocks.flatMap((block) =>
      block.type === "text" ? [block.content] : [],
    ),
  );
}

describe("SubagentManager - inheritParentContext", () => {
  let subagentManager: SubagentManager;
  let parentMessageManager: MessageManager;
  let container: Container;

  beforeEach(async () => {
    container = new Container();
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("default"),
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue([]),
      getInstanceAllowedRules: vi.fn().mockReturnValue([]),
      getInstanceDeniedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
      getBypassAuthorization: vi.fn().mockReturnValue(false),
    } as unknown as Record<string, unknown>);
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);
    container.register("McpManager", {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as Record<string, unknown>);

    container.register("ToolManager", new ToolManager({ container }));

    const mockGatewayConfig: GatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };
    const mockModelConfig: ModelConfig = {
      model: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => mockGatewayConfig,
      resolveModelConfig: () => mockModelConfig,
      resolveContextWindow: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
    });

    // The parent session's manager, which is where the snapshot comes from.
    parentMessageManager = new MessageManager(container, {
      callbacks: {},
      workdir: "/tmp/test",
    });
    container.register("MessageManager", parentMessageManager);

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
    await subagentManager.initialize();

    parentMessages = parentConversation();
    parentMessageManager.setMessages(parentMessages);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts the subagent from an in-order copy of the parent's messages", async () => {
    const instance = await subagentManager.createInstance(FORK_CONFIG, {
      description: "把接口改成 JWT",
      prompt: "按我们刚讨论的方案把那个接口改了",
      subagent_type: "fork",
      inheritParentContext: true,
    });

    const inherited = instance.messageManager.getMessages();

    expect(inherited).toHaveLength(parentMessages.length);
    expect(inherited.map((message) => message.id)).toEqual(
      parentMessages.map((message) => message.id),
    );
    expect(inherited).toEqual(parentMessages);
    expect(textOf(inherited)).toEqual(textOf(parentMessages));

    // A copy, not a second reference to the parent's objects.
    expect(inherited[0]).not.toBe(parentMessages[0]);
    expect(inherited[1].blocks[1]).not.toBe(parentMessages[1].blocks[1]);

    // Tool history travels as history: the finished call keeps its result and
    // is never re-executed.
    expect(inherited[1].blocks[1]).toMatchObject({
      type: "tool",
      stage: "end",
      result: "export function login() {}",
    });

    // Snapshot, not a view: editing the parent's block in place afterwards
    // cannot reach the subagent's copy.
    (parentMessages[1].blocks[1] as { result?: string }).result = "改成了 JWT";
    expect(inherited[1].blocks[1]).toMatchObject({
      result: "export function login() {}",
    });
  });

  it("appends the task prompt after the inherited history", async () => {
    const instance = await subagentManager.createInstance(FORK_CONFIG, {
      description: "把接口改成 JWT",
      prompt: "按我们刚讨论的方案把那个接口改了",
      subagent_type: "fork",
      inheritParentContext: true,
    });

    // What `internalExecute` does once the instance is created.
    instance.messageManager.addUserMessage({
      content: "按我们刚讨论的方案把那个接口改了",
    });

    const messages = instance.messageManager.getMessages();
    expect(messages).toHaveLength(parentMessages.length + 1);
    expect(messages.slice(0, parentMessages.length)).toEqual(parentMessages);
    expect(messages[parentMessages.length].blocks[0]).toMatchObject({
      type: "text",
      content: "按我们刚讨论的方案把那个接口改了",
    });
  });

  it("keeps both sessions apart after the snapshot is taken", async () => {
    const instance = await subagentManager.createInstance(FORK_CONFIG, {
      description: "把接口改成 JWT",
      prompt: "按我们刚讨论的方案把那个接口改了",
      subagent_type: "fork",
      inheritParentContext: true,
    });
    const snapshot = instance.messageManager.getMessages();

    // The parent keeps talking while the subtask runs: none of it is the
    // subtask's context.
    parentMessageManager.addUserMessage({
      content: "先别急着动，我还有个问题",
    });
    expect(instance.messageManager.getMessages()).toEqual(snapshot);

    // …and the subtask's own turns never reach the parent.
    instance.messageManager.addUserMessage({ content: "任务提示" });
    instance.messageManager.addAssistantMessage("已经改成 JWT 了");

    const parentNow = parentMessageManager.getMessages();
    expect(parentNow).toHaveLength(parentMessages.length + 1);
    expect(textOf(parentNow)).not.toContain("已经改成 JWT 了");
    expect(textOf(parentNow)).not.toContain("任务提示");
  });

  it("starts from nothing when the switch is off", async () => {
    const instance = await subagentManager.createInstance(FORK_CONFIG, {
      description: "把接口改成 JWT",
      prompt: "按我们刚讨论的方案把那个接口改了",
      subagent_type: "fork",
    });

    expect(instance.messageManager.getMessages()).toEqual([]);

    instance.messageManager.addUserMessage({
      content: "按我们刚讨论的方案把那个接口改了",
    });
    expect(textOf(instance.messageManager.getMessages())).toEqual([
      "按我们刚讨论的方案把那个接口改了",
    ]);
  });
});

describe("SlashCommandManager - /subtask", () => {
  let addNoticeBlock: ReturnType<typeof vi.fn>;
  let addUserMessage: ReturnType<typeof vi.fn>;
  let createInstance: ReturnType<typeof vi.fn>;
  let executeAgent: ReturnType<typeof vi.fn>;
  let slashCommandManager: SlashCommandManager;

  // A real id is a UUID; only its last four characters are ever shown.
  const SUBAGENT_ID = "subagent-9f2d";

  function build(messages: Message[]): void {
    const container = new Container();
    addNoticeBlock = vi.fn();
    addUserMessage = vi.fn().mockReturnValue("msg-receipt");
    const messageManager = {
      getMessages: () => messages,
      addNoticeBlock,
      addUserMessage,
      saveSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageManager;
    container.register("MessageManager", messageManager);

    createInstance = vi.fn().mockResolvedValue({ subagentId: SUBAGENT_ID });
    executeAgent = vi.fn().mockResolvedValue("task-1");
    container.register("SubagentManager", {
      createInstance,
      executeAgent,
    } as unknown as SubagentManager);

    // No AIManager in the container on purpose: the parent must never take a
    // loading state, so a call to it would surface as a failure notice.
    slashCommandManager = new SlashCommandManager(container, {
      workdir: "/tmp/test",
    });
    slashCommandManager.initialize();
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is registered under the command table every host receives", () => {
    build(parentMessages);

    expect(slashCommandManager.getCommand("subtask")).toMatchObject({
      id: "subtask",
      name: "subtask",
      description:
        "Send a subagent off with your full context; its result comes back here",
      argumentHint: "<task>",
    });
  });

  it("refuses an empty task with the usage line", async () => {
    build(parentMessages);

    await slashCommandManager.executeCommand("subtask", "   ");

    expect(addNoticeBlock).toHaveBeenCalledWith(
      "Usage: /subtask <task>",
      "error",
    );
    expect(createInstance).not.toHaveBeenCalled();
    expect(executeAgent).not.toHaveBeenCalled();
  });

  it("refuses before the first conversation turn", async () => {
    build([]);

    await slashCommandManager.executeCommand("subtask", "改个接口");

    expect(addNoticeBlock).toHaveBeenCalledWith(
      "Cannot start a subtask before the first conversation turn",
      "error",
    );
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("does not count its own refusals as a conversation turn", async () => {
    // A notice-only session is what a refused `/subtask` leaves behind.
    build([
      {
        id: "msg-assistant-notice",
        role: "assistant",
        timestamp: "2026-11-18T10:00:00.000Z",
        blocks: [
          { type: "notice", level: "error", content: "Usage: /subtask <task>" },
        ],
      },
    ]);

    await slashCommandManager.executeCommand("subtask", "改个接口");

    expect(addNoticeBlock).toHaveBeenCalledWith(
      "Cannot start a subtask before the first conversation turn",
      "error",
    );
    expect(createInstance).not.toHaveBeenCalled();
  });

  it("starts a background fork with the parent's context and does not load the parent", async () => {
    build(parentMessages);

    await slashCommandManager.executeCommand(
      "subtask",
      "帮我改接口\n然后跑一下测试",
    );

    expect(createInstance).toHaveBeenCalledTimes(1);
    const [configuration, parameters] = createInstance.mock.calls[0] as [
      SubagentConfiguration,
      Record<string, unknown>,
    ];

    expect(configuration).toMatchObject({
      name: "fork",
      scope: "builtin",
      systemPrompt: "",
    });
    expect(configuration.disallowedTools).toContain(EXIT_PLAN_MODE_TOOL_NAME);

    expect(parameters).toMatchObject({
      prompt: "帮我改接口\n然后跑一下测试",
      // First line only: this is what the task list and the completion
      // notification quote.
      description: "帮我改接口",
      subagent_type: "fork",
      inheritParentContext: true,
      maxTurns: 200,
    });
    // The fork runs on the parent's model: no override is passed.
    expect(parameters.model).toBeUndefined();
    // …and on the parent's permission mode: no override shadows it either.
    expect(parameters.permissionModeOverride).toBeUndefined();

    expect(executeAgent).toHaveBeenCalledWith(
      { subagentId: SUBAGENT_ID },
      "帮我改接口\n然后跑一下测试",
      undefined,
      true,
    );
    // Nothing failed, so the parent never took a loading state, never ran an
    // AI turn, and reported no error to the user.
    expect(addNoticeBlock).not.toHaveBeenCalledWith(
      expect.any(String),
      "error",
    );
  });

  it("leaves a receipt the user can see and the model is told about", async () => {
    build(parentMessages);

    await slashCommandManager.executeCommand(
      "subtask",
      "帮我改接口\n然后跑一下测试",
    );

    // The user-facing half: one line saying the fork went out, in the
    // non-error level (a notice never reaches `convertMessagesForAPI`).
    expect(addNoticeBlock).toHaveBeenCalledTimes(1);
    expect(addNoticeBlock).toHaveBeenCalledWith(
      "⑂ forked 帮我改接口 (9f2d)",
      "info",
    );

    // The model-facing half: hidden from the transcript, read by the model.
    expect(addUserMessage).toHaveBeenCalledTimes(1);
    const [receipt] = addUserMessage.mock.calls[0] as [
      { content: string; isMeta?: boolean },
    ];
    expect(receipt.isMeta).toBe(true);
    expect(receipt.content).toContain("帮我改接口");
    expect(receipt.content).toContain("后台任务通知");
  });
});
