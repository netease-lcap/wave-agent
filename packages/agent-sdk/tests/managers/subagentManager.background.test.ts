import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { Container } from "../../src/utils/container.js";
import { logWarn } from "../../src/utils/globalLogger.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/backgroundTaskManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockResolvedValue("Test response"),
      abortAIMessage: vi.fn(),
    };
  }),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

// `logStream.write` flushes asynchronously, so a log file can exist while its
// content is still buffered. vi.waitFor defaults to a 1000ms timeout, which is
// tight on slow IO (Windows CI + Defender scanning), so give the flush a wider
// window instead of sleeping a fixed amount. Kept below vitest's 5000ms per-test
// timeout so a genuine failure reports the assertion instead of a test timeout.
const LOG_FLUSH_TIMEOUT_MS = 3000;

// SubagentManager opens its background log stream with `fs.createWriteStream`
// and two tests below abandon one mid-open: releaseInstance() destroys the
// stream before Node's open callback has run. That open is already in flight on
// the libuv threadpool, so the file is created anyway, and the stream's 'close'
// event only fires once that open has landed. afterAll waits for those 'close'
// events before removing the directory; this is the cap on that wait so a
// stream that never settles cannot hang the suite.
const LOG_STREAM_CLOSE_TIMEOUT_MS = 2000;

// SubagentManager writes its background log to
// `path.join(os.tmpdir(), `wave-subagent-${taskId}.log`)` opened with
// `flags: "a"`. BackgroundTaskManager is mocked here, so its ids are constants
// (`task_1`, `task_123`, …) and that path is byte-identical on every run: any
// content left behind by an earlier run is still there when this run asserts on
// the file, and would satisfy the assertions below even if the code under test
// stopped writing entirely. Point os.tmpdir() at a directory unique to this run
// so leftovers cannot exist — with it, dropping a real write turns these tests
// red instead of green.
const ISOLATED_TMP_DIR = path.join(
  os.tmpdir(),
  `wave-subagent-log-test-${process.pid}-${Date.now()}`,
);
fs.mkdirSync(ISOLATED_TMP_DIR, { recursive: true });
vi.spyOn(os, "tmpdir").mockReturnValue(ISOLATED_TMP_DIR);

// Record every stream the code under test opens so afterAll can wait for their
// pending opens to land before it removes the directory (see afterAll below).
// `vi.spyOn(fs, "createWriteStream")` cannot do it: vitest's ESM interop exposes
// the `fs` bindings as non-configurable ("Cannot spy on export ... Module
// namespace is not configurable in ESM"), so the module is mocked instead and
// everything is forwarded to the real `fs` except for a `createWriteStream`
// wrapper. The list lives in `vi.hoisted` because the factory runs while the
// imports above are still being resolved.
const { logStreams } = vi.hoisted(() => ({
  logStreams: [] as fs.WriteStream[],
}));
vi.mock("fs", async (importOriginal) => {
  const real = await importOriginal<typeof fs>();
  return {
    ...real,
    default: real,
    createWriteStream: ((
      ...args: Parameters<typeof real.createWriteStream>
    ) => {
      const stream = real.createWriteStream(...args);
      logStreams.push(stream);
      return stream;
    }) as typeof real.createWriteStream,
  };
});

