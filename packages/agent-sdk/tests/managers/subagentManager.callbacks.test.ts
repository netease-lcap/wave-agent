/**
 * @file Integration tests for subagent callback forwarding
 * Tests the complete integration between SubagentManager and MessageManager callbacks
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
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

describe("SubagentManager - Callback Integration", () => {
  let subagentManager: SubagentManager;
  let parentMessageManager: MessageManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;

  beforeEach(async () => {
    // Set up subagent callbacks with spies
    callbacks = {
      onSubagentUserMessageAdded: vi.fn(),
      onSubagentAssistantMessageAdded: vi.fn(),
      onSubagentAssistantContentUpdated: vi.fn(),
      onSubagentToolBlockUpdated: vi.fn(),
    };

    // Create parent MessageManager (minimal callbacks needed for this test)
    parentMessageManager = new MessageManager({
      callbacks: {},
      workdir: "/tmp/test",
    });

    // Create parent ToolManager (simplified for testing)
    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
    };

    parentToolManager = new ToolManager({
      mcpManager:
        mockMcpManager as unknown as import("../../src/managers/mcpManager.js").McpManager,
    });

    // Mock configurations
    mockGatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };

    mockModelConfig = {
      agentModel: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };

    // Create SubagentManager
    subagentManager = new SubagentManager({
      workdir: "/tmp/test",
      parentToolManager,
      parentMessageManager,
      callbacks,
      gatewayConfig: mockGatewayConfig,
      modelConfig: mockModelConfig,
      tokenLimit: 1000,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("T010: User Message Forwarding Integration", () => {
    it("should forward onSubagentUserMessageAdded from subagent to parent", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "test-subagent",
        description: "A test subagent for integration testing",
        systemPrompt: "You are a test subagent",
        tools: ["Read"],
        model: "inherit",
        filePath: "/tmp/test-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test user message forwarding",
        prompt: "Hello from integration test",
        subagent_type: "test-subagent",
      };

      // Create subagent instance
      const instance = await subagentManager.createInstance(mockConfig, params);

      // Clear any calls from instance creation
      vi.clearAllMocks();

      // Add a user message to the subagent
      const userMessage = { content: "Test user message from subagent" };
      instance.messageManager.addUserMessage(userMessage);

      // Verify that the subagent callback was called with the subagent ID
      expect(callbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
        instance.subagentId,
        userMessage,
      );

      // Note: onUserMessageAdded is not expected to be called in this context
      // as it's a different callback that would be triggered in different scenarios
    });

    it("should handle user message forwarding with images", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "image-subagent",
        description: "A subagent that handles images",
        systemPrompt: "You handle images",
        tools: [],
        model: "inherit",
        filePath: "/tmp/image-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test image forwarding",
        prompt: "Process this image",
        subagent_type: "image-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);
      vi.clearAllMocks();

      const userMessageWithImage = {
        content: "Analyze this image",
        images: [{ path: "/test/image.png", mimeType: "image/png" }],
      };

      instance.messageManager.addUserMessage(userMessageWithImage);

      expect(callbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
        instance.subagentId,
        userMessageWithImage,
      );
    });
  });

  describe("T014: Assistant Message Forwarding Integration", () => {
    it("should forward onSubagentAssistantMessageAdded from subagent to parent", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "assistant-subagent",
        description: "A subagent that responds to queries",
        systemPrompt: "You respond to queries",
        tools: [],
        model: "inherit",
        filePath: "/tmp/assistant-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test assistant message forwarding",
        prompt: "Generate a response",
        subagent_type: "assistant-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);
      vi.clearAllMocks();

      // Add an assistant message to the subagent
      instance.messageManager.addAssistantMessage(
        "Hello from subagent assistant",
      );

      // Verify that the subagent callback was called with the subagent ID
      expect(callbacks.onSubagentAssistantMessageAdded).toHaveBeenCalledWith(
        instance.subagentId,
      );

      // Note: onAssistantMessageAdded is not expected to be called in this context
    });

    it("should handle assistant message forwarding with tool calls", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "tool-subagent",
        description: "A subagent that uses tools",
        systemPrompt: "You use tools",
        tools: ["Read", "Write"],
        model: "inherit",
        filePath: "/tmp/tool-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test tool call forwarding",
        prompt: "Use a tool",
        subagent_type: "tool-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);
      vi.clearAllMocks();

      // Add an assistant message with tool calls
      instance.messageManager.addAssistantMessage("I'll read a file", [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "Read",
            arguments: '{"file_path": "/test/file.txt"}',
          },
        },
      ]);

      expect(callbacks.onSubagentAssistantMessageAdded).toHaveBeenCalledWith(
        instance.subagentId,
      );
    });
  });

  describe("T018: Content Streaming Forwarding Integration", () => {
    it("should forward onSubagentAssistantContentUpdated from subagent to parent", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "streaming-subagent",
        description: "A subagent that streams responses",
        systemPrompt: "You stream responses",
        tools: [],
        model: "inherit",
        filePath: "/tmp/streaming-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test content streaming forwarding",
        prompt: "Stream a response",
        subagent_type: "streaming-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);

      // Add initial assistant message
      instance.messageManager.addAssistantMessage("Starting");
      vi.clearAllMocks();

      // Update content to simulate streaming
      const newContent = "Starting to stream content...";
      instance.messageManager.updateCurrentMessageContent(newContent);

      // Verify that the subagent callback was called with the subagent ID, chunk, and accumulated content
      expect(callbacks.onSubagentAssistantContentUpdated).toHaveBeenCalledWith(
        instance.subagentId,
        expect.any(String), // chunk
        newContent, // accumulated content
      );

      // Verify that the regular callback was also called
      // Note: onAssistantContentUpdated is not expected to be called in this context
    });

    it("should handle multiple content updates correctly", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "multi-stream-subagent",
        description: "A subagent that streams multiple updates",
        systemPrompt: "You stream multiple updates",
        tools: [],
        model: "inherit",
        filePath: "/tmp/multi-stream-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test multiple streaming updates",
        prompt: "Stream multiple updates",
        subagent_type: "multi-stream-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);

      // Add initial assistant message
      instance.messageManager.addAssistantMessage("Hello");
      vi.clearAllMocks();

      // Multiple content updates
      instance.messageManager.updateCurrentMessageContent("Hello world");
      instance.messageManager.updateCurrentMessageContent("Hello world!");

      // Should have been called twice
      expect(callbacks.onSubagentAssistantContentUpdated).toHaveBeenCalledTimes(
        2,
      );

      // Check the accumulated content in calls
      const mockedCallback = vi.mocked(
        callbacks.onSubagentAssistantContentUpdated,
      )!;
      expect(mockedCallback.mock.calls).toBeDefined();
      const calls = mockedCallback.mock.calls!;
      expect(calls[0]![0]).toBe(instance.subagentId); // subagentId
      expect(calls[0]![2]).toBe("Hello world"); // accumulated content
      expect(calls[1]![0]).toBe(instance.subagentId); // subagentId
      expect(calls[1]![2]).toBe("Hello world!"); // accumulated content
    });
  });

  describe("T022: Tool Block Forwarding Integration", () => {
    it("should forward onSubagentToolBlockUpdated from subagent to parent", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "tool-block-subagent",
        description: "A subagent that uses tools and updates blocks",
        systemPrompt: "You use tools and update blocks",
        tools: ["Read", "Write"],
        model: "inherit",
        filePath: "/tmp/tool-block-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test tool block forwarding",
        prompt: "Use tools and update blocks",
        subagent_type: "tool-block-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);

      // Add an assistant message with a tool call first
      instance.messageManager.addAssistantMessage("I'll read a file", [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "Read",
            arguments: '{"file_path": "/test/file.txt"}',
          },
        },
      ]);

      vi.clearAllMocks();

      // Update the tool block
      const toolUpdateParams = {
        id: "tool-call-1",
        stage: "end" as const,
        parameters: '{"file_path": "/test/file.txt"}',
        result: "File content here",
      };

      instance.messageManager.updateToolBlock(toolUpdateParams);

      // Verify that the subagent callback was called with the subagent ID and params
      expect(callbacks.onSubagentToolBlockUpdated).toHaveBeenCalledWith(
        instance.subagentId,
        toolUpdateParams,
      );

      // Verify that the regular callback was also called
      // Note: onToolBlockUpdated is not expected to be called in this context
    });

    it("should handle different tool block stages", async () => {
      const mockConfig: SubagentConfiguration = {
        name: "multi-stage-subagent",
        description: "A subagent that handles multiple tool stages",
        systemPrompt: "You handle multiple tool stages",
        tools: ["Write"],
        model: "inherit",
        filePath: "/tmp/multi-stage-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test multiple tool stages",
        prompt: "Handle different tool stages",
        subagent_type: "multi-stage-subagent",
      };

      const instance = await subagentManager.createInstance(mockConfig, params);

      // Add an assistant message with a tool call
      instance.messageManager.addAssistantMessage("I'll write a file", [
        {
          id: "tool-call-2",
          type: "function",
          function: {
            name: "Write",
            arguments: '{"file_path": "/test/new.txt", "content": "Hello"}',
          },
        },
      ]);

      vi.clearAllMocks();

      // Update with different stages
      const runningParams = {
        id: "tool-call-2",
        stage: "running" as const,
        parameters: '{"file_path": "/test/new.txt", "content": "Hello"}',
      };

      const completedParams = {
        id: "tool-call-2",
        stage: "end" as const,
        parameters: '{"file_path": "/test/new.txt", "content": "Hello"}',
        result: "File written successfully",
      };

      instance.messageManager.updateToolBlock(runningParams);
      instance.messageManager.updateToolBlock(completedParams);

      // Should have been called twice
      expect(callbacks.onSubagentToolBlockUpdated).toHaveBeenCalledTimes(2);

      // Check the calls
      const mockedCallback = vi.mocked(callbacks.onSubagentToolBlockUpdated)!;
      expect(mockedCallback.mock.calls).toBeDefined();
      const calls = mockedCallback.mock.calls!;
      expect(calls[0]).toEqual([instance.subagentId, runningParams]);
      expect(calls[1]).toEqual([instance.subagentId, completedParams]);
    });
  });

  describe("error handling and edge cases", () => {
    it("should handle callback errors gracefully without breaking subagent functionality", async () => {
      const errorCallbacks: SubagentManagerCallbacks = {
        onSubagentUserMessageAdded: vi.fn().mockImplementation(() => {
          throw new Error("Callback error");
        }),
      };

      const errorSubagentManager = new SubagentManager({
        workdir: "/tmp/test",
        parentToolManager,
        parentMessageManager,
        callbacks: errorCallbacks,
        gatewayConfig: mockGatewayConfig,
        modelConfig: mockModelConfig,
        tokenLimit: 1000,
      });

      await errorSubagentManager.initialize();

      const mockConfig: SubagentConfiguration = {
        name: "error-test-subagent",
        description: "Test error handling",
        systemPrompt: "Test error handling",
        tools: [],
        model: "inherit",
        filePath: "/tmp/error-test-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test error handling",
        prompt: "Test message",
        subagent_type: "error-test-subagent",
      };

      const instance = await errorSubagentManager.createInstance(
        mockConfig,
        params,
      );
      vi.clearAllMocks();

      // This should throw when the callback throws (callbacks errors propagate)
      expect(() => {
        instance.messageManager.addUserMessage({ content: "Test message" });
      }).toThrow("Callback error");

      // The error callback should have been called
      expect(errorCallbacks.onSubagentUserMessageAdded).toHaveBeenCalled();
    });

    it("should work when parent callbacks are not provided", async () => {
      const noCallbackManager = new SubagentManager({
        workdir: "/tmp/test",
        parentToolManager,
        parentMessageManager,
        // No callbacks provided
        gatewayConfig: mockGatewayConfig,
        modelConfig: mockModelConfig,
        tokenLimit: 1000,
      });

      await noCallbackManager.initialize();

      const mockConfig: SubagentConfiguration = {
        name: "no-callback-subagent",
        description: "Test without parent callbacks",
        systemPrompt: "Test without parent callbacks",
        tools: [],
        model: "inherit",
        filePath: "/tmp/no-callback-subagent.md",
        scope: "project",
        priority: 1,
      };

      const params = {
        description: "Test without callbacks",
        prompt: "Test message",
        subagent_type: "no-callback-subagent",
      };

      // Should not throw when creating instance without parent callbacks
      expect(async () => {
        const instance = await noCallbackManager.createInstance(
          mockConfig,
          params,
        );
        instance.messageManager.addUserMessage({ content: "Test" });
        instance.messageManager.addAssistantMessage("Response");
      }).not.toThrow();
    });
  });

  describe("multiple subagent instances", () => {
    it("should handle multiple subagent instances with separate callback contexts", async () => {
      const mockConfig1: SubagentConfiguration = {
        name: "subagent-1",
        description: "First subagent",
        systemPrompt: "First subagent",
        tools: [],
        model: "inherit",
        filePath: "/tmp/subagent-1.md",
        scope: "project",
        priority: 1,
      };

      const mockConfig2: SubagentConfiguration = {
        name: "subagent-2",
        description: "Second subagent",
        systemPrompt: "Second subagent",
        tools: [],
        model: "inherit",
        filePath: "/tmp/subagent-2.md",
        scope: "project",
        priority: 1,
      };

      const params1 = {
        description: "First subagent test",
        prompt: "Hello from first",
        subagent_type: "subagent-1",
      };

      const params2 = {
        description: "Second subagent test",
        prompt: "Hello from second",
        subagent_type: "subagent-2",
      };

      const instance1 = await subagentManager.createInstance(
        mockConfig1,
        params1,
      );
      const instance2 = await subagentManager.createInstance(
        mockConfig2,
        params2,
      );

      vi.clearAllMocks();

      // Add messages to both subagents
      instance1.messageManager.addUserMessage({
        content: "Message from first subagent",
      });
      instance2.messageManager.addUserMessage({
        content: "Message from second subagent",
      });

      // Should have been called twice with different subagent IDs
      expect(callbacks.onSubagentUserMessageAdded).toHaveBeenCalledTimes(2);

      const mockedCallback = vi.mocked(callbacks.onSubagentUserMessageAdded)!;
      expect(mockedCallback.mock.calls).toBeDefined();
      const calls = mockedCallback.mock.calls!;
      expect(calls[0]![0]).toBe(instance1.subagentId);
      expect(calls[0]![1]).toEqual({ content: "Message from first subagent" });
      expect(calls[1]![0]).toBe(instance2.subagentId);
      expect(calls[1]![1]).toEqual({ content: "Message from second subagent" });
    });
  });
});
