import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIManager } from "../src/services/aiManager";
import type { AIManagerCallbacks } from "../src/services/aiManager";
import type { FileManager } from "../src/services/fileManager";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Mock the aiService
vi.mock("../src/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Test response",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }),
  compressMessages: vi.fn().mockResolvedValue("Compressed content"),
}));

// Mock the fileManager
vi.mock("../src/services/fileManager", () => ({
  FileManager: vi.fn().mockImplementation(() => ({
    getFlatFiles: vi.fn().mockReturnValue([]),
  })),
}));

// Mock the SessionManager
vi.mock("../src/services/sessionManager", () => ({
  SessionManager: {
    saveSession: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock the memoryUtils
vi.mock("../src/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn().mockResolvedValue("Project memory content"),
}));

// Mock the logger
vi.mock("../src/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memoryManager
vi.mock("../src/utils/memoryManager", () => ({
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
  let mockFileManager: FileManager;
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "aimanager-test-"));

    // Reset all mocks
    vi.clearAllMocks();

    mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      onFlatFilesChange: vi.fn(),
      getCurrentInputHistory: vi.fn().mockReturnValue([]),
    };

    mockFileManager = {
      getFlatFiles: vi.fn().mockReturnValue([]),
    } as unknown as FileManager;

    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);
  });

  afterEach(async () => {
    // Clean up
    aiManager.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("should read and combine project and user memory when sending AI message", async () => {
    const { callAgent } = await import("../src/services/aiService");
    const { readMemoryFile } = await import("../src/utils/memoryUtils");
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    // Get the mocked functions
    const mockCallAgent = vi.mocked(callAgent);
    const mockReadMemoryFile = vi.mocked(readMemoryFile);
    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

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
    aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);

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
    const { callAgent } = await import("../src/services/aiService");
    const { readMemoryFile } = await import("../src/utils/memoryUtils");
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    // Get the mocked functions
    const mockCallAgent = vi.mocked(callAgent);
    const mockReadMemoryFile = vi.mocked(readMemoryFile);
    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

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
    aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);

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
    const { callAgent } = await import("../src/services/aiService");
    const { readMemoryFile } = await import("../src/utils/memoryUtils");
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    // Get the mocked functions
    const mockCallAgent = vi.mocked(callAgent);
    const mockReadMemoryFile = vi.mocked(readMemoryFile);
    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

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
    aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);

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
    const { callAgent } = await import("../src/services/aiService");
    const { readMemoryFile } = await import("../src/utils/memoryUtils");
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    // Get the mocked functions
    const mockCallAgent = vi.mocked(callAgent);
    const mockReadMemoryFile = vi.mocked(readMemoryFile);
    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

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
    aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);

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
    const { callAgent } = await import("../src/services/aiService");
    const { readMemoryFile } = await import("../src/utils/memoryUtils");
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    // Get the mocked functions
    const mockCallAgent = vi.mocked(callAgent);
    const mockReadMemoryFile = vi.mocked(readMemoryFile);
    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

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
    aiManager.destroy();
    aiManager = new AIManager(tempDir, mockCallbacks, mockFileManager);

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
    const { createMemoryManager } = await import("../src/utils/memoryManager");

    const mockCreateMemoryManager = vi.mocked(createMemoryManager);

    // Create AIManager instances with different workdirs
    const tempDir1 = await fs.mkdtemp(path.join(os.tmpdir(), "test1-"));
    const tempDir2 = await fs.mkdtemp(path.join(os.tmpdir(), "test2-"));

    const aiManager1 = new AIManager(tempDir1, mockCallbacks, mockFileManager);
    const aiManager2 = new AIManager(tempDir2, mockCallbacks, mockFileManager);

    // Verify createMemoryManager was called with correct workdirs
    expect(mockCreateMemoryManager).toHaveBeenCalledWith(tempDir1);
    expect(mockCreateMemoryManager).toHaveBeenCalledWith(tempDir2);

    // Clean up
    aiManager1.destroy();
    aiManager2.destroy();
    await fs.rm(tempDir1, { recursive: true, force: true });
    await fs.rm(tempDir2, { recursive: true, force: true });
  });
});
