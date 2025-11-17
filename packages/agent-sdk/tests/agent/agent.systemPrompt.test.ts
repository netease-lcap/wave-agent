import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";

// Mock the aiService module
vi.mock("@/services/aiService");

// Mock the toolManager
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
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
  createMemoryManager: vi.fn(() => ({
    getUserMemoryContent: vi.fn().mockResolvedValue(""),
  })),
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

  it("should use custom systemPrompt when provided during agent creation", async () => {
    const customSystemPrompt =
      "You are a specialized coding assistant that focuses on TypeScript development.";

    agent = await Agent.create({
      callbacks: mockCallbacks,
      systemPrompt: customSystemPrompt,
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "Test response",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    await agent.sendMessage("Help me with TypeScript");

    // Verify that callAgent was called with the custom systemPrompt
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: customSystemPrompt,
      }),
    );
  });

  it("should work without custom systemPrompt (default behavior)", async () => {
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "Test response",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    await agent.sendMessage("Help me with development");

    // Verify that callAgent was called without systemPrompt (should be undefined)
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: undefined,
      }),
    );
  });
});
