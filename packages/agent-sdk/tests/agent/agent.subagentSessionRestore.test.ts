import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import type { SubagentInstance } from "../../src/managers/subagentManager.js";
import { randomUUID } from "crypto";

// Mock dependencies to prevent real I/O operations
vi.mock("@/services/aiService", () => ({
  createChatCompletion: vi.fn(),
}));

const { instance: mockToolManagerInstance } = createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn(function () {
    return mockToolManagerInstance;
  }),
}));

// Mock session service functions
vi.mock("../../src/services/session.js", async () => {
  const actual = await vi.importActual("../../src/services/session.js");
  return {
    ...actual,
    generateSessionId: vi.fn(() => "test-session-id"),
    loadSessionFromJsonl: vi.fn(),
    appendMessages: vi.fn(),
    getLatestSessionFromJsonl: vi.fn(),
    listSessionsFromJsonl: vi.fn(),
    deleteSessionFromJsonl: vi.fn(),
    sessionExistsInJsonl: vi.fn(),
    cleanupExpiredSessionsFromJsonl: vi.fn(() => Promise.resolve(0)),
    getSessionFilePath: vi.fn(),
    ensureSessionDir: vi.fn(),
    listSessions: vi.fn(),
    cleanupEmptyProjectDirectories: vi.fn(),
    handleSessionRestoration: vi.fn(),
    SESSION_DIR: "/mock/session/dir",
  };
});

// Type for accessing private members in tests
interface AgentWithPrivates {
  subagentManager: {
    getInstance: (id: string) => SubagentInstance | null;
    getActiveInstances: () => SubagentInstance[];
  };
}

describe("Agent - Subagent Session Restoration", () => {
  let testWorkdir: string;

  beforeEach(() => {
    // Use mock directory paths instead of creating real directories
    testWorkdir = "/mock/test/workdir";

    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  it("should discover and restore subagent sessions when main session is loaded", async () => {
    const mainSessionId = randomUUID();
    const subagentId = "subagent_87654321";
    const subagentSessionId = randomUUID();

    // Import and mock the session functions
    const { loadSessionFromJsonl, handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);
    const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);

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

    // Mock session restoration to return the main session data
    mockHandleSessionRestoration.mockResolvedValue(mainSessionData);

    // Mock session loading - be specific about which calls should return what
    mockLoadSessionFromJsonl.mockImplementation(async (sessionId) => {
      if (sessionId === subagentSessionId) {
        return subagentSessionData; // Return subagent session for the specific subagent
      }
      return mainSessionData; // Default to main session data for any other calls
    });

    // Mock callback to verify UI callback is triggered
    const mockSubagentMessagesChange = vi.fn();

    // Create Agent with session restoration and callback
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: mainSessionId,
      workdir: testWorkdir,
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

    // Verify that handleSessionRestoration was called for main session restoration
    expect(mockHandleSessionRestoration).toHaveBeenCalledTimes(1);
    expect(mockHandleSessionRestoration).toHaveBeenCalledWith(
      mainSessionId,
      undefined, // continueLastSession
      testWorkdir,
    );

    // Verify that loadSessionFromJsonl was called for the subagent session only
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledTimes(1);
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledWith(
      subagentSessionId,
      testWorkdir,
      "subagent",
    );

    await agent.destroy();
  });

  it("should handle missing subagent session files gracefully", async () => {
    const mainSessionId = randomUUID();
    const missingSubagentId = "missing_subagent_12345678";
    const missingSubagentSessionId = randomUUID();

    // Import and mock the session functions
    const { loadSessionFromJsonl, handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);
    const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);

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
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 100,
      },
    };

    // Mock session restoration to return the main session data
    mockHandleSessionRestoration.mockResolvedValue(mainSessionData);

    // Mock session loading - be specific about which calls should return what
    mockLoadSessionFromJsonl.mockImplementation(async (sessionId) => {
      if (sessionId === missingSubagentSessionId) {
        return null; // Subagent session not found
      }
      return mainSessionData; // Any other calls return main session data
    });

    // Agent creation should succeed even with missing subagent session
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: mainSessionId,
      workdir: testWorkdir,
    });

    // Main session should still be restored
    expect(agent.messages).toHaveLength(2);
    expect(agent.sessionId).toBe(mainSessionId);

    // Missing subagent should not cause any issues - subagent manager should handle gracefully
    const agentWithPrivates = agent as unknown as AgentWithPrivates;
    const subagentInstance =
      agentWithPrivates.subagentManager.getInstance(missingSubagentId);
    expect(subagentInstance).toBeNull();

    // Verify that handleSessionRestoration was called for main session restoration
    expect(mockHandleSessionRestoration).toHaveBeenCalledTimes(1);
    expect(mockHandleSessionRestoration).toHaveBeenCalledWith(
      mainSessionId,
      undefined, // continueLastSession
      testWorkdir,
    );

    // Verify that loadSessionFromJsonl was called for the subagent session only (and it returned null)
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledTimes(1);
    expect(mockLoadSessionFromJsonl).toHaveBeenCalledWith(
      missingSubagentSessionId,
      testWorkdir,
      "subagent",
    );

    await agent.destroy();
  });

  it("should not attempt subagent restoration when no session is restored", async () => {
    // Import and mock the session functions
    const { loadSessionFromJsonl, handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);
    const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);

    // Mock session restoration to return undefined (no session to restore)
    mockHandleSessionRestoration.mockResolvedValue(undefined);

    // Create agent without session restoration
    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
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
