import { test, expect, vi, afterEach } from "vitest";
import {
  Agent,
  AgentCallbacks,
  describeWorktreeRemovalOutcome,
} from "wave-agent-sdk";

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// The one exception is the worktree-survival wording: it is pure text with no
// side effects, and the assertions below read the exact words a user is told —
// the automocked stub returns `undefined`, so it would check nothing.
const realSdk =
  await vi.importActual<typeof import("wave-agent-sdk")>("wave-agent-sdk");
vi.mocked(describeWorktreeRemovalOutcome).mockImplementation(
  realSdk.describeWorktreeRemovalOutcome,
);

// Mock worktree removal so tests never run real git commands. The survival
// wording is pure text with no side effects, so it stays real — stubbing it
// would let the output assertions below pass without checking anything.
vi.mock("../src/utils/worktree.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/utils/worktree.js")>();
  return { ...actual, removeWorktree: vi.fn() };
});

// Piped stdin is stubbed for the whole file: the real helper attaches to
// process.stdin, which in a test run is a TTY or a pipe that never delivers —
// either way it would put the 3s peek in front of every case here. The reading
// itself is covered by tests/stdin.test.ts.
vi.mock("../src/utils/stdin.js", () => ({
  readPipedStdin: vi.fn(async () => ""),
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

// Same for stdout: every format writes the answer (or `Execution error`) once
// at the end, so without this the suite prints them between test names.
// `captureStdout()` flips the collection on for the test that needs the bytes.
// The write callback always fires — `startPrintCli` awaits it before exiting.
let capturingStdout = false;
const stdoutChunks: string[] = [];
const stdoutWriteSpy = vi.spyOn(process.stdout, "write").mockImplementation(((
  chunk: string | Uint8Array,
  encodingOrCb?: BufferEncoding | ((err?: Error) => void),
  cb?: (err?: Error) => void,
) => {
  if (capturingStdout && typeof chunk === "string" && chunk !== "") {
    stdoutChunks.push(chunk);
  }
  const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
  callback?.();
  return true;
}) as unknown as typeof process.stdout.write);

import { startPrintCli } from "../src/print-cli.js";
import {
  hasUncommittedChanges,
  hasNewCommits,
  validateWorktreeRemovalPath,
} from "wave-agent-sdk";
import { removeWorktree } from "../src/utils/worktree.js";
import { readPipedStdin } from "../src/utils/stdin.js";

test("startPrintCli requires a message when not continuing session", async () => {
  await startPrintCli({ message: "" });

  // Verify error message and exit code
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Print mode requires a message: use --print 'your message' or -p 'your message'",
  );
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("a piped stdin becomes the prompt when -p carries no value", async () => {
  vi.mocked(readPipedStdin).mockResolvedValue("只回复两个字：收到");
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  await startPrintCli({ message: "" });

  expect(mockAgent.sendMessage).toHaveBeenCalledWith("只回复两个字：收到");
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("a piped stdin is appended to the -p value, like claude -p", async () => {
  vi.mocked(readPipedStdin).mockResolvedValue("## 规格正文\n\n第一段");
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  await startPrintCli({ message: "帮我审查这份规格" });

  expect(mockAgent.sendMessage).toHaveBeenCalledWith(
    "帮我审查这份规格\n## 规格正文\n\n第一段",
  );
});

test("an empty -p value plus an empty stdin still fails loudly", async () => {
  vi.mocked(readPipedStdin).mockResolvedValue("  ");

  await startPrintCli({ message: "" });

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
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: mockUsages,
    sessionFilePath: mockSessionFilePath,
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const testMessage = "Hello, how are you?";

  await startPrintCli({ message: testMessage });

  // Verify that the Agent was created
  expect(vi.mocked(Agent.create)).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: undefined,
    entrypoint: "cli",
  });

  // Verify that sendMessage was called with the correct message
  expect(mockAgent.sendMessage).toHaveBeenCalledWith(testMessage);

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("onAssistantMessageAdded writes nothing to stdout", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const stdout = captureStdout();

  try {
    await startPrintCli({ message: "test message" });

    // The run itself ended with an empty answer on stdout; reset before the
    // callback so this only observes what the callback does.
    stdout.chunks.length = 0;
    capturedCallbacks?.onAssistantMessageAdded?.("msg-test-id");

    // Headers and spacing are gone: the answer is written once, at the end.
    expect(stdout.chunks).toEqual([]);
  } finally {
    stdout.restore();
  }
});

test("startPrintCli works with continue session", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
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
  expect(vi.mocked(Agent.create)).toHaveBeenCalledWith({
    callbacks: expect.any(Object),
    restoreSessionId: undefined,
    continueLastSession: true,
    entrypoint: "cli",
  });

  // Verify that sendMessage was NOT called (no message provided)
  expect(mockAgent.sendMessage).not.toHaveBeenCalled();

  // Verify agent was destroyed and process.exit was called
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli handles usage summary errors gracefully", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
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
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: mockUsages,
    sessionFilePath: mockSessionFilePath,
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  // Verify error was logged
  expect(consoleErrorSpy).toHaveBeenCalledWith(
    "Failed to send message:",
    expect.any(Error),
  );

  // Verify agent was destroyed and process.exit was called with error code
  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(mockExit).toHaveBeenCalledWith(1);

  consoleErrorSpy.mockRestore();
});

test("startPrintCli drains the auto-memory extraction before destroying the agent", async () => {
  // print mode is the one exit path that has to wait for the extraction fork:
  // the process is about to exit, so nothing else lets it finish. Order
  // matters — destroy() tears down the agent the drain is waiting on.
  const order: string[] = [];
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(async () => {
      order.push("destroy");
    }),
    drainAutoMemory: vi.fn(async () => {
      order.push("drainAutoMemory");
    }),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  await startPrintCli({ message: "test message" });

  expect(order).toEqual(["drainAutoMemory", "destroy"]);
  // No explicit budget: the SDK default (60s soft timeout) applies.
  expect(mockAgent.drainAutoMemory).toHaveBeenCalledWith();
});

test("startPrintCli drains before destroying on the error path too", async () => {
  // A failed run can still have left an extraction in flight — the ordering is
  // the same as the success path.
  const order: string[] = [];
  const mockAgent = {
    sendMessage: vi.fn().mockRejectedValue(new Error("Send message failed")),
    destroy: vi.fn(async () => {
      order.push("destroy");
    }),
    drainAutoMemory: vi.fn(async () => {
      order.push("drainAutoMemory");
    }),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  expect(order).toEqual(["drainAutoMemory", "destroy"]);

  consoleErrorSpy.mockRestore();
});

test("subagent content callbacks are not registered in print mode", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
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

  const stdout = captureStdout();
  stderrWriteSpy.mockClear();

  const consoleErrorSpy = vi
    .spyOn(console, "error")
    .mockImplementation(() => {});

  await startPrintCli({ message: "test message" });

  stdout.chunks.length = 0;
  stderrWriteSpy.mockClear();

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
    stage: "streaming",
  });
  expect(stdout.chunks).toEqual([]);

  // Error callback still works — on stderr, never on stdout.
  capturedCallbacks?.onNoticeAdded?.({
    level: "error",
    content: "Something went wrong",
  });
  expect(stderrWriteSpy).toHaveBeenCalledWith(
    "\n❌ Error: Something went wrong\n",
  );
  expect(stdout.chunks).toEqual([]);

  stdout.restore();
  consoleErrorSpy.mockRestore();
});

test("工具调用与推理都不打印：只记进 tool_calls / 事件", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };

  let capturedCallbacks: AgentCallbacks | undefined;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    capturedCallbacks = options.callbacks;
    return mockAgent as unknown as Agent;
  });

  const stdout = captureStdout();
  try {
    await startPrintCli({ message: "test message" });
  } finally {
    stdout.restore();
  }

  // 空答案：收尾时写过一次，之后不该再有 stdout 写
  stdout.chunks.length = 0;
  stderrWriteSpy.mockClear();

  capturedCallbacks?.onToolBlockUpdated?.({
    messageId: "msg-test-id",
    stage: "running",
    name: "Read",
    id: "call_123",
    parameters: "",
    parametersChunk: "",
  });
  capturedCallbacks?.onToolBlockUpdated?.({
    messageId: "msg-test-id",
    stage: "end",
    name: "Read",
    id: "call_123",
    success: true,
  });
  capturedCallbacks?.onAssistantReasoningUpdated?.({
    messageId: "msg-test-id",
    chunk: "Thinking...",
    stage: "streaming",
  });
  capturedCallbacks?.onAssistantContentUpdated?.({
    messageId: "msg-test-id",
    chunk: "Hello!",
    stage: "streaming",
  });

  // 过程信息一个字都不打印，与 Claude Code 的 print 模式一致
  expect(stdout.chunks).toEqual([]);
  expect(stderrWriteSpy).not.toHaveBeenCalled();
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
    drainAutoMemory: vi.fn(),
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
    drainAutoMemory: vi.fn(),
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

