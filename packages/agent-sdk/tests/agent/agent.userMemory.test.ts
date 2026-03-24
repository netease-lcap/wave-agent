import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/types/index.js";
import { generateMessageId } from "@/utils/messageOperations.js";

// Mock os module
vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/mock/home"),
    tmpdir: vi.fn(() => "/mock/tmp"),
    platform: vi.fn(() => "linux"),
    type: vi.fn(() => "Linux"),
    release: vi.fn(() => "1.2.3"),
  },
  homedir: vi.fn(() => "/mock/home"),
  tmpdir: vi.fn(() => "/mock/tmp"),
  platform: vi.fn(() => "linux"),
  type: vi.fn(() => "Linux"),
  release: vi.fn(() => "1.2.3"),
}));

// Mock the aiService
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  compressMessages: vi.fn().mockResolvedValue("Compressed content"),
}));

// Mock memory
const mockMemoryServiceInstance = vi.hoisted(() => ({
  getUserMemoryContent: vi.fn().mockResolvedValue("User memory content"),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue("Project memory content"),
  getCombinedMemoryContent: vi
    .fn()
    .mockResolvedValue("Combined memory content"),
  getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
  ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
  getAutoMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
}));

describe("Agent User Memory Integration", () => {
  let agent: Agent;
  let mockCallbacks: AgentCallbacks;
  let mockTempDir: string;

  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockGetCombinedMemoryContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Set up mock directory path
    mockTempDir = "/mock/tmp/aimanager-test-123";

    // Get mock references after module imports
    const aiService = await import("../../src/services/aiService.js");

    mockCallAgent = vi.mocked(aiService.callAgent);
    mockGetCombinedMemoryContent = vi.mocked(
      mockMemoryServiceInstance.getCombinedMemoryContent,
    );

    // Reset all mocks
    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
    };

    agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    // Clean up
    if (agent) {
      await agent.destroy();
    }
    vi.clearAllMocks();
  });

  it("should read and combine project and user memory when sending AI message", async () => {
    // Set up mock return values
    mockGetCombinedMemoryContent.mockResolvedValue(
      "Project memory: important context\n\nUser memory: user preferences",
    );

    // Create a new Agent to pick up the new mocks
    if (agent) {
      await agent.destroy();
    }
    agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with combined memory
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining(
          "Project memory: important context\n\nUser memory: user preferences",
        ),
      }),
    );
  });

  it("should handle project memory only when user memory is empty", async () => {
    // Set up mock return values
    mockGetCombinedMemoryContent.mockResolvedValue("Project memory only");

    // Create a new Agent to pick up the new mocks
    if (agent) {
      await agent.destroy();
    }
    agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with project memory only
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("Project memory only"),
      }),
    );
  });

  it("should handle user memory only when project memory is empty", async () => {
    // Set up mock return values
    mockGetCombinedMemoryContent.mockResolvedValue("User memory only");

    // Create a new Agent to pick up the new mocks
    if (agent) {
      await agent.destroy();
    }
    agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with user memory only
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining("User memory only"),
      }),
    );
  });

  it("should handle empty memory gracefully", async () => {
    // Set up mock return values for empty memory
    mockGetCombinedMemoryContent.mockResolvedValue("");

    // Create a new Agent to pick up the new mocks
    if (agent) {
      await agent.destroy();
    }
    agent = await Agent.create({
      workdir: mockTempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with empty memory
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.not.stringContaining("## Memory Context"),
      }),
    );
  });

  it("should handle memory file read errors gracefully", async () => {
    // Set up mock to throw errors
    mockGetCombinedMemoryContent.mockRejectedValue(
      new Error("Failed to read memory"),
    );

    // Create a new Agent to pick up the new mocks
    if (agent) {
      await agent.destroy();
    }

    // Add a user message first with correct structure
    const initialMessages = [
      {
        id: generateMessageId(),
        role: "user" as const,
        blocks: [
          {
            type: "text" as const,
            content: "Test question",
          },
        ],
      },
    ];

    agent = await Agent.create({
      workdir: mockTempDir,
      messages: initialMessages,
    });

    // Send message - should handle errors gracefully by adding error block
    await agent.sendMessage("Test question");

    // Verify that callAgent was not called due to the error
    expect(mockCallAgent).not.toHaveBeenCalled();

    // Verify that an error block was added to handle the memory read error
    const messages = agent.messages;
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.blocks.some((block) => block.type === "error")).toBe(
      true,
    );
  });

  it("should create separate instances for different workdirs", async () => {
    // Set up mock directory paths
    const mockTempDir1 = "/mock/tmp/test1-123";
    const mockTempDir2 = "/mock/tmp/test2-456";

    // Create agent for first manager
    const agent1 = await Agent.create({
      workdir: mockTempDir1,
      callbacks: mockCallbacks,
    });

    // Create agent for second manager
    const agent2 = await Agent.create({
      workdir: mockTempDir2,
      callbacks: mockCallbacks,
    });

    // Both managers should work independently
    expect(agent1).toBeInstanceOf(Agent);
    expect(agent2).toBeInstanceOf(Agent);

    // Clean up
    await agent1.destroy();
    await agent2.destroy();
  });
});
