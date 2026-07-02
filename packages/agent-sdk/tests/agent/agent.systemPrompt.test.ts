import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { Container } from "@/utils/container.js";
import { AIManager } from "@/managers/aiManager.js";
import { DEFAULT_SYSTEM_PROMPT } from "@/prompts/index.js";

/** Flatten systemPrompt (string or SystemPromptBlock[]) into a single string. */
function flattenSystemPrompt(sp: unknown): string {
  if (typeof sp === "string") return sp;
  if (Array.isArray(sp))
    return sp.map((b: { text: string }) => b.text).join("\n\n");
  return "";
}

// Mock the aiService module
vi.mock("@/services/aiService");

// Mock the toolManager
const { instance: mockToolManagerInstance } = createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memory manager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn().mockImplementation(function () {
    return {
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
    };
  }),
}));

describe("Agent - System Prompt", () => {
  let agent: Agent;
  const mockCallbacks = {
    onMessagesChange: vi.fn(),
    onLoadingChange: vi.fn(),
  };

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    vi.clearAllMocks();
  });

  /**
   * Create an agent with isolated workdir and re-created AIManager,
   * matching the pattern from agent.noParams.test.ts to avoid CI environment issues.
   */
  async function createAgent(systemPrompt?: string) {
    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-system-prompt",
      callbacks: mockCallbacks,
      ...(systemPrompt ? { systemPrompt } : {}),
    });

    // Register mock ToolManager in the agent's container
    const container = (agent as unknown as { container: Container }).container;
    container.register("ToolManager", mockToolManagerInstance);

    // Register ConfigurationService in the container
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => agent.getGatewayConfig(),
      resolveModelConfig: () => agent.getModelConfig(),
      resolveMaxInputTokens: () => agent.getMaxInputTokens(),
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => agent.getLanguage(),
      getEnvironmentVars: () =>
        (
          agent as unknown as {
            configurationService: {
              getEnvironmentVars: () => Record<string, string>;
            };
          }
        ).configurationService.getEnvironmentVars(),
    });

    // Re-initialize AIManager to pick up the mock ToolManager
    const aiManager = new AIManager(container, {
      workdir: "/tmp/test-system-prompt",
      ...(systemPrompt ? { systemPrompt } : {}),
    });
    container.register("AIManager", aiManager);
    (agent as unknown as { aiManager: AIManager }).aiManager = aiManager;

    // Mock callAgent and clear call history to ensure clean state
    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "Test response",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    mockCallAgent.mockClear();

    return mockCallAgent;
  }

  it("should use custom systemPrompt when provided during agent creation", async () => {
    const customSystemPrompt =
      "You are a specialized coding assistant that focuses on TypeScript development.";

    const mockCallAgent = await createAgent(customSystemPrompt);

    await agent.sendMessage("Help me with TypeScript");

    // Verify that callAgent was called with the custom systemPrompt
    const callArgs = mockCallAgent.mock.calls[0][0];
    const spText = flattenSystemPrompt(callArgs.systemPrompt);
    expect(spText).toContain(customSystemPrompt);
  });

  it("should work without custom systemPrompt (default behavior)", async () => {
    const mockCallAgent = await createAgent();

    await agent.sendMessage("Help me with development");

    // Verify that callAgent was called with the default systemPrompt
    const callArgs = mockCallAgent.mock.calls[0][0];
    const spText = flattenSystemPrompt(callArgs.systemPrompt);
    expect(spText).toContain(DEFAULT_SYSTEM_PROMPT);
  });
});
