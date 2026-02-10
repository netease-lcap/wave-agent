import { test, expect, vi, afterEach } from "vitest";
import { Agent, AgentCallbacks } from "wave-agent-sdk";

// Mock displayUsageSummary
vi.mock("../src/utils/usageSummary.js");

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock process.exit - use a simple mock that doesn't throw
const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
  // Return undefined to satisfy TypeScript, but the process won't actually exit in tests
  return undefined as never;
});

// Mock console methods to suppress all console output during testing
const consoleErrorSpy = vi
  .spyOn(console, "error")
  .mockImplementation(function () {});

// Mock process.stderr.write to suppress stderr output during testing
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

import { startPrintCli } from "../src/print-cli.js";
import { displayUsageSummary } from "../src/utils/usageSummary.js";

test("startPrintCli requires a message when not continuing session", async () => {
  await startPrintCli({ message: "" });

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

  await startPrintCli({ message: testMessage, showStats: true });

  // Verify that the Agent was created
  expect(vi.mocked(Agent.create)).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: undefined,
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

test("onAssistantMessageAdded outputs newline", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  interface AgentCallbacks {
    onAssistantMessageAdded?: () => void;
    onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  }

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await startPrintCli({ message: "test message" });

  // Test the onAssistantMessageAdded callback
  capturedCallbacks?.onAssistantMessageAdded?.();

  // Verify that process.stdout.write was called with newline
  expect(stdoutSpy).toHaveBeenCalledWith("\n");

  stdoutSpy.mockRestore();
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
    await startPrintCli({ continueLastSession: true, showStats: true });
  } catch (error) {
    // Expected when process.exit is called
    expect(String(error)).toContain("process.exit called");
  }

  // Verify that the Agent was created with continue flag
  expect(vi.mocked(Agent.create)).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: true,
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

  await startPrintCli({ message: "test message" });

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

  await startPrintCli({ message: "test message", showStats: true });

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

test("subagent content callbacks output correctly", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  let capturedCallbacks:
    | Record<string, (...args: unknown[]) => void>
    | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks as Record<
      string,
      (...args: unknown[]) => void
    >;
    return mockAgent as unknown as Agent;
  });

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  // Mock console.error to suppress stderr output
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  // Test onSubagentAssistantMessageAdded callback (starts subagent response)
  capturedCallbacks?.onSubagentAssistantMessageAdded?.("test-subagent-123");
  expect(stdoutSpy).toHaveBeenCalledWith("\n   ");

  // Test onSubagentAssistantContentUpdated callback (streams subagent content)
  capturedCallbacks?.onSubagentAssistantContentUpdated?.(
    "test-subagent-123",
    "Hello from subagent",
    "Hello from subagent",
  );
  expect(stdoutSpy).toHaveBeenCalledWith("Hello from subagent");

  // Test onSubAgentBlockAdded callback
  capturedCallbacks?.onSubAgentBlockAdded?.("test-subagent-123", {
    subagent_type: "typescript-expert",
    description: "Fix TypeScript errors",
  });
  expect(stdoutSpy).toHaveBeenCalledWith(
    "\n🤖 Subagent [typescript-expert]: Fix TypeScript errors\n",
  );

  // Test onSubAgentBlockUpdated callback with different statuses
  capturedCallbacks?.onSubAgentBlockUpdated?.("test-subagent-123", "active");
  expect(stdoutSpy).toHaveBeenCalledWith("   🔄 Subagent status: active\n");

  capturedCallbacks?.onSubAgentBlockUpdated?.("test-subagent-123", "completed");
  expect(stdoutSpy).toHaveBeenCalledWith("   ✅ Subagent status: completed\n");

  capturedCallbacks?.onSubAgentBlockUpdated?.("test-subagent-123", "error");
  expect(stdoutSpy).toHaveBeenCalledWith("   ❌ Subagent status: error\n");

  capturedCallbacks?.onSubAgentBlockUpdated?.("test-subagent-123", "aborted");
  expect(stdoutSpy).toHaveBeenCalledWith("   ⚠️ Subagent status: aborted\n");

  // Test onSubagentUserMessageAdded callback
  capturedCallbacks?.onSubagentUserMessageAdded?.("test-subagent-123", {
    content: "Please fix this code",
  });
  expect(stdoutSpy).toHaveBeenCalledWith(
    "\n   👤 User: Please fix this code\n",
  );

  // Test onErrorBlockAdded callback
  capturedCallbacks?.onErrorBlockAdded?.("Something went wrong");
  expect(stdoutSpy).toHaveBeenCalledWith("\n❌ Error: Something went wrong\n");

  stdoutSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

test("tool name printing during running stage", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  let capturedCallbacks:
    | Record<string, (...args: unknown[]) => void>
    | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks as Record<
      string,
      (...args: unknown[]) => void
    >;
    return mockAgent as unknown as Agent;
  });

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  // Mock console.error to suppress stderr output during testing
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  // Clear stdout spy after initialization to focus on callback testing
  stdoutSpy.mockClear();

  // Test onToolBlockUpdated callback - 'running' stage should print tool name
  capturedCallbacks?.onToolBlockUpdated?.({
    stage: "running",
    name: "Read",
    id: "call_123",
    parameters: "",
    parametersChunk: "",
  });
  expect(stdoutSpy).toHaveBeenCalledWith("\n🔧 Read");
  expect(stdoutSpy).toHaveBeenCalledWith("\n");

  // Test second call to same tool name but different ID - should print again since it's a separate tool call
  capturedCallbacks?.onToolBlockUpdated?.({
    stage: "running",
    name: "Read",
    id: "call_456",
    parameters: "",
    parametersChunk: "",
  });
  expect(stdoutSpy).toHaveBeenCalledWith("\n🔧 Read");
  expect(stdoutSpy).toHaveBeenCalledWith("\n");

  // Verify both Read tool calls were made (each produces 2 stdout calls)
  const readToolCalls = stdoutSpy.mock.calls.filter(
    (call) => call[0] === "\n🔧 Read",
  );
  expect(readToolCalls).toHaveLength(2);

  // Test different tool - should print
  capturedCallbacks?.onToolBlockUpdated?.({
    stage: "running",
    name: "Write",
    id: "call_789",
    parameters: "",
    parametersChunk: "",
  });
  expect(stdoutSpy).toHaveBeenCalledWith("\n🔧 Write");
  expect(stdoutSpy).toHaveBeenCalledWith("\n");

  // Test tool without name - should not print anything
  const callCountBeforeNoName = stdoutSpy.mock.calls.length;
  capturedCallbacks?.onToolBlockUpdated?.({
    stage: "running",
    name: undefined,
    id: "call_no_name",
    parameters: "",
    parametersChunk: "",
  });
  const callCountAfterNoName = stdoutSpy.mock.calls.length;
  expect(callCountAfterNoName).toBe(callCountBeforeNoName);

  // Test non-running stage - should not print
  const callCountBeforeStart = stdoutSpy.mock.calls.length;
  capturedCallbacks?.onToolBlockUpdated?.({
    stage: "start",
    name: "Edit",
    id: "call_start",
    parameters: "",
    parametersChunk: "",
  });
  const callCountAfterStart = stdoutSpy.mock.calls.length;
  expect(callCountAfterStart).toBe(callCountBeforeStart);

  stdoutSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