test("startPrintCli removes clean worktree after destroy", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);
  // The removal actually happened, so "Done." is the honest line.
  vi.mocked(removeWorktree).mockResolvedValueOnce(true);

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

  const destroyOrder = mockAgent.destroy.mock.invocationCallOrder[0];
  const removeOrder = vi.mocked(removeWorktree).mock.invocationCallOrder[0];
  expect(destroyOrder).toBeLessThan(removeOrder);
  expect(removeWorktree).toHaveBeenCalledWith(worktreeSession);
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("Deleting worktree ..."),
    ),
  ).toBe(true);
  expect(
    stderrWriteSpy.mock.calls.some((call) => String(call[0]).includes("Done.")),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli reports a surviving worktree instead of claiming success", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);
  // Removal is best-effort: the directory (and its branch, kept on purpose) is
  // still there, so "Done." would be a lie — issue #2763.
  vi.mocked(removeWorktree).mockResolvedValueOnce(false);

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

  const out = stderrWriteSpy.mock.calls.map((call) => String(call[0])).join("");
  expect(out).toContain(
    "Worktree directory survived at /repo/.wave/worktrees/feat",
  );
  expect(out).toContain("git -C /repo branch -D worktree-feat");
  expect(out).not.toContain("Done.");
  // Print mode's own exit code reports the run, not the cleanup.
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli keeps dirty worktree with a warning", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(true);
  vi.mocked(hasNewCommits).mockReturnValue(false);

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

  expect(removeWorktree).not.toHaveBeenCalled();
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("Keeping it at"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli skips removal when worktree path fails validation", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
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

  expect(removeWorktree).not.toHaveBeenCalled();
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("Skipping worktree removal"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli skips path validation and delegates removal for hook-based worktrees", async () => {
  const mockAgent = {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
    usages: [],
    sessionFilePath: "/mock/session.json",
  };
  vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  vi.mocked(hasUncommittedChanges).mockReturnValue(false);
  vi.mocked(hasNewCommits).mockReturnValue(false);
  // The hook did its job, so this case keeps the plain success line.
  vi.mocked(removeWorktree).mockResolvedValueOnce(true);

  const hookBasedSession = {
    name: "feat",
    path: "/custom/vcs/feat",
    repoRoot: "/repo",
    branch: "",
    isNew: true,
    hookBased: true,
    hasUncommittedChanges: false,
    hasNewCommits: false,
  };

  await startPrintCli({
    message: "test",
    worktreeSession: hookBasedSession,
    workdir: "/custom/vcs/feat",
    originalCwd: "/repo",
  });

  // Hook-based worktrees are owned by the hook; git-root containment
  // validation does not apply, and removal is delegated to removeWorktree.
  expect(validateWorktreeRemovalPath).not.toHaveBeenCalled();
  expect(removeWorktree).toHaveBeenCalledWith(hookBasedSession);
  expect(
    stderrWriteSpy.mock.calls.some((call) => String(call[0]).includes("Done.")),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("startPrintCli removes clean worktree after destroy on sendMessage error", async () => {
  const mockAgent = {
    sendMessage: vi.fn().mockRejectedValue(new Error("Send message failed")),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    abortMessage: vi.fn(),
    setWorktreeSession: vi.fn(),
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
  vi.mocked(removeWorktree).mockResolvedValueOnce(true);

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

  const destroyOrder = mockAgent.destroy.mock.invocationCallOrder[0];
  const removeOrder = vi.mocked(removeWorktree).mock.invocationCallOrder[0];
  expect(destroyOrder).toBeLessThan(removeOrder);
  expect(removeWorktree).toHaveBeenCalledTimes(1);
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("Deleting worktree ..."),
    ),
  ).toBe(true);
  expect(
    stderrWriteSpy.mock.calls.some((call) => String(call[0]).includes("Done.")),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(1);

  consoleErrorSpy.mockRestore();
});

/**
 * Structured modes read like a pipe: capture what reaches stdout from here on.
 */
function captureStdout(): { chunks: string[]; restore: () => void } {
  stdoutChunks.length = 0;
  capturingStdout = true;
  return {
    chunks: stdoutChunks,
    restore: () => {
      capturingStdout = false;
    },
  };
}

function structuredAgent(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sendMessage: vi.fn(),
    destroy: vi.fn(),
    drainAutoMemory: vi.fn(),
    sessionId: "session-1",
    usages: [
      {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
        model: "gpt-4",
        operation_type: "agent",
      },
    ],
    sessionFilePath: "/mock/session.json",
    currentWorkdir: "/repo",
    getModelConfig: () => ({ model: "gpt-4" }),
    getPermissionMode: () => "default",
    getAvailableToolNames: () => ["Bash", "Read"],
    ...overrides,
  };
}

test("--output-format json 在 stdout 上只留一条 envelope", async () => {
  let callbacks: AgentCallbacks | undefined;
  const agent = structuredAgent({
    sendMessage: vi.fn(async () => {
      callbacks?.onAssistantMessageAdded?.("msg-1");
      callbacks?.onAssistantContentUpdated?.({
        messageId: "msg-1",
        chunk: "最终答案",
        stage: "streaming",
      });
      callbacks?.onToolBlockUpdated?.({
        messageId: "msg-1",
        id: "call-1",
        name: "Read",
        stage: "running",
        parameters: JSON.stringify({ file_path: "a.ts" }),
      });
      callbacks?.onToolBlockUpdated?.({
        messageId: "msg-1",
        id: "call-1",
        name: "Read",
        stage: "end",
        success: true,
      });
    }),
  });
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return agent as unknown as Agent;
  });
  const stdout = captureStdout();

  try {
    await startPrintCli({ message: "test", outputFormat: "json" });
  } finally {
    stdout.restore();
  }

  const lines = stdout.chunks.join("").split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  const envelope = JSON.parse(lines[0]);
  expect(envelope.type).toBe("result");
  expect(envelope.subtype).toBe("success");
  expect(envelope.is_error).toBe(false);
  expect(envelope.result).toBe("最终答案");
  expect(envelope.session_id).toBe("session-1");
  expect(envelope.num_turns).toBe(1);
  expect(envelope.usage.total_tokens).toBe(15);
  expect(envelope.tool_calls).toEqual([
    {
      id: "call-1",
      name: "Read",
      input: { file_path: "a.ts" },
      success: true,
    },
  ]);
  // 人读输出（emoji 行、响应标题）一律不出现
  expect(stdout.chunks.join("")).not.toContain("🔧");
  expect(stdout.chunks.join("")).not.toContain("📝");
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("--output-format stream-json：init 开头、result 收尾", async () => {
  let callbacks: AgentCallbacks | undefined;
  const agent = structuredAgent({
    sendMessage: vi.fn(async () => {
      callbacks?.onAssistantMessageAdded?.("msg-1");
      callbacks?.onAssistantContentUpdated?.({
        messageId: "msg-1",
        chunk: "答案",
        stage: "streaming",
      });
    }),
  });
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return agent as unknown as Agent;
  });
  const stdout = captureStdout();

  try {
    await startPrintCli({ message: "test", outputFormat: "stream-json" });
  } finally {
    stdout.restore();
  }

  const events = stdout.chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  expect(events[0]).toMatchObject({
    type: "system",
    subtype: "init",
    session_id: "session-1",
    model: "gpt-4",
    cwd: "/repo",
    permission_mode: "default",
  });
  expect(events[1]).toMatchObject({
    type: "assistant",
    subtype: "content_delta",
    delta: "答案",
  });
  expect(events[events.length - 1]).toMatchObject({
    type: "result",
    subtype: "success",
    result: "答案",
  });
});

test("--output-format json 运行失败时仍输出 envelope 并退出 1", async () => {
  const agent = structuredAgent({
    sendMessage: vi.fn().mockRejectedValue(new Error("Send message failed")),
  });
  vi.mocked(Agent.create).mockResolvedValue(agent as unknown as Agent);
  const stdout = captureStdout();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    await startPrintCli({ message: "test", outputFormat: "json" });
  } finally {
    stdout.restore();
    errorSpy.mockRestore();
  }

  const lines = stdout.chunks.join("").split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  const envelope = JSON.parse(lines[0]);
  expect(envelope.subtype).toBe("error_during_execution");
  expect(envelope.is_error).toBe(true);
  expect(envelope.result).toBeUndefined();
  expect(envelope.errors).toEqual(["Send message failed"]);
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("模型请求失败（只落错误块、不抛错）按运行失败收尾", async () => {
  // 真机实测：模型未启用时 sendMessage 正常 resolve，错误只作为错误块到达。
  // 没有正文却报「成功」会让 CI 门禁静默放行，所以信封与退出码都按失败给。
  let callbacks: AgentCallbacks | undefined;
  const agent = structuredAgent({
    sendMessage: vi.fn(async () => {
      callbacks?.onNoticeAdded?.({
        level: "error",
        content: "HTTP 400 Bad Request: MODEL_NOT_ENABLED",
      });
    }),
  });
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return agent as unknown as Agent;
  });
  const stdout = captureStdout();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  try {
    await startPrintCli({ message: "test", outputFormat: "json" });
  } finally {
    stdout.restore();
    errorSpy.mockRestore();
  }

  const lines = stdout.chunks.join("").split("\n").filter(Boolean);
  expect(lines).toHaveLength(1);
  const envelope = JSON.parse(lines[0]);
  expect(envelope.subtype).toBe("error_during_execution");
  expect(envelope.is_error).toBe(true);
  expect(envelope.result).toBeUndefined();
  expect(envelope.errors).toEqual(["HTTP 400 Bad Request: MODEL_NOT_ENABLED"]);
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("--output-format text（默认）：stdout 只有最终答案，过程信息完全不打印", async () => {
  let callbacks: AgentCallbacks | undefined;
  const agent = structuredAgent({
    sendMessage: vi.fn(async () => {
      callbacks?.onAssistantMessageAdded?.("msg-1");
      callbacks?.onAssistantReasoningUpdated?.({
        messageId: "msg-1",
        chunk: "先想一想",
        stage: "streaming",
      });
      callbacks?.onAssistantContentUpdated?.({
        messageId: "msg-1",
        chunk: "最终答案",
        stage: "streaming",
      });
      callbacks?.onToolBlockUpdated?.({
        messageId: "msg-1",
        id: "call-1",
        name: "Read",
        stage: "running",
        parameters: JSON.stringify({ file_path: "a.ts" }),
      });
      callbacks?.onToolBlockUpdated?.({
        messageId: "msg-1",
        id: "call-1",
        name: "Read",
        stage: "end",
        success: true,
      });
    }),
  });
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return agent as unknown as Agent;
  });
  const stdout = captureStdout();
  stderrWriteSpy.mockClear();

  try {
    await startPrintCli({ message: "test" });
  } finally {
    stdout.restore();
  }

  // 一次写入、只有答案：脚本可以直接整段消费
  expect(stdout.chunks.join("")).toBe("最终答案\n");
  // 过程信息一个字都不输出（stderr 上也没有），与 Claude Code 一致
  const stderr = stderrWriteSpy.mock.calls
    .map((call) => String(call[0]))
    .join("");
  expect(stderr).not.toContain("💭");
  expect(stderr).not.toContain("🔧");
  expect(stderr).not.toContain("📝");
  expect(mockExit).toHaveBeenCalledWith(0);
});

