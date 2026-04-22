import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { Message } from "@/types/index.js";
import { DEFAULT_WAVE_MAX_INPUT_TOKENS } from "@/utils/constants.js";
import { ChatCompletionMessageParam } from "openai/resources.js";
import { MessageManager } from "@/managers/messageManager.js";
import { generateMessageId } from "@/utils/messageOperations.js";

// Mock AI Service
vi.mock("@/services/aiService");

describe("Agent Message Compaction Tests", () => {
  let agent: Agent;

  beforeEach(async () => {
    // Disable auto-memory to prevent extra callAgent calls from background tasks
    vi.stubEnv("WAVE_DISABLE_AUTO_MEMORY", "1");

    // Clear WAVE_MAX_INPUT_TOKENS to use default 96000 for compaction threshold
    delete process.env.WAVE_MAX_INPUT_TOKENS;

    // Create Agent instance with required parameters
    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-compaction",
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    vi.unstubAllEnvs();
  });

  // Helper function: generate specified number of message conversations
  const generateMessages = (count: number): Message[] => {
    const messages: Message[] = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        id: generateMessageId(),
        role: "user",
        blocks: [
          {
            type: "text",
            content: `User message ${i + 1}: Please help me with task ${i + 1}`,
          },
        ],
      });
      messages.push({
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "text",
            content: `Assistant response ${i + 1}: I'll help you with task ${i + 1}`,
          },
        ],
      });
    }
    return messages;
  };

  it("should trigger compaction when token usage exceeds 96k", async () => {
    // Create message history with enough messages (generate 8 pairs of messages, total 16)
    const messages = generateMessages(8);

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Please optimize the component performance",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    let compactMessagesCalled = false;

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    mockCallAgent.mockImplementation(async () => {
      // Return high token usage to trigger compaction
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    mockCompactMessages.mockImplementation(async () => {
      compactMessagesCalled = true;
      return {
        content:
          "Compacted content: Previous conversations involved multiple task requests and corresponding processing.",
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      };
    });

    // Call sendMessage to trigger AI call (this will trigger compaction)
    await agent.sendMessage("Test message");

    // Verify AI service was called
    expect(mockCallAgent).toHaveBeenCalledTimes(1);

    // Verify compaction function was called (because token usage exceeded 96k)
    expect(compactMessagesCalled).toBe(true);
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Verify compaction function parameters when called
    const compactCall = mockCompactMessages.mock.calls[0];
    expect(compactCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compactCall[0].messages)).toBe(true);
    expect(compactCall[0].messages.length).toBeGreaterThan(0);

    // Verify that the compacted assistant message includes usage field
    const messagesAfterCompaction = agent.messages;
    const compactedMessage = messagesAfterCompaction.find(
      (message) =>
        message.role === "assistant" &&
        message.blocks.some((block) => block.type === "compact"),
    );
    expect(compactedMessage).toBeDefined();
    expect(compactedMessage?.usage).toBeDefined();
    expect(compactedMessage?.usage).toMatchObject({
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      operation_type: "compact",
    });

    // Verify compactCall messages should include user1 to user6
    const messagesToCompact = compactCall[0].messages;
    const userMessages = messagesToCompact.filter((msg) => msg.role === "user");

    // Verify contains user1 to user6 message content
    for (let i = 1; i < 7; i++) {
      const expectedUserContent = `User message ${i}: Please help me with task ${i}`;
      const hasUserMessage = userMessages.some((msg) => {
        if (typeof msg.content === "string") {
          return msg.content === expectedUserContent;
        }
        if (Array.isArray(msg.content) && msg.content[0].type === "text") {
          return msg.content[0].text === expectedUserContent;
        }
        return false;
      });
      expect(hasUserMessage).toBe(true);
    }
  });

  it("should not trigger compaction when token usage is below threshold", async () => {
    // Create a small message history (only generate 1 pair of messages, total 2)
    const messages = generateMessages(1);

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "How are you?",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    let compactMessagesCalled = false;

    // Mock AI service returns low token usage
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Sure, I can help with that.",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150, // Far below default limit
        },
      };
    });

    mockCompactMessages.mockImplementation(async () => {
      compactMessagesCalled = true;
      return {
        content: "This should not be called",
      };
    });

    // Call sendMessage
    await agent.sendMessage("Test message");

    // Verify AI service was called but compaction function was not called
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(compactMessagesCalled).toBe(false);
    expect(mockCompactMessages).toHaveBeenCalledTimes(0);
  });

  it("should handle compaction errors gracefully", async () => {
    // Create message history with enough messages (generate 10 pairs of messages, total 20)
    const messages = generateMessages(10);

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test message",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const initialSessionId = agent.sessionId;

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    // Mock compaction function throws error
    mockCompactMessages.mockRejectedValue(new Error("Compaction failed"));

    // Call sendMessage to trigger compaction
    await agent.sendMessage("Test message");

    // Verify call details
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Verify that an error block was added to the messages
    const lastMessage = agent.messages[agent.messages.length - 1];
    expect(lastMessage.blocks.some((block) => block.type === "error")).toBe(
      true,
    );
    const errorBlock = lastMessage.blocks.find(
      (block) => block.type === "error",
    ) as {
      type: "error";
      content: string;
    };
    expect(errorBlock.content).toContain(
      "Failed to compact conversation history: Compaction failed",
    );

    // Verify session ID remains unchanged (no reset)
    expect(agent.sessionId).toBe(initialSessionId);

    // Verify no "compact" block was added
    const hasCompactBlock = agent.messages.some((msg) =>
      msg.blocks.some((block) => block.type === "compact"),
    );
    expect(hasCompactBlock).toBe(false);
  });

  it("should compact all messages when session already contains compaction", async () => {
    // Test scenario: When session already contains compaction message, new compaction should compact all content including previous compaction point

    // Create initial 15 pairs of messages (30 messages)
    const initialMessages = generateMessages(15);

    // Insert a compaction message at position 9 (representing previous compaction)
    const messagesWithCompaction: Message[] = [
      ...initialMessages.slice(0, 8), // First 8 messages
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "compact",
            content: "Compacted content: Contains summary of first 6 messages",
            sessionId: "test-session-id",
          },
        ],
      },
      ...initialMessages.slice(8), // Remaining messages
    ];

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Trigger compaction again",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      callbacks: {
        onMessagesChange: vi.fn(),
      },
      messages: [...messagesWithCompaction, newUserMessage],
    });

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "I understand your request.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    mockCompactMessages.mockImplementation(async () => {
      return {
        content: "New compacted content: Contains summary of more messages",
        usage: {
          prompt_tokens: 800,
          completion_tokens: 400,
          total_tokens: 1200,
        },
      };
    });

    // Call sendMessage to trigger compaction
    await agent.sendMessage("Test message");

    // Verify compaction function was called
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Verify compaction function parameters when called
    const compactCall = mockCompactMessages.mock.calls[0];
    expect(compactCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compactCall[0].messages)).toBe(true);
    expect(compactCall[0].messages.length).toBeGreaterThan(0);

    // Verify compactCall messages should include all messages
    const messagesToCompact = compactCall[0].messages;

    const userMessages = messagesToCompact.filter((msg) => msg.role === "user");

    // Verify the included message content
    const hasUser5 = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return (
        content &&
        content.includes("User message 5: Please help me with task 5")
      );
    });
    expect(hasUser5).toBe(true);

    const hasUser13 = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return (
        content &&
        content.includes("User message 13: Please help me with task 13")
      );
    });
    expect(hasUser13).toBe(true);

    // Verify that the previous compacted message should be included as context
    const hasCompactedMessage = compactCall[0].messages.some(
      (msg) =>
        msg.role === "user" &&
        typeof msg.content === "string" &&
        msg.content.includes(
          "Compacted content: Contains summary of first 6 messages",
        ),
    );
    expect(hasCompactedMessage).toBe(true);

    // Verify that the latest messages ARE included (since we now compact everything)
    const hasLatestUser = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return content && content.includes("User message 15");
    });
    expect(hasLatestUser).toBe(true);
  });

  it("should send compacted message plus subsequent messages to callAgent", async () => {
    // Create 10 pairs of messages (20 messages) to trigger compaction
    const messages = generateMessages(10);

    // Add the first user message to trigger compaction
    const firstUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "First trigger message for compaction",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, firstUserMessage],
    });

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    let callAgentCallCount = 0;
    let messagesPassedToCallAgent: ChatCompletionMessageParam[] = [];

    mockCallAgent.mockImplementation(async (params) => {
      callAgentCallCount++;
      messagesPassedToCallAgent = params.messages || [];

      if (callAgentCallCount === 1) {
        // First call returns high token usage to trigger compaction
        return {
          content: "I understand. Let me help you with that task.",
          usage: {
            prompt_tokens: 50000,
            completion_tokens: 20000,
            total_tokens: 102000, // Exceeds 96000 to trigger compaction
          },
        };
      } else {
        // Second call returns normal response
        return {
          content: "Here's my response to your second message.",
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
          },
        };
      }
    });

    mockCompactMessages.mockImplementation(async () => {
      return {
        content:
          "Compacted content: This contains summary information of previous multi-round conversations.",
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 600,
          total_tokens: 1800,
        },
      };
    });

    // First call to sendMessage triggers compaction
    await agent.sendMessage("Test message");

    // Verify compaction is triggered
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);
    expect(callAgentCallCount).toBe(1);

    // Get compacted message list
    const messagesAfterCompaction = agent.messages;

    // Verify that the message list now contains the compacted message plus the last 3 messages
    expect(messagesAfterCompaction.length).toBe(4);
    const compactedMessage = messagesAfterCompaction[0];
    expect(compactedMessage.role).toBe("assistant");
    expect(compactedMessage.blocks[0].type).toBe("compact");
    // Type assertion to access the content property of CompactBlock
    const compactBlock = compactedMessage.blocks[0] as {
      type: "compact";
      content: string;
      sessionId: string;
    };
    expect(compactBlock.content).toContain(
      "Compacted content: This contains summary information of previous multi-round conversations.",
    );
    expect(compactBlock.content).toContain("[Context Restoration]");
    expect(compactBlock.content).toContain("[Working Directory]");

    // Reset messagesPassedToCallAgent to capture parameters for the second call
    messagesPassedToCallAgent = [];

    // Second call to sendMessage
    await agent.sendMessage("Second message after compaction");

    // Verify parameters of the second call
    expect(callAgentCallCount).toBe(2);

    // Verify that messages passed to callAgent include the compacted message plus the 3 preserved messages plus the new message
    expect(messagesPassedToCallAgent.length).toBe(5);

    // Verify the structure of messages passed to callAgent
    // The first message should be the compacted message as user role (matching Claude Code's auto-compact)
    expect(messagesPassedToCallAgent[0].role).toBe("user");
    expect(messagesPassedToCallAgent[0].content).toContain(
      "Compacted content: This contains summary information of previous multi-round conversations.",
    );

    // The last message should be the second user message we added
    const lastMessage =
      messagesPassedToCallAgent[messagesPassedToCallAgent.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toEqual([
      {
        type: "text",
        text: "Second message after compaction",
      },
    ]);
  });

  it("should save session before compaction to preserve original messages", async () => {
    // Create message history with enough messages to trigger compaction
    const messages = generateMessages(8);

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Please optimize the component performance",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    // Track saveSession calls
    const saveSessionSpy = vi.spyOn(
      (agent as unknown as { messageManager: MessageManager }).messageManager,
      "saveSession",
    );

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    mockCallAgent.mockImplementation(async () => {
      // Return high token usage to trigger compaction
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    mockCompactMessages.mockImplementation(async () => {
      return {
        content:
          "Compacted content: Previous conversations involved multiple task requests and corresponding processing.",
        usage: {
          prompt_tokens: 900,
          completion_tokens: 450,
          total_tokens: 1350,
        },
      };
    });

    // Call sendMessage to trigger AI call (this will trigger compaction)
    await agent.sendMessage("Test message");

    // Verify saveSession was called at least 3rd:
    // 0. At the start
    // 1. Before compaction (to preserve original messages)
    // 2. At the end of sendAIMessage (normal session save)
    expect(saveSessionSpy).toHaveBeenCalledTimes(3);

    // Verify the order: saveSession should be called before compactMessages
    const saveSessionCalls = saveSessionSpy.mock.invocationCallOrder;
    const compactMessagesCalls = mockCompactMessages.mock.invocationCallOrder;

    // At least one saveSession call should happen before compaction
    expect(saveSessionCalls[0]).toBeLessThan(compactMessagesCalls[0]);

    // Verify compaction function was called
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);
  });

  it("should skip compaction after 3 consecutive failures (circuit breaker)", async () => {
    // Create message history with enough messages to trigger compaction
    const messages = generateMessages(8);

    // Add a new user message to trigger AI call
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test",
        },
      ],
    };

    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    // First three calls trigger compaction but fail
    for (let i = 0; i < 3; i++) {
      mockCallAgent.mockImplementation(async () => ({
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      }));
      mockCompactMessages.mockRejectedValue(new Error("Compaction failed"));

      await agent.sendMessage(`Message ${i + 1}`);
    }

    // Verify compaction was attempted 3 times
    expect(mockCompactMessages).toHaveBeenCalledTimes(3);

    // Reset call count for the 4th call
    mockCompactMessages.mockClear();

    // Fourth call: should still trigger high token usage but compaction should be skipped
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompactMessages.mockResolvedValue({ content: "should not reach" });

    await agent.sendMessage("Message 4");

    // Compaction should NOT be called due to circuit breaker
    expect(mockCompactMessages).not.toHaveBeenCalled();
  });

  it("should reset circuit breaker counter on successful compaction", async () => {
    const messages = generateMessages(8);
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [{ type: "text", content: "Test" }],
    };

    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompactMessages = vi.mocked(aiService.compactMessages);

    // First call: compaction fails (counter = 1)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompactMessages.mockRejectedValue(new Error("Fail 1"));
    await agent.sendMessage("Message 1");
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Reset mock for second call
    mockCompactMessages.mockClear();

    // Second call: compaction fails again (counter = 2)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompactMessages.mockRejectedValue(new Error("Fail 2"));
    await agent.sendMessage("Message 2");
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Reset mock for third call
    mockCompactMessages.mockClear();

    // Third call: compaction succeeds (counter reset to 0)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompactMessages.mockResolvedValue({
      content: "Success",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    await agent.sendMessage("Message 3");
    expect(mockCompactMessages).toHaveBeenCalledTimes(1);

    // Reset mock for subsequent calls
    mockCompactMessages.mockClear();

    // Next 3 calls: compaction fails — circuit breaker should NOT trip
    // because the successful compaction reset the counter
    for (let i = 0; i < 3; i++) {
      mockCallAgent.mockImplementation(async () => ({
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      }));
      mockCompactMessages.mockRejectedValue(new Error(`Fail ${i + 1}`));
      await agent.sendMessage(`Message after reset ${i + 1}`);
    }

    // All 3 calls should have attempted compaction (circuit breaker not tripped)
    expect(mockCompactMessages).toHaveBeenCalledTimes(3);
  });
});
