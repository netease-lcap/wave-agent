import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type {
  ReadFileState,
  ToolContext,
  ToolPlugin,
} from "../../src/tools/types.js";

const { callAgentMock } = vi.hoisted(() => ({
  callAgentMock: vi.fn(),
}));

const { convertMock } = vi.hoisted(() => ({
  convertMock: vi.fn(),
}));

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: vi.fn() },
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: callAgentMock,
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: (...args: unknown[]) => {
    // Snapshot a copy: the fork loop mutates the returned array in place on
    // later turns, which would leak into the recorded call.
    convertMock(
      Array.isArray(args[0]) ? [...(args[0] as unknown[])] : args[0],
      args[1],
    );
    return args[0];
  },
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

const PARENT_FILE = "/test/parent-read.ts";

/**
 * The auto-memory extraction fork shares the main loop's request prefix, so it
 * also shares the read-state baseline (it must be able to Edit a file the main
 * session already read). That sharing is a *clone*: the fork's reads and writes
 * must never feed back into the main session's read dedup / staleness
 * tracking.
 */
describe("AIManager - fork read-state isolation", () => {
  let aiManager: AIManager;
  let parentReadFileState: ReadFileState;
  let forkReadFileState: ReadFileState | undefined;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
    permissionMode: "default",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    forkReadFileState = undefined;

    // Turn 1: the fork calls Probe. Turn 2: it produces text and stops.
    callAgentMock
      .mockResolvedValueOnce({
        content: undefined,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "Probe", arguments: "{}" },
          },
        ],
      })
      .mockResolvedValueOnce({
        content: "extracted memory",
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
        tool_calls: [],
      });

    const probeTool: ToolPlugin = {
      name: "Probe",
      config: {
        type: "function",
        function: {
          name: "Probe",
          description: "test probe",
          parameters: { type: "object", properties: {} },
        },
      },
      async execute(_args: unknown, context: ToolContext) {
        forkReadFileState = context.readFileState;
        return { success: true, content: "probed" };
      },
    };

    const container = new Container();

    const mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    } as unknown as MessageManager;

    const mockHookManager = {} as unknown as HookManager;

    const mockToolManager = {
      getTools: vi.fn().mockReturnValue([probeTool]),
      getToolsConfig: vi
        .fn()
        .mockReturnValue([{ type: "function", function: { name: "Probe" } }]),
    } as unknown as ToolManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getEffectiveAdditionalDirectories: vi.fn().mockReturnValue([]),
    } as unknown as PermissionManager;

    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("HookManager", mockHookManager);
    container.register("BackgroundTaskManager", {
      getAllTasks: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", undefined);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("TaskManager", { syncWithSession: vi.fn() });
    container.register("MergedEnv", { PATH: "/usr/bin" });
    container.register("Workdir", "/test/workdir");
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue("en"),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: { onUsageAdded: vi.fn() },
    });

    // The main session already read this file.
    parentReadFileState = (
      aiManager as unknown as { readFileState: ReadFileState }
    ).readFileState;
    parentReadFileState.set(PARENT_FILE, {
      mtime: 1000,
      hash: "parent-hash",
      source: "read",
      content: "parent content",
    });
  });

  async function runFork(): Promise<void> {
    await aiManager.runAutoMemoryFork(
      [{ role: "user", blocks: [] }] as never,
      "extract memories",
      { canUseTool: (name) => name === "Probe", maxTurns: 3 },
    );
  }

  it("hands the fork a read state that inherits the parent's baseline", async () => {
    await runFork();

    expect(forkReadFileState).toBeDefined();
    // The fork sees the parent's read, so it can Edit without re-reading.
    expect(forkReadFileState!.get(PARENT_FILE)?.content).toBe("parent content");
    // But it is a different map instance.
    expect(forkReadFileState).not.toBe(parentReadFileState);
  });

  it("copies entries so mutating a fork entry does not touch the parent's", async () => {
    await runFork();

    const forkEntry = forkReadFileState!.get(PARENT_FILE)!;
    expect(forkEntry).not.toBe(parentReadFileState.get(PARENT_FILE));

    forkEntry.content = "fork content";
    forkEntry.mtime = 9999;
    forkEntry.source = "edit";

    const parentEntry = parentReadFileState.get(PARENT_FILE)!;
    expect(parentEntry.content).toBe("parent content");
    expect(parentEntry.mtime).toBe(1000);
    expect(parentEntry.source).toBe("read");
  });

  it("does not leak fork-created or fork-refreshed entries back to the parent", async () => {
    await runFork();

    // Simulate tool execution inside the fork: Edit refreshes a known file and
    // Read records a brand-new one.
    forkReadFileState!.set(PARENT_FILE, {
      mtime: 2000,
      hash: "fork-hash",
      source: "edit",
      content: "fork content",
    });
    forkReadFileState!.set("/test/fork-only.ts", {
      mtime: 3000,
      hash: "fork-only-hash",
      source: "read",
      content: "fork only",
    });

    expect(Array.from(parentReadFileState.keys())).toEqual([PARENT_FILE]);
    expect(parentReadFileState.get(PARENT_FILE)).toEqual({
      mtime: 1000,
      hash: "parent-hash",
      source: "read",
      content: "parent content",
    });
  });

  it("reuses the caller's message prefix verbatim, injecting nothing extra", async () => {
    await runFork();

    // The fork must not add its own reminder to the history: any extra message
    // would change the request prefix and lose the prompt cache it exists to
    // reuse. File-change reminders reach the fork only because the main loop
    // persisted them into the shared history.
    expect(convertMock).toHaveBeenCalledTimes(1);
    expect(convertMock.mock.calls[0][0]).toHaveLength(1);
  });
});
