import { test, expect, vi, afterEach } from "vitest";
import { Agent, AgentCallbacks } from "wave-agent-sdk";

// Mock displayUsageSummary
vi.mock("../src/utils/usageSummary.js");

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock worktree removal so tests never run real git commands
vi.mock("../src/utils/worktree.js", () => ({
  removeWorktree: vi.fn(),
}));

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
import {
  hasUncommittedChanges,
  hasNewCommits,
  validateWorktreeRemovalPath,
} from "wave-agent-sdk";
import { removeWorktree } from "../src/utils/worktree.js";

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
  capturedCallbacks?.onAssistantMessageAdded?.("msg-test-id");

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

test("subagent content callbacks are not registered in print mode", async () => {
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

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  stdoutSpy.mockClear();

  // Subagent callbacks should not be registered in print mode
  expect(capturedCallbacks?.onSubagentAssistantMessageAdded).toBeUndefined();
  expect(capturedCallbacks?.onSubagentAssistantContentUpdated).toBeUndefined();
  expect(
    capturedCallbacks?.onSubagentAssistantReasoningUpdated,
  ).toBeUndefined();
  expect(capturedCallbacks?.onSubagentUserMessageAdded).toBeUndefined();

  // Calling them as undefined should not produce output
  capturedCallbacks?.onSubagentAssistantContentUpdated?.({
    subagentId: "test-subagent-123",
    messageId: "msg-123",
    chunk: "Hello from subagent",
    accumulated: "Hello from subagent",
    stage: "streaming",
  });
  expect(stdoutSpy).not.toHaveBeenCalled();

  // Error callback still works
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
  capturedCallbacks?.onAssistantReasoningUpdated?.({
    messageId: "msg-test-id",
    chunk: "Thinking...",
    accumulated: "Thinking...",
    stage: "streaming",
  });
  expect(stdoutSpy).toHaveBeenCalledWith("\n💭 Reasoning:\n");
  expect(stdoutSpy).toHaveBeenCalledWith("Thinking...");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantReasoningUpdated?.({
    messageId: "msg-test-id",
    chunk: " more thinking",
    accumulated: "Thinking... more thinking",
    stage: "streaming",
  });
  expect(stdoutSpy).not.toHaveBeenCalledWith("\n💭 Reasoning:\n");
  expect(stdoutSpy).toHaveBeenCalledWith(" more thinking");

  // 2. Trigger onAssistantContentUpdated after reasoning and verify the "📝 Response:" header
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantContentUpdated?.({
    messageId: "msg-test-id",
    chunk: "Hello!",
    accumulated: "Hello!",
    stage: "streaming",
  });
  expect(stdoutSpy).toHaveBeenCalledWith("\n\n📝 Response:\n");
  expect(stdoutSpy).toHaveBeenCalledWith("Hello!");

  // Verify header is not printed again
  stdoutSpy.mockClear();
  capturedCallbacks?.onAssistantContentUpdated?.({
    messageId: "msg-test-id",
    chunk: " world",
    accumulated: "Hello! world",
    stage: "streaming",
  });
  expect(stdoutSpy).not.toHaveBeenCalledWith("\n\n📝 Response:\n");
  expect(stdoutSpy).toHaveBeenCalledWith(" world");

  // 3. Subagent callbacks are not registered in print mode
  expect(
    capturedCallbacks?.onSubagentAssistantReasoningUpdated,
  ).toBeUndefined();
  expect(capturedCallbacks?.onSubagentAssistantContentUpdated).toBeUndefined();

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

test("startPrintCli handles non-string message gracefully", async () => {
  await startPrintCli({ message: true as unknown as string });

  // Verify error message and exit code
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("startPrintCli waits for main agent to finish notification turn after background work completes", async () => {
  // Regression: the wait loop previously only checked hasRunningBackgroundWork,
  // which flips false the moment the last background subagent completes — while
  // the main agent is still mid-turn processing the completion notification.
  // With multiple background subagents this race nearly always aborts the
  // main agent's final turn. The loop must also wait for isLoading and queued
  // notifications.
  let isLoading = true;
  let destroyedWhileLoading = false;
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(async () => {
      if (isLoading) destroyedWhileLoading = true;
    }),
    get hasRunningBackgroundWork() {
      return false; // all background tasks already completed
    },
    get isLoading() {
      return isLoading; // main agent still processing notification turn
    },
    get hasPendingMessages() {
      return false;
    },
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  vi.useFakeTimers();
  try {
    const runPromise = startPrintCli({ message: "test" });

    // Advance past one poll tick (500ms). Old code would have exited and
    // destroyed the agent already; new code keeps waiting on isLoading.
    await vi.advanceTimersByTimeAsync(600);
    expect(mockAgent.destroy).not.toHaveBeenCalled();
    expect(destroyedWhileLoading).toBe(false);

    // Main agent finishes its notification turn → safe to destroy and exit.
    isLoading = false;
    await vi.advanceTimersByTimeAsync(600);
    await runPromise;

    expect(destroyedWhileLoading).toBe(false);
    expect(mockAgent.destroy).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(0);
  } finally {
    vi.useRealTimers();
  }
});

test("startPrintCli waits for pending notifications even when main agent is idle", async () => {
  // When a background task completes, its notification is enqueued before the
  // main agent's dispatch picks it up. The wait loop must hold on the queued
  // notification until it is consumed.
  let hasPending = true;
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    get hasRunningBackgroundWork() {
      return false;
    },
    get isLoading() {
      return false;
    },
    get hasPendingMessages() {
      return hasPending;
    },
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  vi.useFakeTimers();
  try {
    const runPromise = startPrintCli({ message: "test" });

    await vi.advanceTimersByTimeAsync(600);
    expect(mockAgent.destroy).not.toHaveBeenCalled();

    hasPending = false;
    await vi.advanceTimersByTimeAsync(600);
    await runPromise;

    expect(mockAgent.destroy).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(0);
  } finally {
    vi.useRealTimers();
  }
});

test("startPrintCli triggers WorktreeRemove hook before destroy and removes clean worktree", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    triggerWorktreeRemoveHook: vi.fn().mockResolvedValue(undefined),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);

  const worktreeSession = {
    name: "feat",
    path: "/repo/.wave/worktrees/feat",
    repoRoot: "/repo",
    branch: "worktree-feat",
    isNew: true,
    hasUncommittedChanges: false,
    hasNewCommits: false,
  };

  await startPrintCli({
    message: "test",
    worktreeSession,
    workdir: "/repo/.wave/worktrees/feat",
    originalCwd: "/repo",
  });

  const hookOrder =
    mockAgent.triggerWorktreeRemoveHook.mock.invocationCallOrder[0];
  const destroyOrder = mockAgent.destroy.mock.invocationCallOrder[0];
  expect(hookOrder).toBeLessThan(destroyOrder);
  expect(mockAgent.triggerWorktreeRemoveHook).toHaveBeenCalledWith(
    "/repo/.wave/worktrees/feat",
  );
  expect(removeWorktree).toHaveBeenCalledWith(worktreeSession);
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli does not trigger hook or remove dirty worktree", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    triggerWorktreeRemoveHook: vi.fn().mockResolvedValue(undefined),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(true);
  vi.mocked(hasNewCommits).mockReturnValue(false);

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await startPrintCli({
    message: "test",
    worktreeSession: {
      name: "feat",
      path: "/repo/.wave/worktrees/feat",
      repoRoot: "/repo",
      branch: "worktree-feat",
      isNew: true,
      hasUncommittedChanges: true,
      hasNewCommits: false,
    },
    workdir: "/repo/.wave/worktrees/feat",
    originalCwd: "/repo",
  });

  expect(mockAgent.triggerWorktreeRemoveHook).not.toHaveBeenCalled();
  expect(removeWorktree).not.toHaveBeenCalled();
  expect(
    stdoutSpy.mock.calls.some((call) =>
      String(call[0]).includes("Keeping it at"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);

  stdoutSpy.mockRestore();
});

test("startPrintCli skips removal when worktree path fails validation", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    triggerWorktreeRemoveHook: vi.fn().mockResolvedValue(undefined),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);
  vi.mocked(validateWorktreeRemovalPath).mockImplementationOnce(() => {
    throw new Error(
      "Refusing to remove worktree outside repo root: /repo/.wave/worktrees/feat",
    );
  });

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await startPrintCli({
    message: "test",
    worktreeSession: {
      name: "feat",
      path: "/repo/.wave/worktrees/feat",
      repoRoot: "/repo",
      branch: "worktree-feat",
      isNew: true,
      hasUncommittedChanges: false,
      hasNewCommits: false,
    },
    workdir: "/repo/.wave/worktrees/feat",
    originalCwd: "/repo",
  });

  // Hook still fired (before destroy); only git removal is skipped
  expect(mockAgent.triggerWorktreeRemoveHook).toHaveBeenCalled();
  expect(removeWorktree).not.toHaveBeenCalled();
  expect(
    stdoutSpy.mock.calls.some((call) =>
      String(call[0]).includes("Skipping worktree removal"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);

  stdoutSpy.mockRestore();
});

test("startPrintCli triggers WorktreeRemove hook before destroy on sendMessage error", async () => {
  const mockAgent = {
    sendMessage: vi.fn().mockRejectedValue(new Error("Send message failed")),
    destroy: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    triggerWorktreeRemoveHook: vi.fn().mockResolvedValue(undefined),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);

  // Suppress the "Failed to send message:" stderr write from the error path
  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  const stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(() => true);

  await startPrintCli({
    message: "test",
    worktreeSession: {
      name: "feat",
      path: "/repo/.wave/worktrees/feat",
      repoRoot: "/repo",
      branch: "worktree-feat",
      isNew: true,
      hasUncommittedChanges: false,
      hasNewCommits: false,
    },
    workdir: "/repo/.wave/worktrees/feat",
    originalCwd: "/repo",
  });

  const hookOrder =
    mockAgent.triggerWorktreeRemoveHook.mock.invocationCallOrder[0];
  const destroyOrder = mockAgent.destroy.mock.invocationCallOrder[0];
  expect(hookOrder).toBeLessThan(destroyOrder);
  expect(mockAgent.triggerWorktreeRemoveHook).toHaveBeenCalledWith(
    "/repo/.wave/worktrees/feat",
  );
  expect(removeWorktree).toHaveBeenCalledTimes(1);
  expect(mockExit).toHaveBeenCalledWith(1);

  consoleErrorSpy.mockRestore();
  stdoutSpy.mockRestore();
});

afterEach(() => {
  vi.clearAllMocks();
  mockExit.mockClear();
  consoleErrorSpy.mockClear();
  stderrWriteSpy.mockClear();
});
