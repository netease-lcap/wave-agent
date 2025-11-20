/**
 * @file Test suite for subagent-specific callbacks in MessageManager
 * Tests the new onSubagent* callback functionality
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../../src/managers/messageManager.js";
import type {
  UserMessageParams,
  AgentToolBlockUpdateParams,
} from "../../../src/utils/messageOperations.js";

describe("MessageManager - Subagent Callbacks", () => {
  let mockCallbacks: MessageManagerCallbacks;

  beforeEach(() => {
    mockCallbacks = {
      onMessagesChange: vi.fn(),
      onUserMessageAdded: vi.fn(),
      onAssistantMessageAdded: vi.fn(),
      onAssistantContentUpdated: vi.fn(),
      onToolBlockUpdated: vi.fn(),
      onSubagentUserMessageAdded: vi.fn(),
      onSubagentAssistantMessageAdded: vi.fn(),
      onSubagentAssistantContentUpdated: vi.fn(),
      onSubagentToolBlockUpdated: vi.fn(),
    };
  });

  describe("callback interface verification", () => {
    it("should support all subagent callback types in interface", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
      });

      expect(messageManager).toBeDefined();
      expect(typeof mockCallbacks.onSubagentUserMessageAdded).toBe("function");
      expect(typeof mockCallbacks.onSubagentAssistantMessageAdded).toBe(
        "function",
      );
      expect(typeof mockCallbacks.onSubagentAssistantContentUpdated).toBe(
        "function",
      );
      expect(typeof mockCallbacks.onSubagentToolBlockUpdated).toBe("function");
    });

    it("should work without subagent callbacks defined", () => {
      const basicCallbacks: MessageManagerCallbacks = {
        onMessagesChange: vi.fn(),
      };

      const messageManager = new MessageManager({
        callbacks: basicCallbacks,
        workdir: "/tmp/test",
      });

      expect(messageManager).toBeDefined();
      // Should not throw when subagent callbacks are undefined
      messageManager.addUserMessage({ content: "test" });
    });
  });

  describe("onSubagentUserMessageAdded (T009)", () => {
    it("should invoke onSubagentUserMessageAdded when subagentId is provided", () => {
      const subagentId = "test-subagent-123";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      const userMessageParams: UserMessageParams = {
        content: "Hello from subagent",
        images: [{ path: "image1.png", mimeType: "image/png" }],
      };

      messageManager.addUserMessage(userMessageParams);

      // Should invoke both regular and subagent callbacks
      expect(mockCallbacks.onUserMessageAdded).toHaveBeenCalledWith(
        userMessageParams,
      );
      expect(mockCallbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
        subagentId,
        userMessageParams,
      );
    });

    it("should not invoke onSubagentUserMessageAdded when subagentId is not provided", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        // No subagentId provided
      });

      const userMessageParams: UserMessageParams = {
        content: "Hello from main agent",
      };

      messageManager.addUserMessage(userMessageParams);

      // Should only invoke regular callback
      expect(mockCallbacks.onUserMessageAdded).toHaveBeenCalledWith(
        userMessageParams,
      );
      expect(mockCallbacks.onSubagentUserMessageAdded).not.toHaveBeenCalled();
    });

    it("should not throw when onSubagentUserMessageAdded is undefined", () => {
      const callbacksWithoutSubagent: MessageManagerCallbacks = {
        onUserMessageAdded: vi.fn(),
        // onSubagentUserMessageAdded not defined
      };

      const messageManager = new MessageManager({
        callbacks: callbacksWithoutSubagent,
        workdir: "/tmp/test",
        subagentId: "test-subagent-123",
      });

      expect(() => {
        messageManager.addUserMessage({ content: "test" });
      }).not.toThrow();
    });
  });

  describe("onSubagentAssistantMessageAdded (T013)", () => {
    it("should invoke onSubagentAssistantMessageAdded when subagentId is provided", () => {
      const subagentId = "test-subagent-456";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      messageManager.addAssistantMessage("Assistant response");

      // Should invoke both regular and subagent callbacks
      expect(mockCallbacks.onAssistantMessageAdded).toHaveBeenCalled();
      expect(
        mockCallbacks.onSubagentAssistantMessageAdded,
      ).toHaveBeenCalledWith(subagentId);
    });

    it("should not invoke onSubagentAssistantMessageAdded when subagentId is not provided", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        // No subagentId provided
      });

      messageManager.addAssistantMessage("Assistant response");

      // Should only invoke regular callback
      expect(mockCallbacks.onAssistantMessageAdded).toHaveBeenCalled();
      expect(
        mockCallbacks.onSubagentAssistantMessageAdded,
      ).not.toHaveBeenCalled();
    });

    it("should not throw when onSubagentAssistantMessageAdded is undefined", () => {
      const callbacksWithoutSubagent: MessageManagerCallbacks = {
        onAssistantMessageAdded: vi.fn(),
        // onSubagentAssistantMessageAdded not defined
      };

      const messageManager = new MessageManager({
        callbacks: callbacksWithoutSubagent,
        workdir: "/tmp/test",
        subagentId: "test-subagent-456",
      });

      expect(() => {
        messageManager.addAssistantMessage("test response");
      }).not.toThrow();
    });
  });

  describe("onSubagentAssistantContentUpdated (T017)", () => {
    it("should invoke onSubagentAssistantContentUpdated when subagentId is provided", () => {
      const subagentId = "test-subagent-789";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      // First add an assistant message to have something to update
      messageManager.addAssistantMessage("Initial");

      const accumulated = "Initial additional content";
      const expectedChunk = " additional content"; // This is what should be calculated

      messageManager.updateCurrentMessageContent(accumulated);

      // Should invoke both regular and subagent callbacks
      expect(mockCallbacks.onAssistantContentUpdated).toHaveBeenCalledWith(
        expectedChunk,
        accumulated,
      );
      expect(
        mockCallbacks.onSubagentAssistantContentUpdated,
      ).toHaveBeenCalledWith(subagentId, expectedChunk, accumulated);
    });

    it("should not invoke onSubagentAssistantContentUpdated when subagentId is not provided", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        // No subagentId provided
      });

      // First add an assistant message to have something to update
      messageManager.addAssistantMessage("Initial");

      const accumulated = "Initial additional content";

      messageManager.updateCurrentMessageContent(accumulated);

      // Should only invoke regular callback
      expect(mockCallbacks.onAssistantContentUpdated).toHaveBeenCalled();
      expect(
        mockCallbacks.onSubagentAssistantContentUpdated,
      ).not.toHaveBeenCalled();
    });

    it("should handle multiple content updates correctly", () => {
      const subagentId = "test-subagent-multi";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      // First add an assistant message
      messageManager.addAssistantMessage("Hello");

      // Update content multiple times
      messageManager.updateCurrentMessageContent("Hello world");
      messageManager.updateCurrentMessageContent("Hello world!");

      // Should invoke subagent callback for each update
      expect(
        mockCallbacks.onSubagentAssistantContentUpdated,
      ).toHaveBeenCalledTimes(2);
      // The callback should be called with calculated chunks
      expect(
        mockCallbacks.onSubagentAssistantContentUpdated,
      ).toHaveBeenCalledWith(subagentId, expect.any(String), "Hello world");
      expect(
        mockCallbacks.onSubagentAssistantContentUpdated,
      ).toHaveBeenCalledWith(subagentId, expect.any(String), "Hello world!");
    });
  });

  describe("onSubagentToolBlockUpdated (T021)", () => {
    it("should invoke onSubagentToolBlockUpdated when subagentId is provided", () => {
      const subagentId = "test-subagent-tool";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      // First add an assistant message with tool call to have something to update
      messageManager.addAssistantMessage("", [
        {
          id: "tool-call-1",
          type: "function",
          function: {
            name: "Read",
            arguments: '{"file_path": "/test/file.txt"}',
          },
        },
      ]);

      const toolUpdateParams: AgentToolBlockUpdateParams = {
        id: "tool-call-1",
        stage: "end",
        parameters: '{"file_path": "/test/file.txt"}',
        result: "File content here",
      };

      messageManager.updateToolBlock(toolUpdateParams);

      // Should invoke both regular and subagent callbacks
      expect(mockCallbacks.onToolBlockUpdated).toHaveBeenCalledWith(
        toolUpdateParams,
      );
      expect(mockCallbacks.onSubagentToolBlockUpdated).toHaveBeenCalledWith(
        subagentId,
        toolUpdateParams,
      );
    });

    it("should not invoke onSubagentToolBlockUpdated when subagentId is not provided", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        // No subagentId provided
      });

      // First add an assistant message with tool call
      messageManager.addAssistantMessage("", [
        {
          id: "tool-call-2",
          type: "function",
          function: {
            name: "Bash",
            arguments: '{"command": "ls"}',
          },
        },
      ]);

      const toolUpdateParams: AgentToolBlockUpdateParams = {
        id: "tool-call-2",
        stage: "end",
        parameters: '{"command": "ls"}',
        result: "file1.txt file2.txt",
      };

      messageManager.updateToolBlock(toolUpdateParams);

      // Should only invoke regular callback
      expect(mockCallbacks.onToolBlockUpdated).toHaveBeenCalledWith(
        toolUpdateParams,
      );
      expect(mockCallbacks.onSubagentToolBlockUpdated).not.toHaveBeenCalled();
    });

    it("should handle different tool block statuses correctly", () => {
      const subagentId = "test-subagent-tool-status";

      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: subagentId,
      });

      // First add an assistant message with tool call
      messageManager.addAssistantMessage("", [
        {
          id: "tool-call-3",
          type: "function",
          function: {
            name: "Write",
            arguments: '{"file_path": "/test/new.txt", "content": "Hello"}',
          },
        },
      ]);

      // Update with running status
      const runningParams: AgentToolBlockUpdateParams = {
        id: "tool-call-3",
        stage: "running",
        parameters: '{"file_path": "/test/new.txt", "content": "Hello"}',
      };
      messageManager.updateToolBlock(runningParams);

      // Update with completed status
      const completedParams: AgentToolBlockUpdateParams = {
        id: "tool-call-3",
        stage: "end",
        parameters: '{"file_path": "/test/new.txt", "content": "Hello"}',
        result: "File written successfully",
      };
      messageManager.updateToolBlock(completedParams);

      // Should invoke subagent callback for each status update
      expect(mockCallbacks.onSubagentToolBlockUpdated).toHaveBeenCalledTimes(2);
      expect(mockCallbacks.onSubagentToolBlockUpdated).toHaveBeenNthCalledWith(
        1,
        subagentId,
        runningParams,
      );
      expect(mockCallbacks.onSubagentToolBlockUpdated).toHaveBeenNthCalledWith(
        2,
        subagentId,
        completedParams,
      );
    });
  });

  describe("edge cases and error handling", () => {
    it("should handle subagentId change gracefully", () => {
      // This tests that the subagentId is stored correctly and used consistently
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: "initial-subagent",
      });

      messageManager.addUserMessage({ content: "test message" });

      expect(mockCallbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
        "initial-subagent",
        { content: "test message" },
      );
    });

    it("should handle empty subagentId", () => {
      const messageManager = new MessageManager({
        callbacks: mockCallbacks,
        workdir: "/tmp/test",
        subagentId: "", // Empty string
      });

      messageManager.addUserMessage({ content: "test message" });

      // Empty subagentId should still be passed to callback
      expect(mockCallbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
        "",
        { content: "test message" },
      );
    });

    it("should not throw when callbacks throw errors", () => {
      const errorThrowingCallbacks: MessageManagerCallbacks = {
        onSubagentUserMessageAdded: vi.fn().mockImplementation(() => {
          throw new Error("Callback error");
        }),
        onUserMessageAdded: vi.fn(),
      };

      const messageManager = new MessageManager({
        callbacks: errorThrowingCallbacks,
        workdir: "/tmp/test",
        subagentId: "error-test",
      });

      // Should not throw even if callback throws
      expect(() => {
        messageManager.addUserMessage({ content: "test" });
      }).not.toThrow();
    });
  });

  describe("backward compatibility", () => {
    it("should work with existing MessageManager usage patterns", () => {
      // Test that existing code without subagent callbacks still works
      const legacyCallbacks: MessageManagerCallbacks = {
        onMessagesChange: vi.fn(),
        onUserMessageAdded: vi.fn(),
        onAssistantMessageAdded: vi.fn(),
      };

      const messageManager = new MessageManager({
        callbacks: legacyCallbacks,
        workdir: "/tmp/test",
      });

      // Should work exactly as before
      messageManager.addUserMessage({ content: "legacy test" });
      messageManager.addAssistantMessage("legacy response");

      expect(legacyCallbacks.onUserMessageAdded).toHaveBeenCalled();
      expect(legacyCallbacks.onAssistantMessageAdded).toHaveBeenCalled();
    });
  });
});
