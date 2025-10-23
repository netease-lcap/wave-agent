import { test, expect, vi, afterEach } from "vitest";
import { Agent } from "wave-agent-sdk";

// Mock the Agent SDK
vi.mock("wave-agent-sdk", () => ({
  Agent: {
    create: vi.fn(),
  },
}));

// Mock logger
vi.mock("../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock process.exit
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

// Mock console.error
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

import { startPlainCli } from "../src/plain-cli.js";

test("startPlainCli requires a message when not continuing session", async () => {
  try {
    await startPlainCli({ message: "" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify error message and exit code
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Plain mode requires a message: use --plain 'your message' or -p 'your message'",
  );
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("startPlainCli sends message and exits after completion", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const testMessage = "Hello, how are you?";

  try {
    await startPlainCli({ message: testMessage });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify that the Agent was created
  expect(Agent.create).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: undefined,
    logger: expect.any(Object),
  });

  // Verify that sendMessage was called with the correct message
  expect(mockAgent.sendMessage).toHaveBeenCalledWith(testMessage);

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("onAssistantMessageAdded collects content but doesn't output immediately", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
  };

  interface AgentCallbacks {
    onAssistantMessageAdded?: (content?: string) => void;
  }

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  try {
    await startPlainCli({ message: "test message" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Test the onAssistantMessageAdded callback - it should NOT output immediately
  capturedCallbacks?.onAssistantMessageAdded?.(
    "Hello, this is assistant content!",
  );

  // Verify that console.log was NOT called during the callback
  expect(consoleSpy).not.toHaveBeenCalledWith(
    "Hello, this is assistant content!",
  );

  consoleSpy.mockRestore();
});

test("startPlainCli works with continue session", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  try {
    await startPlainCli({ continueLastSession: true });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify that the Agent was created with continue flag
  expect(Agent.create).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: true,
    logger: expect.any(Object),
  });

  // Verify that sendMessage was NOT called (no message provided)
  expect(mockAgent.sendMessage).not.toHaveBeenCalled();

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("outputs only the last assistant message after sendMessage completes", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
  };

  interface AgentCallbacks {
    onAssistantMessageAdded?: (content?: string) => void;
  }

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

  // Simulate multiple assistant messages during sendMessage
  mockAgent.sendMessage.mockImplementation(async () => {
    // Simulate first assistant message
    capturedCallbacks?.onAssistantMessageAdded?.("First message");
    // Simulate second assistant message
    capturedCallbacks?.onAssistantMessageAdded?.("Second message");
    // Simulate final assistant message
    capturedCallbacks?.onAssistantMessageAdded?.("Final message");
  });

  try {
    await startPlainCli({ message: "test message" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify that only the last message was output
  expect(consoleSpy).toHaveBeenCalledTimes(1);
  expect(consoleSpy).toHaveBeenCalledWith("Final message");

  consoleSpy.mockRestore();
});

afterEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();
  consoleErrorSpy.mockClear();
});
