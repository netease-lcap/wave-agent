import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import fs from "node:fs/promises";
import { callAgent } from "../../src/services/aiService.js";
import { DEFAULT_SYSTEM_PROMPT } from "../../src/prompts/index.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

vi.mock("node:fs/promises");
vi.mock("../../src/services/aiService.js");
vi.mock("../../src/services/memory.js");

describe("AIManager Plan Mode Prompt", () => {
  let aiManager: AIManager;
  let mockMessageManager: Mocked<MessageManager>;
  let mockToolManager: Mocked<ToolManager>;
  let mockPermissionManager: Mocked<PermissionManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getMessages: vi.fn().mockReturnValue([]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      addAssistantMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      addErrorBlock: vi.fn(),
    } as unknown as Mocked<MessageManager>;
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
    } as unknown as Mocked<ToolManager>;
    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue("/path/to/plan.md"),
      clearTemporaryRules: vi.fn(),
    } as unknown as Mocked<PermissionManager>;

    aiManager = new AIManager({
      messageManager: mockMessageManager,
      toolManager: mockToolManager,
      taskManager: {} as unknown as TaskManager,
      permissionManager: mockPermissionManager,
      workdir: "/test/workdir",
      getGatewayConfig: () => ({}) as GatewayConfig,
      getModelConfig: () => ({ agentModel: "gpt-4" }) as ModelConfig,
      getMaxInputTokens: () => 1000,
      getLanguage: () => undefined,
    });

    vi.mocked(callAgent).mockResolvedValue({
      content: "hello",
      finish_reason: "stop",
    });
  });

  it("should use default system prompt in default mode", async () => {
    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(DEFAULT_SYSTEM_PROMPT),
      }),
    );
  });

  it("should add plan reminder in plan mode when file does not exist", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    expect(callOptions.systemPrompt).toContain("Plan File Info");
    expect(callOptions.systemPrompt).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(callOptions.systemPrompt).toContain("No plan file exists yet");
    expect(callOptions.systemPrompt).toContain("using the Write tool");
  });

  it("should add plan reminder in plan mode when file exists", async () => {
    mockPermissionManager.getCurrentEffectiveMode.mockReturnValue("plan");
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    const callOptions = vi.mocked(callAgent).mock.calls[0][0];
    expect(callOptions.systemPrompt).toContain("Plan File Info");
    expect(callOptions.systemPrompt).toContain(
      "Plan mode is active. The user indicated that they do not want you to execute yet",
    );
    expect(callOptions.systemPrompt).toContain("A plan file already exists");
    expect(callOptions.systemPrompt).toContain("using the Edit tool");
  });
});
