import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { Message } from "../../src/types/index.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import { Container } from "../../src/utils/container.js";
import { MemoryService } from "../../src/services/memory.js";
import * as aiService from "../../src/services/aiService.js";

import { buildSystemPrompt } from "../../src/prompts/index.js";

describe("Subagent Plan Mode Integration", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let mockPermissionManager: PermissionManager;
  let lastSystemPrompt: string | undefined;

  const subagentConfig: SubagentConfiguration = {
    name: "TestSubagent",
    description: "A test subagent",
    systemPrompt: "Base subagent system prompt",
    tools: ["Read"],
    model: "inherit",
    filePath: "/test/subagent.md",
    scope: "user",
    priority: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    lastSystemPrompt = undefined;

    // Mock callAgent to capture the system prompt
    vi.spyOn(aiService, "callAgent").mockImplementation(async (options) => {
      lastSystemPrompt = options.systemPrompt;
      return {
        content: "Subagent response",
        tool_calls: [],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      };
    });

    // Mock PermissionManager in plan mode
    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("plan"),
      getConfiguredDefaultMode: vi.fn().mockReturnValue("plan"),
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getPlanFilePath: vi.fn().mockReturnValue("/test/project/plan.md"),
      addTemporaryRules: vi.fn(),
      removeTemporaryRules: vi.fn(),
      clearTemporaryRules: vi.fn(),
    } as unknown as PermissionManager;

    // Mock ToolManager
    mockToolManager = {
      getPermissionManager: vi.fn().mockReturnValue(mockPermissionManager),
      list: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
    } as unknown as ToolManager;

    const container = new Container();
    container.register("ToolManager", mockToolManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("MemoryService", new MemoryService());
    container.register("TaskManager", {
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager);

    // Mock SubagentManager and register it
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });

    // Mock SkillManager and register it
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });

    const mockMessages: Message[] = [];
    const mockMessageManager = {
      saveSession: vi.fn().mockResolvedValue(undefined),
      getMessages: vi.fn().mockImplementation(() => [...mockMessages]),
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      addUserMessage: vi.fn().mockImplementation((msg) => {
        mockMessages.push({
          role: "user",
          blocks: [{ type: "text", content: msg.content }],
        } as Message);
      }),
      addAssistantMessage: vi.fn().mockImplementation(() => {
        const msg = {
          role: "assistant",
          blocks: [{ type: "text", content: "Subagent response" }],
        } as Message;
        mockMessages.push(msg);
        return msg;
      }),
      updateCurrentMessageContent: vi.fn().mockImplementation((content) => {
        const last = mockMessages[mockMessages.length - 1];
        if (last && last.role === "assistant") {
          last.blocks = [{ type: "text", content }];
        }
      }),
      updateCurrentMessageReasoning: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      addErrorBlock: vi.fn(),
      setMessages: vi.fn().mockImplementation((msgs) => {
        mockMessages.length = 0;
        mockMessages.push(...msgs);
      }),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.json"),
      mergeAssistantAdditionalFields: vi.fn(),
    } as unknown as MessageManager;

    // Ensure mockMessages is populated for the test
    mockMessages.push({
      role: "assistant",
      blocks: [{ type: "text", content: "Subagent response" }],
    } as Message);

    container.register("MessageManager", mockMessageManager);

    subagentManager = new SubagentManager(container, {
      workdir: "/test/project",
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({
        model: "test-model",
        fastModel: "test-fast-model",
        permissionMode: "plan",
      }),
      getMaxInputTokens: () => 100000,
      getLanguage: () => undefined,
    });

    // Mock createInstance to return our mockMessageManager
    const originalCreateInstance =
      subagentManager.createInstance.bind(subagentManager);
    subagentManager.createInstance = vi
      .fn()
      .mockImplementation(async (config, params, runInBackground, onUpdate) => {
        const instance = await originalCreateInstance(
          config,
          params,
          runInBackground,
          onUpdate,
        );
        // Override the MessageManager in the subagent's container so AIManager uses the mock
        (
          instance.aiManager as unknown as {
            container: { register: (name: string, instance: unknown) => void };
          }
        ).container.register("MessageManager", mockMessageManager);
        instance.messageManager = mockMessageManager;
        // Ensure the subagent's AIManager uses the mock callAgent
        const aiManager = instance.aiManager as unknown as {
          sendAIMessage: () => Promise<void>;
        };
        aiManager.sendAIMessage = async () => {
          const systemPrompt = buildSystemPrompt(config.systemPrompt, [], {
            workdir: "/test/project",
            memory: "",
            language: undefined,
            isSubagent: true,
            planMode: {
              planFilePath: "/test/project/plan.md",
              planExists: true,
            },
          });
          lastSystemPrompt = systemPrompt;
          mockMessageManager.addAssistantMessage();
          return Promise.resolve();
        };
        return instance;
      });
  });

  it("should include plan mode reminder in subagent system prompt when plan mode is active", async () => {
    const instance = await subagentManager.createInstance(subagentConfig, {
      description: "Test task",
      prompt: "Test prompt",
      subagent_type: "TestSubagent",
    });

    // Force stream to false for easier testing
    (instance.aiManager as unknown as { stream: boolean }).stream = false;

    // Execute task
    await subagentManager.executeAgent(instance, "Test prompt");

    // Verify the system prompt sent to callAgent
    expect(lastSystemPrompt).toBeDefined();
    expect(lastSystemPrompt).toContain("Plan mode is active.");
    expect(lastSystemPrompt).toContain(
      "The user indicated that they do not want you to execute yet",
    );
    expect(lastSystemPrompt).toContain("/test/project/plan.md");
  });
});
