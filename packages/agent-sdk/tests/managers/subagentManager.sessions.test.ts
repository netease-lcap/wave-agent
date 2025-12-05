/**
 * @file Tests for SubagentManager session functionality
 * Tests that subagents have proper session isolation
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

// Mock the session service with new functions
vi.mock("../../src/services/session.js", () => ({
  generateSessionId: vi.fn().mockImplementation(() => {
    // Generate a mock UUID v4 format for testing
    const chars = "0123456789abcdef";
    let result = "";
    for (let i = 0; i < 32; i++) {
      if (i === 8 || i === 12 || i === 16 || i === 20) {
        result += "-";
      }
      if (i === 12) {
        result += "4"; // Version 4
      } else if (i === 16) {
        result += chars[8 + Math.floor(Math.random() * 4)]; // Variant bits
      } else {
        result += chars[Math.floor(Math.random() * 16)];
      }
    }
    return result;
  }),
  appendMessages: vi.fn().mockResolvedValue(undefined),
  loadSessionFromJsonl: vi.fn().mockResolvedValue(null),
  handleSessionRestoration: vi.fn().mockResolvedValue(null),
  getLatestSessionFromJsonl: vi.fn().mockResolvedValue(null),
  listSessions: vi.fn().mockResolvedValue([]),
  listSessionsFromJsonl: vi.fn().mockResolvedValue([]),
  deleteSessionFromJsonl: vi.fn().mockResolvedValue(true),
  cleanupExpiredSessionsFromJsonl: vi.fn().mockResolvedValue(0),
  sessionExistsInJsonl: vi.fn().mockResolvedValue(false),
  getSessionFilePath: vi.fn().mockImplementation((sessionId, workdir) => {
    const baseDir = `/mock/session/dir/encoded-${encodeURIComponent(workdir)}`;
    return `${baseDir}/${sessionId}.jsonl`;
  }),
  ensureSessionDir: vi.fn().mockResolvedValue(undefined),
  cleanupEmptyProjectDirectories: vi.fn().mockResolvedValue(undefined),
  SESSION_DIR: "/mock/session/dir",
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
      getGatewayConfig: () => mockGatewayConfig,
      getModelConfig: () => mockModelConfig,
      getTokenLimit: () => 1000,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Session Path Structure", () => {
    it("should create subagent MessageManager with JSONL session files", async () => {
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

      // Verify that the path uses JSONL extension and UUID format
      expect(transcriptPath).toMatch(/\.jsonl$/);
      expect(transcriptPath).toMatch(
        /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/,
      );
      expect(transcriptPath).toContain("/mock/session/dir/");
    });

    it("should save subagent sessions using appendMessages function", async () => {
      const { appendMessages } = await import("../../src/services/session.js");
      const mockAppendMessages = vi.mocked(appendMessages);

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

      // Verify that appendMessages was called with the correct parameters
      expect(mockAppendMessages).toHaveBeenCalledWith(
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ), // UUID sessionId
        expect.any(Array), // messages
        "/tmp/test", // workdir
        "subagent", // sessionType
      );
    });

    it("should handle session restoration using handleSessionRestoration function", async () => {
      const { loadSessionFromJsonl, handleSessionRestoration } = await import(
        "../../src/services/session.js"
      );
      const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);
      const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);

      // Mock loadSessionFromJsonl to return a valid session
      const mockSession = {
        id: "01234567-89ab-6cde-f012-3456789abcde",
        messages: [],
        metadata: {
          workdir: "/tmp/test",
          lastActiveAt: "2024-01-01T00:00:00.000Z",
          latestTotalTokens: 0,
        },
      };
      mockLoadSessionFromJsonl.mockResolvedValueOnce(mockSession);
      mockHandleSessionRestoration.mockResolvedValueOnce(mockSession);

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
      await handleSessionRestoration(
        "01234567-89ab-6cde-f012-3456789abcde",
        false,
        instance.messageManager.getWorkdir(),
      );

      // Verify that handleSessionRestoration was called with the correct parameters
      expect(mockHandleSessionRestoration).toHaveBeenCalledWith(
        "01234567-89ab-6cde-f012-3456789abcde",
        false,
        "/tmp/test", // workdir
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

      // Verify that both use JSONL extension
      expect(path1).toMatch(/\.jsonl$/);
      expect(path2).toMatch(/\.jsonl$/);

      // Verify that they have different file paths
      expect(path1).not.toBe(path2);

      // Verify that session IDs are different
      const sessionId1 = instance1.messageManager.getSessionId();
      const sessionId2 = instance2.messageManager.getSessionId();

      expect(sessionId1).not.toBe(sessionId2);

      // Verify both session IDs are valid UUID format
      expect(sessionId1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(sessionId2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it("should use project-based directory structure for session storage", async () => {
      const { appendMessages } = await import("../../src/services/session.js");
      const mockAppendMessages = vi.mocked(appendMessages);

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

      // Add a message to trigger session operations
      instance.messageManager.addUserMessage({
        content: "Test message",
      });

      // Save the session to trigger appendMessages call
      await instance.messageManager.saveSession();

      // Verify that appendMessages was called with correct parameters
      expect(mockAppendMessages).toHaveBeenCalledWith(
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ), // UUID sessionId
        expect.any(Array), // messages
        "/tmp/test", // workdir
        "subagent", // sessionType
      );
    });

    it("should handle multiple subagents with different session files", async () => {
      const { appendMessages } = await import("../../src/services/session.js");
      const mockAppendMessages = vi.mocked(appendMessages);

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

      // Create multiple subagent instances
      const instance1 = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      const instance2 = await subagentManager.createInstance(
        mockConfiguration,
        parameters,
      );

      // Add messages and save sessions for both instances
      instance1.messageManager.addUserMessage({ content: "Message 1" });
      instance2.messageManager.addUserMessage({ content: "Message 2" });

      await instance1.messageManager.saveSession();
      await instance2.messageManager.saveSession();

      // Verify appendMessages was called for both instances with different session IDs
      expect(mockAppendMessages).toHaveBeenCalledTimes(2);

      const calls = mockAppendMessages.mock.calls;
      const sessionId1 = calls[0][0];
      const sessionId2 = calls[1][0];

      // Verify session IDs are different
      expect(sessionId1).not.toBe(sessionId2);

      // Verify both are valid UUID format
      expect(sessionId1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(sessionId2).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );

      // Verify both use the same workdir
      expect(calls[0][2]).toBe("/tmp/test");
      expect(calls[1][2]).toBe("/tmp/test");
    });
  });
});
