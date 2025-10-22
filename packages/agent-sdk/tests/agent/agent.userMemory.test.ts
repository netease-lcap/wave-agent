import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Mock the aiService
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  compressMessages: vi.fn().mockResolvedValue("Compressed content"),
}));

// Mock the session service
vi.mock("@/services/session", () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

// Mock memory
vi.mock("@/services/memory", () => ({
  addMemory: vi.fn().mockResolvedValue(undefined),
  isMemoryMessage: vi.fn().mockReturnValue(true),
  addUserMemory: vi.fn().mockResolvedValue(undefined),
  getUserMemoryContent: vi.fn().mockResolvedValue("User memory content"),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue("Project memory content"),
  getCombinedMemoryContent: vi
    .fn()
    .mockResolvedValue("Combined memory content"),
}));

describe("Agent User Memory Integration", () => {
  let agent: Agent;
  let mockCallbacks: AgentCallbacks;
  let tempDir: string;

  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockGetCombinedMemoryContent: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimanager-test-"));

    // Get mock references after module imports
    const { callAgent } = await import("@/services/aiService.js");
    const memory = await import("@/services/memory.js");

    mockCallAgent = vi.mocked(callAgent);
    mockGetCombinedMemoryContent = vi.mocked(memory.getCombinedMemoryContent);

    // Reset all mocks
    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
    };

    agent = await Agent.create({
      workdir: tempDir,
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    // Clean up
    if (agent) {
      await agent.destroy();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
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
      workdir: tempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with combined memory
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory:
          "Project memory: important context\n\nUser memory: user preferences",
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
      workdir: tempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with project memory only
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: "Project memory only",
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
      workdir: tempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with user memory only
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: "User memory only",
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
      workdir: tempDir,
      callbacks: mockCallbacks,
    });

    // Send a message to trigger AI response with memory
    await agent.sendMessage("Test question");

    // Verify that callAgent was called with empty memory
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: "",
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
      workdir: tempDir,
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
    // Create temporary directories
    const tempDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "test1-"));
    const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "test2-"));

    // Create agent for first manager
    const agent1 = await Agent.create({
      workdir: tempDir1,
      callbacks: mockCallbacks,
    });

    // Create agent for second manager
    const agent2 = await Agent.create({
      workdir: tempDir2,
      callbacks: mockCallbacks,
    });

    // Both managers should work independently
    expect(agent1).toBeInstanceOf(Agent);
    expect(agent2).toBeInstanceOf(Agent);

    // Clean up
    await agent1.destroy();
    await agent2.destroy();
    await fs.rm(tempDir1, { recursive: true, force: true });
    await fs.rm(tempDir2, { recursive: true, force: true });
  });
});
