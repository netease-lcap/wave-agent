import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIManager } from "@/services/aiManager";
import type { AIManagerCallbacks } from "@/services/aiManager";
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

// Mock the SessionManager
vi.mock("@/services/sessionManager", () => ({
  SessionManager: {
    saveSession: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the memoryUtils
vi.mock("@/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn().mockResolvedValue("Project memory content"),
}));

// Mock the logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memoryManager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn(() => ({
    addMemory: vi.fn().mockResolvedValue(undefined),
    isMemoryMessage: vi.fn().mockReturnValue(true),
    addUserMemory: vi.fn().mockResolvedValue(undefined),
    getUserMemoryContent: vi.fn().mockResolvedValue("User memory content"),
    ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe("AIManager User Memory Integration", () => {
  let aiManager: AIManager;
  let mockCallbacks: AIManagerCallbacks;
  let tempDir: string;

  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockReadMemoryFile: ReturnType<typeof vi.fn>;
  let mockCreateMemoryManager: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimanager-test-"));

    // Get mock references after module imports
    const { callAgent } = await import("@/services/aiService");
    const { readMemoryFile } = await import("@/utils/memoryUtils");
    const { createMemoryManager } = await import("@/services/memoryManager");

    mockCallAgent = vi.mocked(callAgent);
    mockReadMemoryFile = vi.mocked(readMemoryFile);
    mockCreateMemoryManager = vi.mocked(createMemoryManager);

    // Reset all mocks
    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      getCurrentInputHistory: vi.fn().mockReturnValue([]),
    };

    aiManager = new AIManager(tempDir, mockCallbacks);
  });

  afterEach(async () => {
    // Clean up
    await aiManager.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should read and combine project and user memory when sending AI message", async () => {
    // Set up mock return values
    mockReadMemoryFile.mockResolvedValue("Project memory: important context");

    // Mock the memory manager to return specific content
    const mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
      isMemoryMessage: vi.fn().mockReturnValue(true),
      addUserMemory: vi.fn().mockResolvedValue(undefined),
      getUserMemoryContent: vi
        .fn()
        .mockResolvedValue("User memory: user preferences"),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateMemoryManager.mockReturnValue(mockMemoryManager);

    // Create a new AIManager to pick up the new mocks
    await aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks);

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
    mockReadMemoryFile.mockResolvedValue("Project memory only");

    // Mock the memory manager to return empty user content
    const mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
      isMemoryMessage: vi.fn().mockReturnValue(true),
      addUserMemory: vi.fn().mockResolvedValue(undefined),
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateMemoryManager.mockReturnValue(mockMemoryManager);

    // Create a new AIManager to pick up the new mocks
    await aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks);

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
    mockReadMemoryFile.mockResolvedValue("");

    // Mock the memory manager to return user content only
    const mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
      isMemoryMessage: vi.fn().mockReturnValue(true),
      addUserMemory: vi.fn().mockResolvedValue(undefined),
      getUserMemoryContent: vi.fn().mockResolvedValue("User memory only"),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateMemoryManager.mockReturnValue(mockMemoryManager);

    // Create a new AIManager to pick up the new mocks
    await aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks);

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
    mockReadMemoryFile.mockResolvedValue("");

    // Mock the memory manager to return empty content
    const mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
      isMemoryMessage: vi.fn().mockReturnValue(true),
      addUserMemory: vi.fn().mockResolvedValue(undefined),
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateMemoryManager.mockReturnValue(mockMemoryManager);

    // Create a new AIManager to pick up the new mocks
    await aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks);

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
    mockReadMemoryFile.mockRejectedValue(
      new Error("Failed to read project memory"),
    );

    // Mock the memory manager to throw error
    const mockMemoryManager = {
      addMemory: vi.fn().mockResolvedValue(undefined),
      isMemoryMessage: vi.fn().mockReturnValue(true),
      addUserMemory: vi.fn().mockResolvedValue(undefined),
      getUserMemoryContent: vi
        .fn()
        .mockRejectedValue(new Error("Failed to read user memory")),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateMemoryManager.mockReturnValue(mockMemoryManager);

    // Create a new AIManager to pick up the new mocks
    await aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks);

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

    // Send AI message - should handle errors gracefully
    await aiManager.sendAIMessage();

    // Verify that callAgent was still called despite errors (with empty memory)
    expect(mockCallAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: "",
      }),
    );
  });

  it("should create separate memory managers for different workdirs", async () => {
    // Create AIManager instances with different workdirs
    const tempDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "test1-"));
    const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "test2-"));

    const aiManager1 = new AIManager(tempDir1, mockCallbacks);
    const aiManager2 = new AIManager(tempDir2, mockCallbacks);

    // Verify createMemoryManager was called with correct workdirs
    expect(mockCreateMemoryManager).toHaveBeenCalledWith(tempDir1);
    expect(mockCreateMemoryManager).toHaveBeenCalledWith(tempDir2);

    // Clean up
    await aiManager1.destroy();
    await aiManager2.destroy();
    await fs.rm(tempDir1, { recursive: true, force: true });
    await fs.rm(tempDir2, { recursive: true, force: true });
  });
});