test("reasoning callbacks output correctly", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await startPrintCli({ message: "test message" });

  // 1. Trigger onAssistantReasoningUpdated and verify the output
  capturedCallbacks?.onAssistantReasoningUpdated?.(
    "Thinking...",
    "Thinking...",
  );
  expect(stdoutSpy).toHaveBeenCalledWith("💭 Reasoning:\n");
  expect(stdoutSpy).toHaveBeenCalledWith("Thinking...");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantReasoningUpdated?.(
    " more thinking",
    "Thinking... more thinking",
  );
  expect(stdoutSpy).not.toHaveBeenCalledWith("💭 Reasoning:\n");
  expect(stdoutSpy).toHaveBeenCalledWith(" more thinking");

  // 2. Trigger onAssistantContentUpdated after reasoning and verify the "📝 Response:" header
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantContentUpdated?.("Hello!", "Hello!");
  expect(stdoutSpy).toHaveBeenCalledWith("\n\n📝 Response:\n");
  expect(stdoutSpy).toHaveBeenCalledWith("Hello!");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantContentUpdated?.(" world", "Hello! world");
  expect(stdoutSpy).not.toHaveBeenCalledWith("\n\n📝 Response:\n");
  expect(stdoutSpy).toHaveBeenCalledWith(" world");

  // 3. Trigger onSubagentAssistantReasoningUpdated and verify the output
  stdoutSpy.mockClear();
  capturedCallbacks?.onSubagentAssistantReasoningUpdated?.(
    "sub-1",
    "Sub thinking...",
    "Sub thinking...",
  );
  expect(stdoutSpy).toHaveBeenCalledWith("💭 Reasoning: ");
  expect(stdoutSpy).toHaveBeenCalledWith("Sub thinking...");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onSubagentAssistantReasoningUpdated?.(
    "sub-1",
    " more sub thinking",
    "Sub thinking... more sub thinking",
  );
  expect(stdoutSpy).not.toHaveBeenCalledWith("💭 Reasoning: ");
  expect(stdoutSpy).toHaveBeenCalledWith(" more sub thinking");

  // 4. Trigger onSubagentAssistantContentUpdated after subagent reasoning and verify the "📝 Response:" header
  stdoutSpy.mockClear();
  capturedCallbacks?.onSubagentAssistantContentUpdated?.(
    "sub-1",
    "Sub hello!",
    "Sub hello!",
  );
  expect(stdoutSpy).toHaveBeenCalledWith("\n   📝 Response: ");
  expect(stdoutSpy).toHaveBeenCalledWith("Sub hello!");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onSubagentAssistantContentUpdated?.(
    "sub-1",
    " world",
    "Sub hello! world",
  );
  expect(stdoutSpy).not.toHaveBeenCalledWith("\n   📝 Response: ");
  expect(stdoutSpy).toHaveBeenCalledWith(" world");

  stdoutSpy.mockRestore();
});

test("startPrintCli does not display stats by default", async () => {
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

  // Suppress stderr output for this specific test
  const originalStderr = process.stderr.write;
  process.stderr.write = vi.fn().mockReturnValue(true);

  await startPrintCli({ message: testMessage }); // No showStats parameter

  // Restore stderr
  process.stderr.write = originalStderr;

  // Verify that the Agent was created
  expect(vi.mocked(Agent.create)).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: undefined,
  });

  // Verify that sendMessage was called with the correct message
  expect(mockAgent.sendMessage).toHaveBeenCalledWith(testMessage);

  // Verify displayUsageSummary was NOT called when showStats is not provided
  expect(vi.mocked(displayUsageSummary)).not.toHaveBeenCalled();

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

afterEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();
  consoleErrorSpy.mockClear();
  stderrWriteSpy.mockClear();
});
