/**
 * @file Tests for SubagentManager session functionality
 * Tests that subagents use the correct session prefix and session handling
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

// Mock the subagent parser module
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

// Mock the AI service
vi.mock("../../src/services/aiService.js", () => ({
  sendAIMessage: vi.fn().mockResolvedValue({
    content: "Mock AI response",
    toolCalls: [],
    usage: { totalTokens: 10 },
  }),
}));

// Mock the session service
vi.mock("../../src/services/session.js", () => ({
  saveSession: vi.fn().mockResolvedValue(undefined),
  loadSession: vi.fn().mockResolvedValue(null),
  getLatestSession: vi.fn().mockResolvedValue(null),
  listSessions: vi.fn().mockResolvedValue([]),
  deleteSession: vi.fn().mockResolvedValue(true),
  cleanupExpiredSessions: vi.fn().mockResolvedValue(0),
  sessionExists: vi.fn().mockResolvedValue(false),
  getSessionFilePath: vi
    .fn()
    .mockImplementation((sessionId, sessionDir, prefix) => {
      const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
      const filePrefix = prefix || "session";
      return `/mock/path/${filePrefix}_${shortId}.json`;
    }),
}));

describe("SubagentManager - Session Functionality", () => {
  let subagentManager: SubagentManager;
  let parentMessageManager: MessageManager;
  let parentToolManager: ToolManager;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;

  beforeEach(async () => {
    // Create parent MessageManager
    parentMessageManager = new MessageManager({
      callbacks: {},
      workdir: "/tmp/test",
    });

    // Create mock MCP manager
    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
    };

    // Create parent ToolManager
    parentToolManager = new ToolManager({
      mcpManager:
        mockMcpManager as unknown as import("../../src/managers/mcpManager.js").McpManager,
    });

    // Mock gateway and model configs
    mockGatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };

    mockModelConfig = {
      agentModel: "claude-3-5-sonnet-20241022",
      fastModel: "claude-3-haiku-20240307",
    };

    // Create SubagentManager
    subagentManager = new SubagentManager({
      workdir: "/tmp/test",
      parentToolManager,
      parentMessageManager,
      gatewayConfig: mockGatewayConfig,
      modelConfig: mockModelConfig,
      tokenLimit: 1000,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Session Prefix Configuration", () => {
    it("should create subagent MessageManager with 'subagent_session' prefix", async () => {
      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent",
        description: "Test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read", "Write"],
        filePath: "/tmp/test-subagent.json",
        scope: "project",
        priority: 1,
      };

      const parameters = {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      };

      // Create subagent instance
      const instance = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      // Get the transcript path from the subagent's message manager
      const transcriptPath = instance.messageManager.getTranscriptPath();

      // Verify that the path contains 'subagent_session' prefix
      expect(transcriptPath).toContain("subagent_session_");
      expect(transcriptPath).not.toContain("/session_");
      expect(transcriptPath).toMatch(/subagent_session_[a-zA-Z0-9]+\.json$/);
    });

    it("should save subagent sessions with subagent_session prefix", async () => {
      const { saveSession } = await import("../../src/services/session.js");
      const mockSaveSession = vi.mocked(saveSession);

      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent",
        description: "Test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read", "Write"],
        filePath: "/tmp/test-subagent.json",
        scope: "project",
        priority: 1,
      };

      const parameters = {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      };

      // Create subagent instance
      const instance = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      // Add a message to trigger session saving
      instance.messageManager.addUserMessage({
        content: "Test message",
      });

      // Save the session
      await instance.messageManager.saveSession();

      // Verify that saveSession was called with the correct prefix
      expect(mockSaveSession).toHaveBeenCalledWith(
        expect.any(String), // sessionId
        expect.any(Array), // messages
        "/tmp/test", // workdir
        0, // latestTotalTokens
        expect.any(String), // startedAt
        undefined, // sessionDir
        "subagent_session", // prefix
      );
    });

    it("should handle session restoration with subagent_session prefix", async () => {
      const { loadSession } = await import("../../src/services/session.js");
      const mockLoadSession = vi.mocked(loadSession);

      // Mock loadSession to return a valid session
      mockLoadSession.mockResolvedValueOnce({
        id: "test-session-id",
        version: "1.0.0",
        messages: [],
        metadata: {
          workdir: "/tmp/test",
          startedAt: "2024-01-01T00:00:00.000Z",
          lastActiveAt: "2024-01-01T00:00:00.000Z",
          latestTotalTokens: 0,
        },
      });

      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent",
        description: "Test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read", "Write"],
        filePath: "/tmp/test-subagent.json",
        scope: "project",
        priority: 1,
      };

      const parameters = {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      };

      // Create subagent instance
      const instance = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      // Trigger session restoration
      await instance.messageManager.handleSessionRestoration(
        "test-session-id",
        false,
      );

      // Verify that loadSession was called with the correct prefix
      expect(mockLoadSession).toHaveBeenCalledWith(
        "test-session-id",
        undefined, // sessionDir
        "subagent_session", // prefix
      );
    });
  });

  describe("Session Isolation", () => {
    it("should create isolated sessions for different subagent instances", async () => {
      const mockConfiguration: SubagentConfiguration = {
        name: "test-subagent",
        description: "Test subagent",
        systemPrompt: "You are a test subagent",
        tools: ["Read", "Write"],
        filePath: "/tmp/test-subagent.json",
        scope: "project",
        priority: 1,
      };

      const parameters = {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "test-subagent",
      };

      // Create two subagent instances
      const instance1 = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      const instance2 = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      // Get transcript paths
      const path1 = instance1.messageManager.getTranscriptPath();
      const path2 = instance2.messageManager.getTranscriptPath();

      // Verify that both use subagent_session prefix
      expect(path1).toContain("subagent_session_");
      expect(path2).toContain("subagent_session_");

      // Verify that they have different session IDs
      expect(path1).not.toBe(path2);

      // Verify that session IDs are different
      expect(instance1.messageManager.getSessionId()).not.toBe(
        instance2.messageManager.getSessionId(),
      );
    });
  });
});
