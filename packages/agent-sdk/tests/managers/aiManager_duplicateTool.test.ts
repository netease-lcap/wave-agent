import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import * as aiService from "../../src/services/aiService.js";
import type { Message } from "../../src/types/index.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";

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
  compactMessages: vi.fn(),
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
      getLatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      saveSession: vi.fn().mockResolvedValue(undefined),
      setlatestTotalTokens: vi.fn(),
      addErrorBlock: vi.fn(),
      finalizeStreamingBlocks: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
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
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool",
          parameters: '{"arg": "val"}',
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const currentAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          id: "call_1",
          name: "test_tool",
          parameters: '{"arg": "val"}',
          result: "test result",
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      currentAssistantMessage,
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

    expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_1",
        result: expect.stringContaining(
          "Note: You just called this tool with the same arguments in the previous turn.",
        ),
      }),
    );
  });

  it("should not add a reminder when the tool name is the same but arguments are different", async () => {
    const previousAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool",
          parameters: '{"arg": "val1"}',
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const currentAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          id: "call_1",
          name: "test_tool",
          parameters: '{"arg": "val2"}',
          result: "test result",
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      currentAssistantMessage,
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

    expect(mockMessageManager.updateToolBlock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.stringContaining(
          "Note: You just called this tool with the same arguments",
        ),
      }),
    );
  });

  it("should not add a reminder when the tool name is different", async () => {
    const previousAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "test_tool_1",
          parameters: '{"arg": "val"}',
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    const currentAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          id: "call_1",
          name: "test_tool_2",
          parameters: '{"arg": "val"}',
          result: "test result",
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      currentAssistantMessage,
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

    expect(mockMessageManager.updateToolBlock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.stringContaining(
          "Note: You just called this tool with the same arguments",
        ),
      }),
    );
  });

  it("should include reminders for all duplicate tool calls", async () => {
    const previousAssistantMessage: Message = {
      id: generateMessageId(),
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
      timestamp: new Date().toISOString(),
    };

    const currentAssistantMessage: Message = {
      id: generateMessageId(),
      role: "assistant",
      blocks: [
        {
          type: "tool",
          id: "call_1",
          name: "tool1",
          parameters: '{"a": 1}',
          result: "result 1",
          stage: "end",
        },
        {
          type: "tool",
          id: "call_2",
          name: "tool2",
          parameters: '{"b": 2}',
          result: "result 2",
          stage: "end",
        },
      ],
      timestamp: new Date().toISOString(),
    };

    vi.mocked(mockMessageManager.getMessages).mockReturnValue([
      previousAssistantMessage,
      currentAssistantMessage,
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

    expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_1",
        result: expect.stringContaining(
          "Note: You just called this tool with the same arguments",
        ),
      }),
    );
    expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_2",
        result: expect.stringContaining(
          "Note: You just called this tool with the same arguments",
        ),
      }),
    );
  });
});
