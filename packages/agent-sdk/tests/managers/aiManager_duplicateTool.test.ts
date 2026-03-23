import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import * as aiService from "../../src/services/aiService.js";
import type { Message } from "../../src/types/index.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compressMessages: vi.fn(),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager - Duplicate Tool Call Reminder", () => {
  let aiManager: AIManager;
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;

  beforeEach(() => {
    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMessages: vi.fn().mockReturnValue([]),
      addAssistantMessage: vi.fn(),
      addUserMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      updateToolBlock: vi.fn(),
      setMessages: vi.fn(),
      getlatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      saveSession: vi.fn().mockResolvedValue(undefined),
      setlatestTotalTokens: vi.fn(),
    } as unknown as MessageManager;

    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
    } as unknown as ToolManager;

    const container = new Container();
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue({}),
      resolveModelConfig: vi.fn().mockReturnValue({}),
      resolveMaxInputTokens: vi.fn().mockReturnValue(100000),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    });
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue(""),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      clearTemporaryRules: vi.fn(),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });
  });

  it("should add a reminder message when the same tool is called with the same arguments in consecutive turns", async () => {
    const previousAssistantMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool",
          parameters: '{"arg": "val"}',
          stage: "end",
        },
      ],
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      {
        role: "user",
        blocks: [{ type: "text", content: "result" }],
      } as unknown as Message, // Tool result message
    ]);

    vi.mocked(aiService.callAgent)
      .mockResolvedValueOnce({
        content: "Calling tool again",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "test_tool", arguments: '{"arg": "val"}' },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "You just called these tools with the same arguments in the previous turn: [test_tool]",
        ),
      }),
    );
  });

  it("should not add a reminder when the tool name is the same but arguments are different", async () => {
    const previousAssistantMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool",
          parameters: '{"arg": "val1"}',
          stage: "end",
        },
      ],
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      {
        role: "user",
        blocks: [{ type: "text", content: "result" }],
      } as unknown as Message,
    ]);

    vi.mocked(aiService.callAgent)
      .mockResolvedValueOnce({
        content: "Calling tool with different args",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "test_tool", arguments: '{"arg": "val2"}' },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addUserMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "You just called these tools with the same arguments",
        ),
      }),
    );
  });

  it("should not add a reminder when the tool name is different", async () => {
    const previousAssistantMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool_1",
          parameters: '{"arg": "val"}',
          stage: "end",
        },
      ],
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      {
        role: "user",
        blocks: [{ type: "text", content: "result" }],
      } as unknown as Message,
    ]);

    vi.mocked(aiService.callAgent)
      .mockResolvedValueOnce({
        content: "Calling different tool",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "test_tool_2", arguments: '{"arg": "val"}' },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addUserMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(
          "You just called these tools with the same arguments",
        ),
      }),
    );
  });

  it("should include all duplicate tool names in the reminder", async () => {
    const previousAssistantMessage: Message = {
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "tool1",
          parameters: '{"a": 1}',
          stage: "end",
        },
        {
          type: "tool",
          name: "tool2",
          parameters: '{"b": 2}',
          stage: "end",
        },
      ],
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      {
        role: "user",
        blocks: [{ type: "text", content: "result" }],
      } as unknown as Message,
    ]);

    vi.mocked(aiService.callAgent)
      .mockResolvedValueOnce({
        content: "Calling both tools again",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "tool1", arguments: '{"a": 1}' },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "tool2", arguments: '{"b": 2}' },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("[tool1, tool2]"),
      }),
    );
  });
});
