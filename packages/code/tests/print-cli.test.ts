import { test, expect, vi, afterEach } from "vitest";
import { Agent } from "wave-agent-sdk";

// Mock displayUsageSummary
vi.mock("../src/utils/usageSummary.js", () => ({
  displayUsageSummary: vi.fn(),
}));

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

import { startPrintCli } from "../src/print-cli.js";
import { displayUsageSummary } from "../src/utils/usageSummary.js";

test("startPrintCli requires a message when not continuing session", async () => {
  try {
    await startPrintCli({ message: "" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify error message and exit code
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Print mode requires a message: use --print 'your message' or -p 'your message'",
  );
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("startPrintCli sends message and exits after completion", async () => {
  const mockUsages = [
    {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      model: "gpt-4",
      operation_type: "agent",
    },
  ];
  const mockSessionFilePath = "/path/to/session.json";

  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: mockUsages,
    sessionFilePath: mockSessionFilePath,
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const testMessage = "Hello, how are you?";

  try {
    await startPrintCli({ message: testMessage });
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

  // Verify displayUsageSummary was called with usages and sessionFilePath
  expect(vi.mocked(displayUsageSummary)).toHaveBeenCalledWith(
    mockUsages,
    mockSessionFilePath,
  );

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("onAssistantMessageAdded outputs content", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
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
    await startPrintCli({ message: "test message" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Test the onAssistantMessageAdded callback
  capturedCallbacks?.onAssistantMessageAdded?.(
    "Hello, this is assistant content!",
  );

  // Verify that console.log was called with the content
  expect(consoleSpy).toHaveBeenCalledWith("Hello, this is assistant content!");

  consoleSpy.mockRestore();
});

test("startPrintCli works with continue session", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/continued-session.json",
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  try {
    await startPrintCli({ continueLastSession: true });
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

  // Verify displayUsageSummary was called
  expect(vi.mocked(displayUsageSummary)).toHaveBeenCalledWith(
    [],
    "/mock/continued-session.json",
  );

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli handles usage summary errors gracefully", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    get usages() {
      throw new Error("Usage access error");
    },
    get sessionFilePath() {
      throw new Error("SessionFilePath access error");
    },
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  try {
    await startPrintCli({ message: "test message" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify that displayUsageSummary was NOT called due to error
  expect(vi.mocked(displayUsageSummary)).not.toHaveBeenCalled();

  // Verify agent was still destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli handles sendMessage errors and displays usage summary", async () => {
  const mockUsages = [
    {
      prompt_tokens: 50,
      completion_tokens: 25,
      total_tokens: 75,
      model: "gpt-3.5-turbo",
      operation_type: "agent",
    },
  ];
  const mockSessionFilePath = "/path/to/error-session.json";

  const mockAgent = {
    sendMessage: vi.fn().mockRejectedValue(new Error("Send message failed")),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: mockUsages,
    sessionFilePath: mockSessionFilePath,
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  try {
    await startPrintCli({ message: "test message" });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify error was logged
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Failed to send message:",
    expect.any(Error),
  );

  // Verify displayUsageSummary was called even on error
  expect(vi.mocked(displayUsageSummary)).toHaveBeenCalledWith(
    mockUsages,
    mockSessionFilePath,
  );

  // Verify agent was destroyed and process.exit was called with error code
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(1);

  consoleErrorSpy.mockRestore();
});

afterEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();
  consoleErrorSpy.mockClear();
});
