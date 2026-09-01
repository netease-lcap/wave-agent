import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import * as aiService from "../../src/services/aiService.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn(),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager - tool fan-out MaxListenersExceededWarning", () => {
  let aiManager: AIManager;
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;
  const warnings: Array<{ name?: string; message?: string }> = [];

  const warningHandler = (warning: { name?: string; message?: string }) => {
    warnings.push(warning);
  };

  beforeEach(() => {
    warnings.length = 0;
    process.on("warning", warningHandler);

    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMessages: vi.fn().mockReturnValue([]),
      addAssistantMessage: vi.fn(),
      addUserMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      updateToolBlock: vi.fn(),
      setMessages: vi.fn(),
      getLatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
      processTriggeredRules: vi.fn().mockReturnValue([]),
      saveSession: vi.fn().mockResolvedValue(undefined),
      setlatestTotalTokens: vi.fn(),
      addErrorBlock: vi.fn(),
      finalizeStreamingBlocks: vi.fn(),
      finalizeAbortedToolBlocks: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
    } as unknown as MessageManager;

    // Mirror real tool implementations (bashTool/webFetchTool): every tool
    // call wires its own abort listener onto the shared tool signal.
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockImplementation(
          (_name: string, _args: string, context: ToolContext) => {
            context.abortSignal?.addEventListener("abort", vi.fn(), {
              once: true,
            });
            return Promise.resolve({ success: true, content: "test result" });
          },
        ),
      isConcurrencySafe: vi.fn().mockReturnValue(true),
    } as unknown as ToolManager;

    const container = new Container();
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue({}),
      resolveModelConfig: vi.fn().mockReturnValue({}),
      resolveMaxInputTokens: vi.fn().mockReturnValue(100000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    });
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue(""),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      clearTemporaryRules: vi.fn(),
      setHasExitedPlanMode: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      setNeedsPlanModeExitAttachment: vi.fn(),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });
  });

  afterEach(() => {
    process.removeListener("warning", warningHandler);
  });

  it("should not emit MaxListenersExceededWarning when a turn fans out 11+ parallel tool calls", async () => {
    const toolCalls = Array.from({ length: 11 }, (_, i) => ({
      id: `call_${i}`,
      type: "function" as const,
      function: { name: "test_tool", arguments: '{"arg": "val"}' },
    }));

    vi.mocked(aiService.callAgent)
      .mockResolvedValueOnce({
        content: "Calling tools in parallel",
        tool_calls: toolCalls,
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    // Node >=26 removed EventTarget's MaxListenersExceededWarning mechanism
    // (and the setMaxListeners method), so the warning below only fires on
    // Node <26 — which is what customers run (22/24, incl. bundled Electron
    // Node). The spy assertion covers the fix on those versions.
    const prototypeSetMaxListeners = (
      AbortSignal.prototype as unknown as {
        setMaxListeners?: (n: number) => void;
      }
    ).setMaxListeners;
    const setMaxListenersSpy =
      typeof prototypeSetMaxListeners === "function"
        ? vi.spyOn(
            AbortSignal.prototype as unknown as {
              setMaxListeners: (n: number) => void;
            },
            "setMaxListeners",
          )
        : undefined;

    await aiManager.sendAIMessage();

    if (setMaxListenersSpy) {
      expect(setMaxListenersSpy).toHaveBeenCalledWith(0);
      setMaxListenersSpy.mockRestore();
    }

    const maxListenersWarnings = warnings.filter(
      (w) => w.name === "MaxListenersExceededWarning",
    );
    expect(maxListenersWarnings).toEqual([]);
    expect(mockToolManager.execute).toHaveBeenCalledTimes(11);
  });
});
