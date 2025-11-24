import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import type { SubagentInstance } from "../../src/managers/subagentManager.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { v6 as uuidv6 } from "uuid";

// Mock dependencies to prevent real I/O operations
vi.mock("@/services/aiService", () => ({
  createChatCompletion: vi.fn(),
}));

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn(() => ({
    list: vi.fn(() => []),
    initializeBuiltInTools: vi.fn(),
  })),
}));

// Mock session service functions
vi.mock("../../src/services/session.js", () => ({
  generateSessionId: vi.fn(),
  loadSessionFromJsonl: vi.fn(),
  appendMessages: vi.fn(),
  getLatestSessionFromJsonl: vi.fn(),
  listSessionsFromJsonl: vi.fn(),
  deleteSessionFromJsonl: vi.fn(),
  sessionExistsInJsonl: vi.fn(),
  cleanupExpiredSessionsFromJsonl: vi.fn(),
}));

// Type for accessing private members in tests
interface AgentWithPrivates {
  subagentManager: {
    getInstance: (id: string) => SubagentInstance | null;
    getActiveInstances: () => SubagentInstance[];
  };
}

describe("Agent - Subagent Session Restoration", () => {
  let testWorkdir: string;
  let testSessionDir: string;

  beforeEach(async () => {
    // Create temporary directories for testing
    testWorkdir = await fs.mkdtemp(join(tmpdir(), "wave-agent-test-"));
    testSessionDir = await fs.mkdtemp(join(tmpdir(), "wave-sessions-test-"));

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test directories
    try {
      await fs.rm(testWorkdir, { recursive: true });
      await fs.rm(testSessionDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should discover and restore subagent sessions when main session is loaded", async () => {
    const mainSessionId = uuidv6();
    const subagentId = "subagent_87654321";
    const subagentSessionId = uuidv6();

    // Import and mock the session functions
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);

    // Create mock main session data
    const mainSessionData = {
      id: mainSessionId,
      messages: [
        {
          role: "user" as const,
          blocks: [
            {
              type: "text" as const,
              content: "Please help me with a task",
            },
          ],
        },
        {
          role: "assistant" as const,
          blocks: [
            {
              type: "text" as const,
              content: "I'll help you with that task using a subagent.",
            },
            {
              type: "subagent" as const,
              subagentId: subagentId,
              subagentName: "test-subagent",
              status: "completed" as const,
              sessionId: subagentSessionId, // Use separate session ID for subagent
              configuration: {
                name: "test-subagent",
                systemPrompt: "You are a test subagent",
                description: "Test subagent for restoration",
                filePath: "test-subagent.md",
                scope: "project" as const,
                priority: 1,
              },
            },
          ],
        },
      ],
      metadata: {
        workdir: testWorkdir,
        startedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 100,
      },
    };

    // Create mock subagent session data
    const subagentSessionData = {
      id: subagentSessionId,
      messages: [
        {
          role: "user" as const,
          blocks: [
            {
              type: "text" as const,
              content: "Subagent task prompt",
            },
          ],
        },
        {
          role: "assistant" as const,
          blocks: [
            {
              type: "text" as const,
              content: "Subagent response content",
            },
          ],
        },
      ],
      metadata: {
        workdir: testWorkdir,
        startedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 50,
      },
    };

    // Mock session loading - main session first, then subagent session
    mockLoadSessionFromJsonl
      .mockResolvedValueOnce(mainSessionData) // First call for main session
      .mockResolvedValueOnce(subagentSessionData); // Second call for subagent session

    // Mock callback to verify UI callback is triggered
    const mockSubagentMessagesChange = vi.fn();

    // Create Agent with session restoration and callback
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: mainSessionId,
      workdir: testWorkdir,
      sessionDir: testSessionDir,
      callbacks: {
        onSubagentMessagesChange: mockSubagentMessagesChange,
      },
    });

    // Verify main session was restored
    expect(agent.messages).toHaveLength(2);
    expect(agent.sessionId).toBe(mainSessionId);

    // Verify subagent session was discovered and restored
    // We need to access the subagent manager to check if subagent was restored
    // This is a bit tricky since subagentManager is private, but we can test indirectly
    const agentWithPrivates = agent as unknown as AgentWithPrivates;
    const subagentInstance =
      agentWithPrivates.subagentManager.getInstance(subagentId);

    // Check if subagent instance was created and restored
    expect(subagentInstance).not.toBeNull();
    if (subagentInstance) {
      expect(subagentInstance.subagentId).toBe(subagentId);
      expect(subagentInstance.status).toBe("completed");
      expect(subagentInstance.messages).toHaveLength(2);

      const lastMessage = subagentInstance.messages[1];
      const textBlock = lastMessage.blocks.find(
        (block) => block.type === "text",
      );
      if (textBlock && textBlock.type === "text") {
        expect(textBlock.content).toBe("Subagent response content");
      }
    }

    // IMPORTANT: Verify that the UI callback was triggered during restoration
    expect(mockSubagentMessagesChange).toHaveBeenCalledWith(
      subagentId,
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              content: "Subagent task prompt",
            }),
          ]),
        }),
        expect.objectContaining({
          role: "assistant",
          blocks: expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              content: "Subagent response content",
            }),
          ]),
        }),
      ]),
    );

    // Verify that loadSessionFromJsonl was called for both sessions
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledTimes(2);
    expect(mockLoadSessionFromJsonl).toHaveBeenNthCalledWith(
      1,
      mainSessionId,
      testWorkdir,
      testSessionDir,
    );
    expect(mockLoadSessionFromJsonl).toHaveBeenNthCalledWith(
      2,
      subagentSessionId,
      testWorkdir,
      testSessionDir,
    );

    await agent.destroy();
  });

  it("should handle missing subagent session files gracefully", async () => {
    const mainSessionId = uuidv6();
    const missingSubagentId = "missing_subagent_12345678";
    const missingSubagentSessionId = uuidv6();

    // Import and mock the session functions
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);

    // Create mock main session with reference to non-existent subagent
    const mainSessionData = {
      id: mainSessionId,
      messages: [
        {
          role: "user" as const,
          blocks: [
            {
              type: "text" as const,
              content: "Test message",
            },
          ],
        },
        {
          role: "assistant" as const,
          blocks: [
            {
              type: "subagent" as const,
              subagentId: missingSubagentId,
              subagentName: "missing-subagent",
              status: "completed" as const,
              sessionId: missingSubagentSessionId,
              configuration: {
                name: "missing-subagent",
                systemPrompt: "You are a missing subagent",
                description: "Missing subagent for testing",
                filePath: "missing-subagent.md",
                scope: "project" as const,
                priority: 1,
              },
            },
          ],
        },
      ],
      metadata: {
        workdir: testWorkdir,
        startedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 100,
      },
    };

    // Mock session loading - main session succeeds, subagent session fails (returns null)
    mockLoadSessionFromJsonl
      .mockResolvedValueOnce(mainSessionData) // First call for main session
      .mockResolvedValueOnce(null); // Second call for subagent session - not found

    // Agent creation should succeed even with missing subagent session
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: mainSessionId,
      workdir: testWorkdir,
      sessionDir: testSessionDir,
    });

    // Main session should still be restored
    expect(agent.messages).toHaveLength(2);
    expect(agent.sessionId).toBe(mainSessionId);

    // Missing subagent should not cause any issues - subagent manager should handle gracefully
    const agentWithPrivates = agent as unknown as AgentWithPrivates;
    const subagentInstance =
      agentWithPrivates.subagentManager.getInstance(missingSubagentId);
    expect(subagentInstance).toBeNull();

    // Verify that loadSessionFromJsonl was called for both sessions
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledTimes(2);
    expect(mockLoadSessionFromJsonl).toHaveBeenNthCalledWith(
      1,
      mainSessionId,
      testWorkdir,
      testSessionDir,
    );
    expect(mockLoadSessionFromJsonl).toHaveBeenNthCalledWith(
      2,
      missingSubagentSessionId,
      testWorkdir,
      testSessionDir,
    );

    await agent.destroy();
  });

  it("should not attempt subagent restoration when no session is restored", async () => {
    // Import and mock the session functions
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);

    // Create agent without session restoration
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
      sessionDir: testSessionDir,
    });

    // Should have no messages (new session)
    expect(agent.messages).toHaveLength(0);

    // No subagent instances should exist
    const agentWithPrivates = agent as unknown as AgentWithPrivates;
    const activeInstances =
      agentWithPrivates.subagentManager.getActiveInstances();
    expect(activeInstances).toHaveLength(0);

    // Verify that loadSessionFromJsonl was never called (no session to restore)
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledTimes(0);

    await agent.destroy();
  });
});
