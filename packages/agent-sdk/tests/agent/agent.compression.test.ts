import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { Message } from "@/types/index.js";
import { DEFAULT_TOKEN_LIMIT } from "@/utils/constants.js";
import { ChatCompletionMessageParam } from "openai/resources.js";
import { MessageManager } from "@/managers/messageManager.js";

// Mock AI Service
vi.mock("@/services/aiService");

describe("Agent Message Compression Tests", () => {
  let agent: Agent;

  beforeEach(async () => {
    // Create Agent instance with required parameters
    agent = await Agent.create({});

    vi.clearAllMocks();
  });

  // Helper function: generate specified number of message conversations
  const generateMessages = (count: number): Message[] => {
    const messages: Message[] = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: "user",
        blocks: [
          {
            type: "text",
            content: `User message ${i + 1}: Please help me with task ${i + 1}`,
          },
        ],
      });
      messages.push({
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
          total_tokens: DEFAULT_TOKEN_LIMIT + 6000, // Exceed default limit to trigger compression
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
    expect(compressedMessage?.usage).toEqual({
      prompt_tokens: 1000,
      completion_tokens: 500,
      total_tokens: 1500,
      model: "gemini-2.5-flash", // The default fast model
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

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_TOKEN_LIMIT + 6000, // Exceed default limit to trigger compression
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

    // Verify even if compression fails, AI call still succeeds (no exception thrown)
    // If no exception thrown here, error handling is correct
  });

  it("should compress messages from 7th last to previous compressed message when session already contains compression", async () => {
    // Test scenario: When session already contains compression message, new compression should only compress content between previous compression point and 8th to last message

    // Create initial 15 pairs of messages (30 messages)
    const initialMessages = generateMessages(15);

    // Insert a compression message at position 9 (representing previous compression)
    const messagesWithCompression: Message[] = [
      ...initialMessages.slice(0, 8), // First 8 messages
      {
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
          total_tokens: DEFAULT_TOKEN_LIMIT + 6000, // Exceed default limit to trigger compression
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

    // Verify compressCall messages should be from 7th to last to previous compression message
    const messagesToCompress = compressCall[0].messages;

    // Check compressed message range: should be from after compression message to 8th to last message (keeping recent 7)
    const userMessages = messagesToCompress.filter(
      (msg) => msg.role === "user",
    );

    // Verify the included message content (should include some user messages after the compressed message)
    // According to our settings, the compressed message is at the 9th position, so it should start from "User message 5" afterwards
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

    // Verify that the message includes up to the 7th to last message (should include User message 13, because the last message is the one we just sent)
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

    // Verify that the previous compressed message should be included as context (this is the expected behavior)
    // convertMessagesForAPI will convert compressed messages to system message format
    const hasCompressedMessage = compressCall[0].messages.some(
      (msg) =>
        msg.role === "system" &&
        typeof msg.content === "string" &&
        msg.content.includes(
          "Compressed content: Contains summary of first 6 messages",
        ),
    );
    expect(hasCompressedMessage).toBe(true);

    // Verify that the latest messages should not be included (the latest messages should be kept uncompressed)
    // The latest user message should be User message 15, which should not be in the compressed message
    const hasLatestUser = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return content && content.includes("User message 15");
    });
    expect(hasLatestUser).toBe(false);
  });

  it("should send compressed message plus all messages after compression point to callAgent", async () => {
    // Create 10 pairs of messages (20 messages) to trigger compression
    const messages = generateMessages(10);

    // Add the first user message to trigger compression
    const firstUserMessage: Message = {
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

    // Verify that the eighth message from the end becomes a compressed message
    const eighthLastMessage =
      messagesAfterCompression[messagesAfterCompression.length - 8];
    expect(eighthLastMessage.role).toBe("assistant");
    expect(eighthLastMessage.blocks[0].type).toBe("compress");
    // Type assertion to access the content property of CompressBlock
    const compressBlock = eighthLastMessage.blocks[0] as {
      type: "compress";
      content: string;
      sessionId: string;
    };
    expect(compressBlock.content).toBe(
      "Compressed content: This contains summary information of previous multi-round conversations.",
    );

    // Reset messagesPassedToCallAgent to capture parameters for the second call
    messagesPassedToCallAgent = [];

    // Second call to sendMessage
    await agent.sendMessage("Second message after compression");

    // Verify parameters of the second call
    expect(callAgentCallCount).toBe(2);

    // Verify that messages passed to callAgent include the compressed message plus all messages after the compression point
    expect(messagesPassedToCallAgent.length).toBeGreaterThan(1); // At least one compressed message and some recent messages

    // Verify the structure of messages passed to callAgent
    // The first message should be the compressed system message
    expect(messagesPassedToCallAgent[0].role).toBe("system");
    expect(messagesPassedToCallAgent[0].content).toContain(
      "[Compressed Message Summary]",
    );

    // Verify that the second message is the first user message retained after compression
    const secondMessage = messagesPassedToCallAgent[1];
    expect(secondMessage.role).toBe("user");

    // Verify that the expected assistant reply is included
    const assistantMessages = messagesPassedToCallAgent.filter(
      (m) => m.role === "assistant",
    );
    expect(assistantMessages.length).toBeGreaterThan(0);

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
          total_tokens: DEFAULT_TOKEN_LIMIT + 6000, // Exceed default limit to trigger compression
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
});
