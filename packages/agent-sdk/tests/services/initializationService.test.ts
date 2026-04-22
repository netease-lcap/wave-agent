import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  InitializationService,
  type InitializationContext,
} from "../../src/services/initializationService.js";
import { Container } from "../../src/utils/container.js";

describe("InitializationService", () => {
  let context: InitializationContext;
  let mockMemoryService: {
    ensureAutoMemoryDirectory: ReturnType<typeof vi.fn>;
    readMemoryFile: ReturnType<typeof vi.fn>;
    getUserMemoryContent: ReturnType<typeof vi.fn>;
  };
  let mockConfigurationService: {
    loadMergedConfiguration: ReturnType<typeof vi.fn>;
    resolveAutoMemoryEnabled: ReturnType<typeof vi.fn>;
    getEnvironmentVars: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemoryService = {
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      readMemoryFile: vi.fn().mockResolvedValue(""),
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
    };

    mockConfigurationService = {
      loadMergedConfiguration: vi.fn().mockResolvedValue({ configuration: {} }),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    };

    const container = new Container();
    container.register("MemoryService", mockMemoryService);

    const mockAddUserMessage = vi.fn();

    context = {
      skillManager: {
        initialize: vi.fn(),
        getAvailableSkills: vi.fn().mockReturnValue([]),
      } as unknown as InitializationContext["skillManager"],
      subagentManager: {
        initialize: vi.fn(),
        getConfigurations: vi.fn().mockReturnValue([]),
      } as unknown as InitializationContext["subagentManager"],
      container,
      toolManager: {
        initializeBuiltInTools: vi.fn(),
      } as unknown as InitializationContext["toolManager"],
      pluginManager: {
        loadPlugins: vi.fn(),
        updateEnabledPlugins: vi.fn(),
      } as unknown as InitializationContext["pluginManager"],
      options: { plugins: [] } as unknown as InitializationContext["options"],
      slashCommandManager: {
        registerSkillCommands: vi.fn(),
      } as unknown as InitializationContext["slashCommandManager"],
      mcpManager: {
        initialize: vi.fn(),
      } as unknown as InitializationContext["mcpManager"],
      workdir: "/test/workdir",
      lspManager: {
        initialize: vi.fn(),
      } as unknown as InitializationContext["lspManager"],
      configurationService:
        mockConfigurationService as unknown as InitializationContext["configurationService"],
      hookManager: {
        loadConfigurationFromWaveConfig: vi.fn(),
        executeHooks: vi.fn().mockResolvedValue([]),
        processHookResults: vi.fn(),
        executeSessionStartHooks: vi.fn().mockResolvedValue({ results: [] }),
      } as unknown as InitializationContext["hookManager"],
      messageManager: {
        getSessionId: vi.fn().mockReturnValue("test"),
        getTranscriptPath: vi.fn(),
        setMessages: vi.fn(),
        rebuildUsageFromMessages: vi.fn(),
        getWorkdir: vi.fn().mockReturnValue("/test/workdir"),
        addUserMessage: mockAddUserMessage,
      } as unknown as InitializationContext["messageManager"],
      memoryRuleManager: {
        discoverRules: vi.fn(),
      } as unknown as InitializationContext["memoryRuleManager"],
      liveConfigManager: {
        initialize: vi.fn(),
      } as unknown as InitializationContext["liveConfigManager"],
      taskManager: {
        setTaskListId: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as InitializationContext["taskManager"],
      setProjectMemory: vi.fn(),
      setUserMemory: vi.fn(),
      resolveAndValidateConfig: vi.fn(),
    } as unknown as InitializationContext;
  });

  it("should initialize auto-memory directory when enabled", async () => {
    vi.mocked(
      mockConfigurationService.resolveAutoMemoryEnabled,
    ).mockReturnValue(true);

    await InitializationService.initialize(context);

    expect(
      vi.mocked(mockMemoryService.ensureAutoMemoryDirectory),
    ).toHaveBeenCalledWith("/test/workdir");
  });

  it("should add USER_MEMORY_FILE to the safe zone during initialization", async () => {
    const { USER_MEMORY_FILE } = await import("../../src/utils/constants.js");
    const mockPermissionManager = {
      addSystemAdditionalDirectory: vi.fn(),
    };
    context.container.register("PermissionManager", mockPermissionManager);

    vi.mocked(
      context.configurationService.resolveAutoMemoryEnabled,
    ).mockReturnValue(true);
    vi.mocked(mockMemoryService.ensureAutoMemoryDirectory).mockResolvedValue(
      undefined,
    );
    (
      mockMemoryService as unknown as {
        getAutoMemoryDirectory: ReturnType<typeof vi.fn>;
      }
    ).getAutoMemoryDirectory = vi.fn().mockReturnValue("/mock/auto-memory");

    await InitializationService.initialize(context);

    expect(
      mockPermissionManager.addSystemAdditionalDirectory,
    ).toHaveBeenCalledWith(USER_MEMORY_FILE);
  });

  it("should NOT initialize auto-memory directory when disabled", async () => {
    vi.mocked(
      mockConfigurationService.resolveAutoMemoryEnabled,
    ).mockReturnValue(false);

    await InitializationService.initialize(context);

    expect(
      vi.mocked(mockMemoryService.ensureAutoMemoryDirectory),
    ).not.toHaveBeenCalled();
  });

  describe("SessionStart hooks", () => {
    it("should inject additionalContext as a user message", async () => {
      vi.mocked(context.hookManager.executeSessionStartHooks).mockResolvedValue(
        {
          results: [],
          additionalContext: "Project context from hook",
        },
      );

      await InitializationService.initialize(context);

      expect(context.messageManager.addUserMessage).toHaveBeenCalledWith({
        content: "Project context from hook",
      });
    });

    it("should inject initialUserMessage as a user message", async () => {
      vi.mocked(context.hookManager.executeSessionStartHooks).mockResolvedValue(
        {
          results: [],
          initialUserMessage: "Hello from the hook",
        },
      );

      await InitializationService.initialize(context);

      expect(context.messageManager.addUserMessage).toHaveBeenCalledWith({
        content: "Hello from the hook",
      });
    });

    it("should inject both additionalContext and initialUserMessage", async () => {
      vi.mocked(context.hookManager.executeSessionStartHooks).mockResolvedValue(
        {
          results: [],
          additionalContext: "Extra context",
          initialUserMessage: "Initial message",
        },
      );

      await InitializationService.initialize(context);

      expect(context.messageManager.addUserMessage).toHaveBeenCalledTimes(2);
      expect(context.messageManager.addUserMessage).toHaveBeenNthCalledWith(1, {
        content: "Extra context",
      });
      expect(context.messageManager.addUserMessage).toHaveBeenNthCalledWith(2, {
        content: "Initial message",
      });
    });

    it("should not add user messages when hook returns no context", async () => {
      vi.mocked(context.hookManager.executeSessionStartHooks).mockResolvedValue(
        {
          results: [],
        },
      );

      await InitializationService.initialize(context);

      expect(context.messageManager.addUserMessage).not.toHaveBeenCalled();
    });

    it("should continue initialization when SessionStart hooks fail", async () => {
      vi.mocked(context.hookManager.executeSessionStartHooks).mockRejectedValue(
        new Error("Hook execution failed"),
      );

      await expect(
        InitializationService.initialize(context),
      ).resolves.not.toThrow();
    });
  });
});
