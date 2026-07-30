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

    // Clear WAVE_MAX_INPUT_TOKENS to use default 128000 for compaction threshold
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
        timestamp: new Date().toISOString(),
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
        timestamp: new Date().toISOString(),
      });
    }
    return messages;
  };

  // Compaction runs a fork loop via callAgent: the forked request appends the
  // compact prompt as the final user message. Detect fork calls by it so
  // mocks can respond differently to the main loop vs the compaction fork.
  const isCompactForkCall = (params: {
    messages?: ChatCompletionMessageParam[];
  }): boolean => {
    const last = params.messages?.[params.messages.length - 1];
    return (
      last?.role === "user" &&
      typeof last.content === "string" &&
      last.content.includes("detailed summary of the conversation")
    );
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
      timestamp: new Date().toISOString(),
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    // Mock AI service: the compaction fork reuses callAgent, so respond
    // differently to the main loop vs the fork (detected by the compact
    // prompt appended as the final user message).
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        // Compaction fork: return the summary text
        return {
          content:
            "Compacted content: Previous conversations involved multiple task requests and corresponding processing.",
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 500,
            total_tokens: 1500,
          },
        };
      }
      // Main loop: return high token usage to trigger compaction
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    // Call sendMessage to trigger AI call (this will trigger compaction)
    await agent.sendMessage("Test message");

    // Verify AI service was called: main loop + compaction fork
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(isCompactForkCall(mockCallAgent.mock.calls[1][0])).toBe(true);

    // Verify fork call parameters when called
    const forkCall = mockCallAgent.mock.calls[1];
    expect(forkCall[0]).toHaveProperty("messages");
    expect(Array.isArray(forkCall[0].messages)).toBe(true);
    expect(forkCall[0].messages.length).toBeGreaterThan(0);

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

    // Verify fork-call messages should include user1 to user6
    const messagesToCompact = forkCall[0].messages;
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
      timestamp: new Date().toISOString(),
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    // Mock AI service returns low token usage
    const mockCallAgent = vi.mocked(aiService.callAgent);

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

    // Call sendMessage
    await agent.sendMessage("Test message");

    // Verify AI service was called but compaction function was not called
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
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
      timestamp: new Date().toISOString(),
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const initialSessionId = agent.sessionId;

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        throw new Error("Fork failed");
      }
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    // Call sendMessage to trigger compaction
    await agent.sendMessage("Test message");

    // Verify call details: main loop + failed fork attempt (no fallback)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);

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
      "Failed to compact conversation history: Fork failed",
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
          },
        ],
        timestamp: new Date().toISOString(),
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
      timestamp: new Date().toISOString(),
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

    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        // Compaction fork: return the summary text
        return {
          content: "New compacted content: Contains summary of more messages",
          usage: {
            prompt_tokens: 800,
            completion_tokens: 400,
            total_tokens: 1200,
          },
        };
      }
      return {
        content: "I understand your request.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceed default limit to trigger compaction
        },
      };
    });

    // Call sendMessage to trigger compaction
    await agent.sendMessage("Test message");

    // Verify the compaction fork was called
    const forkCall = mockCallAgent.mock.calls.find((call) =>
      isCompactForkCall(call[0]),
    );
    expect(forkCall).toBeDefined();

    // Verify fork call parameters when called
    expect(forkCall![0]).toHaveProperty("messages");
    expect(Array.isArray(forkCall![0].messages)).toBe(true);
    expect(forkCall![0].messages.length).toBeGreaterThan(0);

    // Verify fork-call messages should include all messages
    const messagesToCompact = forkCall![0].messages;

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
    const hasCompactedMessage = forkCall![0].messages.some(
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
      timestamp: new Date().toISOString(),
    };

    // Recreate Agent and pass in message history
    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, firstUserMessage],
    });

    // Mock AI service
    const mockCallAgent = vi.mocked(aiService.callAgent);

    let callAgentCallCount = 0;
    let messagesPassedToCallAgent: ChatCompletionMessageParam[] = [];

    mockCallAgent.mockImplementation(async (params) => {
      callAgentCallCount++;
      messagesPassedToCallAgent = params.messages || [];

      if (isCompactForkCall(params)) {
        // Compaction fork: return the summary text
        return {
          content:
            "Compacted content: This contains summary information of previous multi-round conversations.",
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 600,
            total_tokens: 1800,
          },
        };
      }

      if (callAgentCallCount === 1) {
        // First call returns high token usage to trigger compaction
        return {
          content: "I understand. Let me help you with that task.",
          usage: {
            prompt_tokens: 50000,
            completion_tokens: 20000,
            total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000, // Exceeds default limit to trigger compaction
          },
        };
      } else {
        // Subsequent main-loop calls return normal responses
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

    // First call to sendMessage triggers compaction
    await agent.sendMessage("Test message");

    // Verify compaction is triggered: main loop + compaction fork, no fallback
    expect(callAgentCallCount).toBe(2);

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

    // Reset messagesPassedToCallAgent to capture parameters for the second call
    messagesPassedToCallAgent = [];

    // Second call to sendMessage
    await agent.sendMessage("Second message after compaction");

    // Verify parameters of the second main-loop call
    expect(callAgentCallCount).toBe(3);

    // Verify that messages passed to callAgent include the compacted message plus the 3 preserved messages plus the new message
    // Plus 1 prepend memory message (system-reminder with AGENTS.md + user memory)
    expect(messagesPassedToCallAgent.length).toBe(6);

    // Verify the structure of messages passed to callAgent
    // The first message should be the compacted message as user role (matching Claude Code's auto-compact)
    // (index 0 is the prepend memory system-reminder)
    expect(messagesPassedToCallAgent[1].role).toBe("user");
    expect(messagesPassedToCallAgent[1].content).toContain(
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
      timestamp: new Date().toISOString(),
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

    // Call sendMessage to trigger AI call (this will trigger compaction)
    await agent.sendMessage("Test message");

    // Verify saveSession was called at least 3rd:
    // 0. At the start
    // 1. Before compaction (to preserve original messages)
    // 2. At the end of sendAIMessage (normal session save)
    expect(saveSessionSpy).toHaveBeenCalledTimes(3);

    // Verify the order: the pre-compaction saveSession should happen after
    // the main-loop callAgent call and before the compaction fork call
    const saveSessionCalls = saveSessionSpy.mock.invocationCallOrder;
    const callAgentCalls = mockCallAgent.mock.invocationCallOrder;

    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(isCompactForkCall(mockCallAgent.mock.calls[1][0])).toBe(true);
    expect(saveSessionCalls[1]).toBeGreaterThan(callAgentCalls[0]);
    expect(saveSessionCalls[1]).toBeLessThan(callAgentCalls[1]);
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
      timestamp: new Date().toISOString(),
    };

    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);

    // The main loop always returns high token usage to trigger compaction;
    // the fork always fails, driving consecutiveCompactionFailures upward.
    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        throw new Error("Fork failed");
      }
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      };
    });

    // First three calls trigger compaction but the fork fails each time
    for (let i = 0; i < 3; i++) {
      await agent.sendMessage(`Message ${i + 1}`);
    }

    // Verify the compaction fork was attempted 3 times (no fallback path)
    const forkAttemptsAfterFailures = mockCallAgent.mock.calls.filter((call) =>
      isCompactForkCall(call[0]),
    ).length;
    expect(forkAttemptsAfterFailures).toBe(3);

    // Fourth call: circuit breaker trips, compaction is skipped entirely
    const callCountBefore = mockCallAgent.mock.calls.length;
    await agent.sendMessage("Message 4");

    // Only one additional (main-loop) call — no fork attempt
    expect(mockCallAgent.mock.calls.length).toBe(callCountBefore + 1);
  });

  it("should reset circuit breaker counter on successful compaction", async () => {
    const messages = generateMessages(8);
    const newUserMessage: Message = {
      id: generateMessageId(),
      role: "user",
      blocks: [{ type: "text", content: "Test" }],
      timestamp: new Date().toISOString(),
    };

    await agent.destroy();
    agent = await Agent.create({
      messages: [...messages, newUserMessage],
    });

    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Toggle whether the compaction fork fails or succeeds. The main loop
    // always returns high token usage so each message triggers compaction.
    let forkShouldFail = true;
    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        if (forkShouldFail) throw new Error("Fork failed");
        return {
          content: "Compacted summary",
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
          },
        };
      }
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      };
    });

    const forkAttemptCount = () =>
      mockCallAgent.mock.calls.filter((call) => isCompactForkCall(call[0]))
        .length;

    // First two calls: fork fails (counter 1, then 2)
    await agent.sendMessage("Message 1");
    await agent.sendMessage("Message 2");
    expect(forkAttemptCount()).toBe(2);

    // Third call: fork succeeds (counter reset to 0)
    forkShouldFail = false;
    await agent.sendMessage("Message 3");
    expect(forkAttemptCount()).toBe(3);

    // Next 3 calls: fork fails again — circuit breaker should NOT trip
    // because the successful compaction reset the counter to 0.
    forkShouldFail = true;
    for (let i = 0; i < 3; i++) {
      await agent.sendMessage(`Message after reset ${i + 1}`);
    }

    // All 3 calls should have attempted the fork (counter was reset)
    expect(forkAttemptCount()).toBe(6);
  });

  // Helper to set up compaction-triggering mocks
  const setupCompactionMocks = () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async (params) => {
      if (isCompactForkCall(params)) {
        return {
          content: "Compacted summary",
          usage: {
            prompt_tokens: 500,
            completion_tokens: 250,
            total_tokens: 750,
          },
        };
      }
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 6000,
        },
      };
    });

    return { mockCallAgent };
  };

  // Helper to get the BackgroundTaskManager from an Agent instance
  const getBackgroundTaskManager = (agent: Agent) => {
    return (
      agent as unknown as {
        backgroundTaskManager: import("@/managers/backgroundTaskManager.js").BackgroundTaskManager;
      }
    ).backgroundTaskManager;
  };

  // Helper to get compact block content from agent messages
  const getCompactBlockContent = (agent: Agent): string => {
    const compactedMessage = agent.messages.find(
      (msg) =>
        msg.role === "assistant" &&
        msg.blocks.some((b) => b.type === "compact"),
    );
    if (!compactedMessage) return "";
    const compactBlock = compactedMessage.blocks.find(
      (b) => b.type === "compact",
    ) as { type: "compact"; content: string };
    return compactBlock?.content || "";
  };

  describe("Background Tasks in Compact Context", () => {
    it("should render killed status with description and id", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_killed_1",
        type: "subagent",
        status: "killed",
        description: "Research API documentation",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("[Background Tasks]");
      expect(compactContent).toContain(
        'Task "Research API documentation" (agent_killed_1) was stopped by the user.',
      );
    });

    it("should render running status with duplicate warning", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_running_1",
        type: "subagent",
        status: "running",
        description: "Generate test fixtures",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("[Background Tasks]");
      expect(compactContent).toContain(
        'Background agent "Generate test fixtures" (agent_running_1) is still running.',
      );
      expect(compactContent).toContain("Do NOT spawn a duplicate.");
      expect(compactContent).toContain(
        "You will be notified when it completes.",
      );
    });

    it("should include outputPath for running tasks", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_running_2",
        type: "subagent",
        status: "running",
        description: "Build assets",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
        outputPath: "/tmp/wave-task-123.log",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain(
        "You can read partial output at /tmp/wave-task-123.log.",
      );
    });

    it("should render completed status with stdout delta", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_completed_1",
        type: "subagent",
        status: "completed",
        description: "Run lint checks",
        startTime: Date.now(),
        stdout: "All files passed linting.",
        stderr: "",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("[Background Tasks]");
      expect(compactContent).toContain(
        "Task agent_completed_1 (status: completed) (description: Run lint checks).",
      );
      expect(compactContent).toContain("Delta: All files passed linting.");
    });

    it("should render failed status with stderr delta", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_failed_1",
        type: "subagent",
        status: "failed",
        description: "Deploy to staging",
        startTime: Date.now(),
        stdout: "",
        stderr: "Connection refused: ECONNREFUSED",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("[Background Tasks]");
      expect(compactContent).toContain(
        "Task agent_failed_1 (status: failed) (description: Deploy to staging).",
      );
      expect(compactContent).toContain(
        "Delta: Connection refused: ECONNREFUSED",
      );
    });

    it("should truncate delta text to 500 characters", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const longStderr = "Error: ".repeat(100); // 700 chars
      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_failed_2",
        type: "subagent",
        status: "failed",
        description: "Long output task",
        startTime: Date.now(),
        stdout: "",
        stderr: longStderr,
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("Delta: ");
      // Find the Delta section and verify it's truncated
      const deltaStart = compactContent.indexOf("Delta: ");
      expect(deltaStart).toBeGreaterThan(-1);
      const afterDelta = compactContent.slice(deltaStart + 7);
      const newlineIdx = afterDelta.indexOf("\n");
      const deltaLine =
        newlineIdx > -1 ? afterDelta.slice(0, newlineIdx) : afterDelta;
      // Should be exactly 500 chars of content + 3 for "..."
      expect(deltaLine.length).toBe(503);
      expect(deltaLine.endsWith("...")).toBe(true);
    });

    it("should include outputPath for completed and failed tasks", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_completed_2",
        type: "subagent",
        status: "completed",
        description: "Completed with output",
        startTime: Date.now(),
        stdout: "Done",
        stderr: "",
        outputPath: "/tmp/completed-task.log",
      });
      btManager.addTask({
        id: "agent_failed_3",
        type: "subagent",
        status: "failed",
        description: "Failed with output",
        startTime: Date.now(),
        stdout: "",
        stderr: "Error occurred",
        outputPath: "/tmp/failed-task.log",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain(
        "Read the output file to retrieve the result: /tmp/completed-task.log.",
      );
      expect(compactContent).toContain(
        "Read the output file to retrieve the result: /tmp/failed-task.log.",
      );
    });

    it("should render multiple agents with mixed statuses", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      btManager.addTask({
        id: "agent_1",
        type: "subagent",
        status: "running",
        description: "Running task",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });
      btManager.addTask({
        id: "agent_2",
        type: "subagent",
        status: "killed",
        description: "Killed task",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });
      btManager.addTask({
        id: "agent_3",
        type: "subagent",
        status: "completed",
        description: "Completed task",
        startTime: Date.now(),
        stdout: "Success",
        stderr: "",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("[Background Tasks]");
      expect(compactContent).toContain(
        'Background agent "Running task" (agent_1) is still running.',
      );
      expect(compactContent).toContain(
        'Task "Killed task" (agent_2) was stopped by the user.',
      );
      expect(compactContent).toContain(
        "Task agent_3 (status: completed) (description: Completed task).",
      );
    });

    it("should exclude shell tasks from background tasks section", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      const btManager = getBackgroundTaskManager(agent);
      // Add a shell task (should be excluded)
      const mockChildProcess = {
        pid: 12345,
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: () => {},
        kill: () => true,
      } as unknown as import("child_process").ChildProcess;
      btManager.addTask({
        id: "shell_1",
        type: "shell",
        status: "running",
        command: "sleep 100",
        process: mockChildProcess,
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });
      // Add a subagent task (should be included)
      btManager.addTask({
        id: "agent_4",
        type: "subagent",
        status: "running",
        description: "Subagent task",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).toContain("Subagent task");
      expect(compactContent).not.toContain("sleep 100");
      expect(compactContent).not.toContain("shell_1");
    });

    it("should not include background tasks section when no agents exist", async () => {
      const messages = generateMessages(8);
      const newUserMessage: Message = {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test" }],
        timestamp: new Date().toISOString(),
      };

      await agent.destroy();
      agent = await Agent.create({
        messages: [...messages, newUserMessage],
      });

      setupCompactionMocks();
      await agent.sendMessage("Test");

      const compactContent = getCompactBlockContent(agent);
      expect(compactContent).not.toContain("[Background Tasks]");
    });
  });
});
