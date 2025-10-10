import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIManager } from "@/services/aiManager.js";
import type { AIManagerCallbacks } from "@/services/aiManager.js";
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

// Mock the fileManager
vi.mock("@/services/fileManager", () => ({
  FileManager: vi.fn().mockImplementation(() => ({
    getFlatFiles: vi.fn().mockReturnValue([]),
  })),
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

describe("AIManager User Memory Integration", () => {
  let aiManager: AIManager;
  let mockCallbacks: AIManagerCallbacks;
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
      onLoadingChange: vi.fn(),
    };

    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    // Clean up
    if (aiManager) {
      await aiManager.destroy();
    }
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should read and combine project and user memory when sending AI message", async () => {
    // Set up mock return values
    mockGetCombinedMemoryContent.mockResolvedValue(
      "Project memory: important context\n\nUser memory: user preferences",
    );

    // Create a new AIManager to pick up the new mocks
    if (aiManager) {
      await aiManager.destroy();
    }
    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

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
        originalDeltas: [],
      },
    ];
    aiManager.setMessages(initialMessages);

    // Send AI message
    await aiManager.sendAIMessage();

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

    // Create a new AIManager to pick up the new mocks
    if (aiManager) {
      await aiManager.destroy();
    }
    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

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
        originalDeltas: [],
      },
    ];
    aiManager.setMessages(initialMessages);

    // Send AI message
    await aiManager.sendAIMessage();

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

    // Create a new AIManager to pick up the new mocks
    if (aiManager) {
      await aiManager.destroy();
    }
    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

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
        originalDeltas: [],
      },
    ];
    aiManager.setMessages(initialMessages);

    // Send AI message
    await aiManager.sendAIMessage();

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

    // Create a new AIManager to pick up the new mocks
    if (aiManager) {
      await aiManager.destroy();
    }
    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

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
        originalDeltas: [],
      },
    ];
    aiManager.setMessages(initialMessages);

    // Send AI message
    await aiManager.sendAIMessage();

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

    // Create a new AIManager to pick up the new mocks
    if (aiManager) {
      await aiManager.destroy();
    }
    // Mock process.cwd() to return temp directory
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);

    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

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
        originalDeltas: [],
      },
    ];
    aiManager.setMessages(initialMessages);

    // Send AI message - should handle errors gracefully by adding error block
    await aiManager.sendAIMessage();

    // Verify that callAgent was not called due to the error
    expect(mockCallAgent).not.toHaveBeenCalled();

    // Verify that an error block was added to handle the memory read error
    const messages = aiManager.messages;
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.blocks.some((block) => block.type === "error")).toBe(
      true,
    );
  });

  it("should create separate instances for different workdirs", async () => {
    // Create temporary directories
    const tempDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "test1-"));
    const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "test2-"));

    // Mock process.cwd for first manager
    vi.spyOn(process, "cwd").mockReturnValue(tempDir1);
    const aiManager1 = await AIManager.create({
      callbacks: mockCallbacks,
    });

    // Mock process.cwd for second manager
    vi.spyOn(process, "cwd").mockReturnValue(tempDir2);
    const aiManager2 = await AIManager.create({
      callbacks: mockCallbacks,
    });

    // Both managers should work independently
    expect(aiManager1).toBeInstanceOf(AIManager);
    expect(aiManager2).toBeInstanceOf(AIManager);

    // Clean up
    await aiManager1.destroy();
    await aiManager2.destroy();
    await fs.rm(tempDir1, { recursive: true, force: true });
    await fs.rm(tempDir2, { recursive: true, force: true });
  });
});
