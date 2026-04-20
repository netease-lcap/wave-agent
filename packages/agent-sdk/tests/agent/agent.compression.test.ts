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

describe("Agent Message Compression Tests", () => {
  let agent: Agent;

  beforeEach(async () => {
    // Disable auto-memory to prevent extra callAgent calls from background tasks
    vi.stubEnv("WAVE_DISABLE_AUTO_MEMORY", "1");

    // Clear WAVE_MAX_INPUT_TOKENS to use default 96000 for compression threshold
    delete process.env.WAVE_MAX_INPUT_TOKENS;

    // Create Agent instance with required parameters
    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-compression",
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

  it("should trigger compression when token usage exceeds 96k", async () => {
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

    let compressMessagesCalled = false;

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      // Return high token usage to trigger compression
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compression
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      compressMessagesCalled = true;
      return {
        content:
          "Compressed content: Previous conversations involved multiple task requests and corresponding processing.",
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      };
    });

    // Call sendMessage to trigger AI call (this will trigger compression)
    await agent.sendMessage("Test message");

    // Verify AI service was called
    expect(mockCallAgent).toHaveBeenCalledTimes(1);

    // Verify compression function was called (because token usage exceeded 96k)
    expect(compressMessagesCalled).toBe(true);
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // Verify compression function parameters when called
    const compressCall = mockCompressMessages.mock.calls[0];
    expect(compressCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compressCall[0].messages)).toBe(true);
    expect(compressCall[0].messages.length).toBeGreaterThan(0);

    // Verify that the compressed assistant message includes usage field
    const messagesAfterCompression = agent.messages;
    const compressedMessage = messagesAfterCompression.find(
      (message) =>
        message.role === "assistant" &&
        message.blocks.some((block) => block.type === "compress"),
    );
    expect(compressedMessage).toBeDefined();
    expect(compressedMessage?.usage).toBeDefined();
    expect(compressedMessage?.usage).toMatchObject({
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      operation_type: "compress",
    });

    // Verify compressCall messages should include user1 to user6
    const messagesToCompress = compressCall[0].messages;
    const userMessages = messagesToCompress.filter(
      (msg) => msg.role === "user",
    );

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

  it("should not trigger compression when token usage is below threshold", async () => {
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

    let compressMessagesCalled = false;

    // Mock AI service returns low token usage
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

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

    mockCompressMessages.mockImplementation(async () => {
      compressMessagesCalled = true;
      return {
        content: "This should not be called",
      };
    });

    // Call sendMessage
    await agent.sendMessage("Test message");

    // Verify AI service was called but compression function was not called
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(compressMessagesCalled).toBe(false);
    expect(mockCompressMessages).toHaveBeenCalledTimes(0);
  });

  it("should handle compression errors gracefully", async () => {
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
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compression
        },
      };
    });

    // Mock compression function throws error
    mockCompressMessages.mockRejectedValue(new Error("Compression failed"));

    // Call sendMessage to trigger compression
    await agent.sendMessage("Test message");

    // Verify call details
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

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
      "Failed to compress conversation history: Compression failed",
    );

    // Verify session ID remains unchanged (no reset)
    expect(agent.sessionId).toBe(initialSessionId);

    // Verify no "compress" block was added
    const hasCompressBlock = agent.messages.some((msg) =>
      msg.blocks.some((block) => block.type === "compress"),
    );
    expect(hasCompressBlock).toBe(false);
  });

  it("should compress all messages when session already contains compression", async () => {
    // Test scenario: When session already contains compression message, new compression should compress all content including previous compression point

    // Create initial 15 pairs of messages (30 messages)
    const initialMessages = generateMessages(15);

    // Insert a compression message at position 9 (representing previous compression)
    const messagesWithCompression: Message[] = [
      ...initialMessages.slice(0, 8), // First 8 messages
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "compress",
            content: "Compressed content: Contains summary of first 6 messages",
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
          content: "Trigger compression again",
        },
      ],
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      callbacks: {
        onMessagesChange: vi.fn(),
      },
      messages: [...messagesWithCompression, newUserMessage],
    });

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "I understand your request.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compression
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      return {
        content: "New compressed content: Contains summary of more messages",
        usage: {
          prompt_tokens: 800,
          completion_tokens: 400,
          total_tokens: 1200,
        },
      };
    });

    // Call sendMessage to trigger compression
    await agent.sendMessage("Test message");

    // Verify compression function was called
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // Verify compression function parameters when called
    const compressCall = mockCompressMessages.mock.calls[0];
    expect(compressCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compressCall[0].messages)).toBe(true);
    expect(compressCall[0].messages.length).toBeGreaterThan(0);

    // Verify compressCall messages should include all messages
    const messagesToCompress = compressCall[0].messages;

    const userMessages = messagesToCompress.filter(
      (msg) => msg.role === "user",
    );

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

    // Verify that the previous compressed message should be included as context
    const hasCompressedMessage = compressCall[0].messages.some(
      (msg) =>
        msg.role === "assistant" &&
        typeof msg.content === "string" &&
        msg.content.includes(
          "Compressed content: Contains summary of first 6 messages",
        ),
    );
    expect(hasCompressedMessage).toBe(true);

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

  it("should send compressed message plus subsequent messages to callAgent", async () => {
    // Create 10 pairs of messages (20 messages) to trigger compression
    const messages = generateMessages(10);

    // Add the first user message to trigger compression
    const firstUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [
        {
          type: "text",
          content: "First trigger message for compression",
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
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    let callAgentCallCount = 0;
    let messagesPassedToCallAgent: ChatCompletionMessageParam[] = [];

    mockCallAgent.mockImplementation(async (params) => {
      callAgentCallCount++;
      messagesPassedToCallAgent = params.messages || [];

      if (callAgentCallCount === 1) {
        // First call returns high token usage to trigger compression
        return {
          content: "I understand. Let me help you with that task.",
          usage: {
            prompt_tokens: 50000,
            completion_tokens: 20000,
            total_tokens: 102000, // Exceeds 96000 to trigger compression
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

    mockCompressMessages.mockImplementation(async () => {
      return {
        content:
          "Compressed content: This contains summary information of previous multi-round conversations.",
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 600,
          total_tokens: 1800,
        },
      };
    });

    // First call to sendMessage triggers compression
    await agent.sendMessage("Test message");

    // Verify compression is triggered
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);
    expect(callAgentCallCount).toBe(1);

    // Get compressed message list
    const messagesAfterCompression = agent.messages;

    // Verify that the message list now contains the compressed message plus the last 3 messages
    expect(messagesAfterCompression.length).toBe(4);
    const compressedMessage = messagesAfterCompression[0];
    expect(compressedMessage.role).toBe("assistant");
    expect(compressedMessage.blocks[0].type).toBe("compress");
    // Type assertion to access the content property of CompressBlock
    const compressBlock = compressedMessage.blocks[0] as {
      type: "compress";
      content: string;
      sessionId: string;
    };
    expect(compressBlock.content).toContain(
      "Compressed content: This contains summary information of previous multi-round conversations.",
    );
    expect(compressBlock.content).toContain("[Context Restoration]");
    expect(compressBlock.content).toContain("[Working Directory]");

    // Reset messagesPassedToCallAgent to capture parameters for the second call
    messagesPassedToCallAgent = [];

    // Second call to sendMessage
    await agent.sendMessage("Second message after compression");

    // Verify parameters of the second call
    expect(callAgentCallCount).toBe(2);

    // Verify that messages passed to callAgent include the compressed message plus the 3 preserved messages plus the new message
    expect(messagesPassedToCallAgent.length).toBe(5);

    // Verify the structure of messages passed to callAgent
    // The first message should be the compressed assistant message
    expect(messagesPassedToCallAgent[0].role).toBe("assistant");
    expect(messagesPassedToCallAgent[0].content).toContain(
      "Compressed content: This contains summary information of previous multi-round conversations.",
    );

    // The last message should be the second user message we added
    const lastMessage =
      messagesPassedToCallAgent[messagesPassedToCallAgent.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toEqual([
      {
        type: "text",
        text: "Second message after compression",
      },
    ]);
  });

  it("should save session before compression to preserve original messages", async () => {
    // Create message history with enough messages to trigger compression
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
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      // Return high token usage to trigger compression
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compression
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      return {
        content:
          "Compressed content: Previous conversations involved multiple task requests and corresponding processing.",
        usage: {
          prompt_tokens: 900,
          completion_tokens: 450,
          total_tokens: 1350,
        },
      };
    });

    // Call sendMessage to trigger AI call (this will trigger compression)
    await agent.sendMessage("Test message");

    // Verify saveSession was called at least 3rd:
    // 0. At the start
    // 1. Before compression (to preserve original messages)
    // 2. At the end of sendAIMessage (normal session save)
    expect(saveSessionSpy).toHaveBeenCalledTimes(3);

    // Verify the order: saveSession should be called before compressMessages
    const saveSessionCalls = saveSessionSpy.mock.invocationCallOrder;
    const compressMessagesCalls = mockCompressMessages.mock.invocationCallOrder;

    // At least one saveSession call should happen before compression
    expect(saveSessionCalls[0]).toBeLessThan(compressMessagesCalls[0]);

    // Verify compression function was called
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);
  });

  it("should skip compression after 3 consecutive failures (circuit breaker)", async () => {
    // Create message history with enough messages to trigger compression
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
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    // First three calls trigger compression but fail
    for (let i = 0; i < 3; i++) {
      mockCallAgent.mockImplementation(async () => ({
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      }));
      mockCompressMessages.mockRejectedValue(new Error("Compression failed"));

      await agent.sendMessage(`Message ${i + 1}`);
    }

    // Verify compression was attempted 3 times
    expect(mockCompressMessages).toHaveBeenCalledTimes(3);

    // Reset call count for the 4th call
    mockCompressMessages.mockClear();

    // Fourth call: should still trigger high token usage but compression should be skipped
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompressMessages.mockResolvedValue({ content: "should not reach" });

    await agent.sendMessage("Message 4");

    // Compression should NOT be called due to circuit breaker
    expect(mockCompressMessages).not.toHaveBeenCalled();
  });

  it("should reset circuit breaker counter on successful compression", async () => {
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
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    // First call: compression fails (counter = 1)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompressMessages.mockRejectedValue(new Error("Fail 1"));
    await agent.sendMessage("Message 1");
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // Reset mock for second call
    mockCompressMessages.mockClear();

    // Second call: compression fails again (counter = 2)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompressMessages.mockRejectedValue(new Error("Fail 2"));
    await agent.sendMessage("Message 2");
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // Reset mock for third call
    mockCompressMessages.mockClear();

    // Third call: compression succeeds (counter reset to 0)
    mockCallAgent.mockImplementation(async () => ({
      content: "Response",
      usage: {
        prompt_tokens: 50000,
        completion_tokens: 20000,
        total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
      },
    }));
    mockCompressMessages.mockResolvedValue({
      content: "Success",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    await agent.sendMessage("Message 3");
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // Reset mock for subsequent calls
    mockCompressMessages.mockClear();

    // Next 3 calls: compression fails — circuit breaker should NOT trip
    // because the successful compression reset the counter
    for (let i = 0; i < 3; i++) {
      mockCallAgent.mockImplementation(async () => ({
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      }));
      mockCompressMessages.mockRejectedValue(new Error(`Fail ${i + 1}`));
      await agent.sendMessage(`Message after reset ${i + 1}`);
    }

    // All 3 calls should have attempted compression (circuit breaker not tripped)
    expect(mockCompressMessages).toHaveBeenCalledTimes(3);
  });
});