test("--output-format text：运行失败时 stdout 只有 Execution error（不带换行）", async () => {
  let callbacks: AgentCallbacks | undefined;
  const agent = structuredAgent({
    sendMessage: vi.fn(async () => {
      // 请求级失败只落错误块、不抛错：模型不可用 / 鉴权被拒
      callbacks?.onNoticeAdded?.({
        level: "error",
        content: "HTTP 400 Bad Request: MODEL_NOT_ENABLED",
      });
    }),
  });
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks;
    return agent as unknown as Agent;
  });
  const stdout = captureStdout();
  stderrWriteSpy.mockClear();

  try {
    await startPrintCli({ message: "test" });
  } finally {
    stdout.restore();
  }

  expect(stdout.chunks.join("")).toBe("Execution error");
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("MODEL_NOT_ENABLED"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(1);
});

test("--output-format text：会话恢复失败（运行没起来）时 stdout 一个字节都没有", async () => {
  // Claude Code 的 `emitLoadError`：加载期失败只写 stderr，stdout 保持空
  vi.mocked(Agent.create).mockRejectedValue(
    new Error("Failed to load session x: Invalid session ID format"),
  );
  // 上一个测试 restore 过 console.error，这里自备一个，别让它打到真实 stderr
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const stdout = captureStdout();
  stderrWriteSpy.mockClear();

  try {
    await startPrintCli({ message: "test", restoreSessionId: "not-a-uuid" });
  } finally {
    stdout.restore();
    consoleError.mockRestore();
  }

  expect(stdout.chunks).toEqual([]);
  expect(
    stderrWriteSpy.mock.calls.some((call) =>
      String(call[0]).includes("Invalid session ID format"),
    ),
  ).toBe(true);
  expect(mockExit).toHaveBeenCalledWith(1);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.mocked(readPipedStdin).mockResolvedValue("");
  mockExit.mockClear();
  consoleErrorSpy.mockClear();
  stderrWriteSpy.mockClear();
  stdoutWriteSpy.mockClear();
  capturingStdout = false;
  stdoutChunks.length = 0;
});
