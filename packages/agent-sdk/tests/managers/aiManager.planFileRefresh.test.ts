import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  type Mock,
  type Mocked,
} from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { readFile } from "node:fs/promises";
import { callAgent } from "../../src/services/aiService.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { PlanManager } from "../../src/managers/planManager.js";
import type { Message } from "../../src/types/index.js";

vi.mock("node:fs/promises");
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));
vi.mock("../../src/services/aiService.js");
vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

/**
 * Plan panel live refresh (spec core/plan-mode.md「计划文件更新后刷新计划面板」):
 * a successful Write/Edit of the plan file must emit onPlanFileUpdated with the
 * fresh file content; everything else must stay silent.
 */
describe("AIManager plan file refresh", () => {
  const PLAN_PATH = "/home/user/.wave/plans/bold-low-stream.md";

  let aiManager: AIManager;
  let onPlanFileUpdated: Mock<(content: string) => void>;
  let mockMessageManager: Mocked<MessageManager>;
  let mockToolManager: Mocked<ToolManager>;
  let mockPermissionManager: Mocked<PermissionManager>;
  let mockPlanManager: Mocked<PlanManager>;
  let mockMessages: Message[];

  function respondWithToolCall(name: string, args: Record<string, unknown>) {
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        content: "",
        finish_reason: "tool_calls",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      } as never)
      .mockResolvedValueOnce({
        content: "done",
        finish_reason: "stop",
      } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockMessages = [];
    onPlanFileUpdated = vi.fn<(content: string) => void>();

    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getMessages: vi.fn(() => [...mockMessages]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      addAssistantMessage: vi.fn(() => {
        mockMessages.push({
          id: `assistant-${mockMessages.length}`,
          role: "assistant",
          blocks: [{ type: "text", content: "hello" }],
          timestamp: new Date().toISOString(),
        } as Message);
      }),
      updateCurrentMessageContent: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
      processTriggeredRules: vi.fn().mockReturnValue([]),
      addErrorBlock: vi.fn(),
      triggerFileRead: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.jsonl"),
      getRecentFileReads: vi.fn().mockReturnValue([]),
      getInvokedSkillNames: vi.fn().mockReturnValue([]),
      setMessages: vi.fn((msgs: Message[]) => {
        mockMessages = [...msgs];
      }),
      updateToolBlock: vi.fn(),
      finalizeStreamingBlocks: vi.fn(),
      finalizeAbortedToolBlocks: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
      compactMessagesAndUpdateSession: vi.fn(),
    } as unknown as Mocked<MessageManager>;

    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      isConcurrencySafe: vi.fn().mockReturnValue(false),
      execute: vi.fn().mockResolvedValue({ success: true, content: "written" }),
    } as unknown as Mocked<ToolManager>;

    mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("plan"),
      getPlanFilePath: vi.fn().mockReturnValue(PLAN_PATH),
      clearTemporaryRules: vi.fn(),
      setHasExitedPlanMode: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      setNeedsPlanModeExitAttachment: vi.fn(),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    } as unknown as Mocked<PermissionManager>;

    mockPlanManager = {
      isPlanEntryReminderPending: vi.fn(() => false),
      consumePlanEntryReminder: vi.fn(),
    } as unknown as Mocked<PlanManager>;

    const container = new Container();
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue({}),
      resolveModelConfig: vi.fn().mockReturnValue({ model: "gpt-4" }),
      resolveMaxInputTokens: vi.fn().mockReturnValue(1000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("PermissionManager", mockPermissionManager);
    container.register("PlanManager", mockPlanManager);
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: { onPlanFileUpdated },
    });

    vi.mocked(readFile).mockResolvedValue("# Plan v2" as never);
    vi.mocked(callAgent).mockResolvedValue({
      content: "hello",
      finish_reason: "stop",
    } as never);
  });

  it("emits the fresh plan content when Write targets the plan file", async () => {
    respondWithToolCall("Write", {
      file_path: PLAN_PATH,
      content: "# Plan v2",
    });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).toHaveBeenCalledTimes(1);
    expect(onPlanFileUpdated).toHaveBeenCalledWith("# Plan v2");
  });

  it("emits when Edit targets the plan file", async () => {
    respondWithToolCall("Edit", {
      file_path: PLAN_PATH,
      old_string: "a",
      new_string: "b",
    });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).toHaveBeenCalledWith("# Plan v2");
  });

  it("stays silent when Write targets another file", async () => {
    respondWithToolCall("Write", {
      file_path: "/home/user/project/src/index.ts",
      content: "export {};",
    });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).not.toHaveBeenCalled();
  });

  it("stays silent when the tool failed", async () => {
    vi.mocked(mockToolManager.execute).mockResolvedValue({
      success: false,
      content: "",
      error: "boom",
    } as never);
    respondWithToolCall("Write", {
      file_path: PLAN_PATH,
      content: "# Plan v2",
    });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).not.toHaveBeenCalled();
  });

  it("stays silent for tools other than Write/Edit", async () => {
    respondWithToolCall("Bash", { command: `cat ${PLAN_PATH}` });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).not.toHaveBeenCalled();
  });

  it("stays silent when a non-Write/Edit tool merely reads the plan file", async () => {
    // Read also takes `file_path`, so this pins the tool-name check itself
    // rather than the argument-shape guard.
    respondWithToolCall("Read", { file_path: PLAN_PATH });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).not.toHaveBeenCalled();
  });

  it("stays silent when no plan file path is set", async () => {
    mockPermissionManager.getPlanFilePath.mockReturnValue(undefined);
    respondWithToolCall("Write", {
      file_path: PLAN_PATH,
      content: "# Plan v2",
    });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).not.toHaveBeenCalled();
  });

  it("emits empty content when the plan file is written empty", async () => {
    vi.mocked(readFile).mockResolvedValue("" as never);
    respondWithToolCall("Write", { file_path: PLAN_PATH, content: "" });

    await aiManager.sendAIMessage();

    expect(onPlanFileUpdated).toHaveBeenCalledWith("");
  });
});