describe("SubagentManager - Backgrounding Coverage", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let mockBackgroundTaskManager: BackgroundTaskManager;
  let container: Container;
  let taskIdCounter = 0;

  const testConfig: SubagentConfiguration = {
    name: "TestAgent",
    description: "Test agent",
    systemPrompt: "System prompt",
    tools: ["Read"],
    model: "inherit",
    filePath: "/test/agent.md",
    scope: "user",
    priority: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    mockBackgroundTaskManager = {
      generateId: vi.fn().mockImplementation(() => `task_${++taskIdCounter}`),
      addTask: vi.fn(),
      getTask: vi.fn(),
      notifyTasksChange: vi.fn(),
    } as unknown as BackgroundTaskManager;

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    container = new Container();
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", taskManager);
    container.register("BackgroundTaskManager", mockBackgroundTaskManager);

    container.register("ConfigurationService", {
      resolveGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      resolveModelConfig: () => ({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => "en",
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
  });

  afterAll(async () => {
    try {
      // Wait for every log stream opened above to close before removing the
      // directory, because both removal failures are races with an open that is
      // still in flight:
      //  - removing the directory while an open is queued makes that open fail
      //    with ENOENT. Nothing in the code under test listens for 'error' on
      //    the log stream, so that surfaces as an unhandled error and fails the
      //    whole run;
      //  - removing it while a file is being created fails the removal itself
      //    with ENOTEMPTY, and Node's built-in retries cannot recover from that
      //    one: rimraf reads the directory listing once and then only retries
      //    the rmdir, so an entry created after that listing is never removed
      //    (`maxRetries` only covers the Windows case where an already-deleted
      //    file keeps its name until its handle is released).
      // Waiting for 'close' is a real barrier rather than a timing heuristic:
      // a stream destroyed mid-open closes as soon as that open lands, and
      // 'close' is emitted only after the fd is closed — i.e. strictly after the
      // file itself exists. Once every tracked stream has closed, nothing can
      // add another entry to ISOLATED_TMP_DIR and the removal has no writer to
      // race. Awaiting 'error' too is deliberate: a stream whose open failed is
      // settled as well, and afterAll must not turn that into an unhandled
      // error. The per-stream deadline is the safety net for a stream that
      // never settles.
      await Promise.all(
        logStreams.map((stream) => {
          if (!stream.closed) {
            // Two tests background an instance and never let it finish, so their
            // stream is still open here and would otherwise sit out the whole
            // deadline; destroying it starts a normal close (and is a no-op for
            // an open that is still in flight).
            stream.destroy();
          }
          return new Promise<void>((resolve) => {
            if (stream.closed) {
              resolve();
              return;
            }
            const deadline = setTimeout(resolve, LOG_STREAM_CLOSE_TIMEOUT_MS);
            const settle = () => {
              clearTimeout(deadline);
              resolve();
            };
            stream.once("close", settle);
            stream.once("error", settle);
            // 'close' may have been emitted while the listeners were attached.
            if (stream.closed) {
              settle();
            }
          });
        }),
      );

      // Retrying is a belt for the Windows case the barrier cannot see — a
      // deleted file whose handle is not released promptly keeps its name in the
      // directory — but never fail the suite if the cleanup does not work out:
      // isolation comes from the unique directory name (`process.pid` +
      // `Date.now()`), not from deleting every byte, so a directory left behind
      // cannot pollute a later run's assertions and there is nothing to gain
      // from reporting its cleanup failure as a test failure.
      fs.rmSync(ISOLATED_TMP_DIR, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 50,
      });
    } catch (error) {
      logWarn(
        `[subagentManager.background.test] could not remove ${ISOLATED_TMP_DIR} (harmless, directory name is unique per run):`,
        error,
      );
    }
  });

  it("should handle backgroundInstance error when backgroundTaskManager is missing", async () => {
    const managerNoBG = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
    // Remove BackgroundTaskManager from container for this test
    (
      container as unknown as { services: Map<string, unknown> }
    ).services.delete("BackgroundTaskManager");

    const instance = await managerNoBG.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await expect(
      managerNoBG.backgroundInstance(instance.subagentId),
    ).rejects.toThrow("BackgroundTaskManager not available");
  });

  it("should handle backgroundInstance error when instance not found", async () => {
    await expect(
      subagentManager.backgroundInstance("non-existent"),
    ).rejects.toThrow("Subagent instance non-existent not found");
  });

  it("should update background task on completion", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    // Trigger internalExecute completion logic
    // We can't easily trigger the internal private method, but we can call executeAgent
    // which calls internalExecute.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);
    await subagentManager.executeAgent(instance, "test prompt");

    expect(mockTask.status).toBe("completed");
    expect(mockTask.endTime).toBeGreaterThan(0);
  });

  it("should update background task on error", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stderr: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    // Mock internalExecute to throw by mocking aiManager.sendAIMessage
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("AI Error"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("AI Error");

    expect(mockTask.status).toBe("failed");
    expect(mockTask.stderr).toBe("AI Error");
  });

  it("should cover createSubagentCallbacks reasoning update", async () => {
    const onSubagentAssistantReasoningUpdated = vi.fn();

    const manager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
      callbacks: { onSubagentAssistantReasoningUpdated },
    });

    const instance = await manager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    // refreshSubagentState pulls from messageManager.getMessages on every
    // incremental callback; stub it to an empty list for this unit test.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    // In the test, MessageManager is mocked, so we need to make sure it has the callbacks
    // But wait, if it's mocked, (instance.messageManager as any).callbacks might be undefined
    // unless we set it.
    // Let's check how createInstance is implemented. It passes subagentCallbacks to MessageManager constructor.
    // Since MessageManager is mocked, we need to capture what was passed to the constructor.
    const MessageManagerMock = vi.mocked(MessageManager);
    const lastCall =
      MessageManagerMock.mock.calls[MessageManagerMock.mock.calls.length - 1];
    const passedCallbacks = lastCall[1].callbacks;
    passedCallbacks.onAssistantReasoningUpdated?.({
      messageId: "msg-test-id",
      chunk: "chunk",
      stage: "streaming",
    });

    expect(onSubagentAssistantReasoningUpdated).toHaveBeenCalledWith({
      subagentId: instance.subagentId,
      messageId: "msg-test-id",
      chunk: "chunk",
      stage: "streaming",
    });
  });

  it("should create a log file and log tool execution for background subagent", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await subagentManager.backgroundInstance(instance.subagentId);

    const addTaskMock = vi.mocked(mockBackgroundTaskManager.addTask);
    const outputPath = addTaskMock.mock.calls[0][0].outputPath!;

    expect(outputPath).toContain("wave-subagent-task_");
    expect(outputPath).toContain(".log");

    // refreshSubagentState pulls from messageManager.getMessages on every
    // incremental callback; stub it to an empty list for this unit test.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    // Capture callbacks passed to MessageManager
    const MessageManagerMock = vi.mocked(MessageManager);
    const lastCall =
      MessageManagerMock.mock.calls[MessageManagerMock.mock.calls.length - 1];
    const passedCallbacks = lastCall[1].callbacks;

    // Trigger tool block update (stage "end" to trigger logging)
    passedCallbacks.onToolBlockUpdated?.({
      id: "tool_123",
      messageId: "msg-test-id",
      stage: "end",
      name: "Read",
      parameters: JSON.stringify({ file_path: "test.txt" }),
    });

    // logStream.write is async — wait for content, not just file existence
    await vi.waitFor(
      () => {
        expect(fs.existsSync(outputPath)).toBe(true);
        const content = fs.readFileSync(outputPath, "utf8");
        expect(content).toContain("Read");
        expect(content).toContain("test.txt");
      },
      { timeout: LOG_FLUSH_TIMEOUT_MS },
    );

    // Cleanup
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("should write final response and completion status to log file on success", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    const addTaskMock = vi.mocked(mockBackgroundTaskManager.addTask);
    const outputPath = addTaskMock.mock.calls[0][0].outputPath!;

    // Mock messages to return a response
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Build completed successfully" }],
      },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);

    await subagentManager.executeAgent(instance, "test prompt");

    // logStream.write is async — wait for content, not just file existence
    await vi.waitFor(
      () => {
        expect(fs.existsSync(outputPath)).toBe(true);
        const content = fs.readFileSync(outputPath, "utf8");
        expect(content).toContain("Final response:");
        expect(content).toContain("Build completed successfully");
        expect(content).toContain("Agent completed");
      },
      { timeout: LOG_FLUSH_TIMEOUT_MS },
    );

    // Cleanup
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("should write error to log file on failure", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stderr: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    const addTaskMock = vi.mocked(mockBackgroundTaskManager.addTask);
    const outputPath = addTaskMock.mock.calls[0][0].outputPath!;

    // Mock AI to throw an error
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("Build failed with exit code 1"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("Build failed with exit code 1");

    // logStream.write is async — wait for content, not just file existence
    await vi.waitFor(
      () => {
        const content = fs.existsSync(outputPath)
          ? fs.readFileSync(outputPath, "utf8")
          : "";
        expect(content).toContain("Agent failed:");
        expect(content).toContain("Build failed with exit code 1");
      },
      { timeout: LOG_FLUSH_TIMEOUT_MS },
    );

    // Cleanup
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("should log error block to log file when onErrorBlockAdded fires", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await subagentManager.backgroundInstance(instance.subagentId);

    const addTaskMock = vi.mocked(mockBackgroundTaskManager.addTask);
    const outputPath = addTaskMock.mock.calls[0][0].outputPath!;

    // refreshSubagentState pulls from messageManager.getMessages on every
    // incremental callback; stub it to an empty list for this unit test.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    // Capture callbacks passed to MessageManager
    const MessageManagerMock = vi.mocked(MessageManager);
    const lastCall =
      MessageManagerMock.mock.calls[MessageManagerMock.mock.calls.length - 1];
    const passedCallbacks = lastCall[1].callbacks;

    // Trigger error block callback (simulating LLM API error like 429)
    passedCallbacks.onErrorBlockAdded?.(
      "Rate limit exceeded (429): Too many requests",
    );

    // logStream.write is async — wait for content, not just file existence
    await vi.waitFor(
      () => {
        expect(fs.existsSync(outputPath)).toBe(true);
        const content = fs.readFileSync(outputPath, "utf8");
        expect(content).toContain("Error:");
        expect(content).toContain(
          "Rate limit exceeded (429): Too many requests",
        );
      },
      { timeout: LOG_FLUSH_TIMEOUT_MS },
    );

    // Cleanup
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });

  it("should handle background completion without MessageQueue", async () => {
    // Create a container without MessageQueue
    const noNotifyContainer = new Container();

    const noNotifyToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    const noNotifyBgTaskManager = {
      generateId: vi.fn().mockReturnValue("task_456"),
      addTask: vi.fn(),
      notifyTasksChange: vi.fn(),
      getTask: vi.fn().mockReturnValue({
        id: "task_456",
        status: "running",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
        endTime: 0,
        runtime: 0,
      }),
    } as unknown as BackgroundTaskManager;

    const noNotifyTaskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    noNotifyContainer.register("ToolManager", noNotifyToolManager);
    noNotifyContainer.register("TaskManager", noNotifyTaskManager);
    noNotifyContainer.register("BackgroundTaskManager", noNotifyBgTaskManager);

    noNotifyContainer.register("ConfigurationService", {
      resolveGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      resolveModelConfig: () => ({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => "en",
    });

    const manager = new SubagentManager(noNotifyContainer, {
      workdir: "/test",
      stream: false,
    });

    const instance = await manager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await manager.backgroundInstance(instance.subagentId);

    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);

    // Should not throw even without MessageQueue
    await manager.executeAgent(instance, "test prompt");
  });

  it("should handle background error without MessageQueue", async () => {
    const noNotifyContainer = new Container();

    const noNotifyToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    const noNotifyBgTaskManager = {
      generateId: vi.fn().mockReturnValue("task_789"),
      addTask: vi.fn(),
      notifyTasksChange: vi.fn(),
      getTask: vi.fn().mockReturnValue({
        id: "task_789",
        status: "running",
        startTime: Date.now(),
        stdout: "",
        stderr: "",
        endTime: 0,
        runtime: 0,
      }),
    } as unknown as BackgroundTaskManager;

    const noNotifyTaskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    noNotifyContainer.register("ToolManager", noNotifyToolManager);
    noNotifyContainer.register("TaskManager", noNotifyTaskManager);
    noNotifyContainer.register("BackgroundTaskManager", noNotifyBgTaskManager);

    noNotifyContainer.register("ConfigurationService", {
      resolveGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      resolveModelConfig: () => ({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => "en",
    });

    const manager = new SubagentManager(noNotifyContainer, {
      workdir: "/test",
      stream: false,
    });

    const instance = await manager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await manager.backgroundInstance(instance.subagentId);

    // Mock AI to throw error
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("AI Error"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    // Should not throw from notification code, only the AI error
    await expect(manager.executeAgent(instance, "test prompt")).rejects.toThrow(
      "AI Error",
    );
  });
});
