import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoMemoryService } from "@/services/autoMemoryService.js";
import { Container } from "@/utils/container.js";
import type { MessageManager } from "@/managers/messageManager.js";
import type { ForkedAgentManager } from "@/managers/forkedAgentManager.js";
import type { MemoryService } from "@/services/memory.js";
import type { ConfigurationService } from "@/services/configurationService.js";

vi.mock("@/managers/messageManager.js");
vi.mock("@/managers/forkedAgentManager.js");
vi.mock("@/services/memory.js");
vi.mock("@/services/configurationService.js");

describe("AutoMemoryService", () => {
  let container: Container;
  let autoMemoryService: AutoMemoryService;
  let mockMessageManager: {
    getMessages: ReturnType<typeof vi.fn>;
  };
  let mockForkedAgentManager: {
    forkAndExecute: ReturnType<typeof vi.fn>;
  };
  let mockMemoryService: {
    getAutoMemoryDirectory: ReturnType<typeof vi.fn>;
    ensureAutoMemoryDirectory: ReturnType<typeof vi.fn>;
  };
  let mockConfigurationService: {
    resolveAutoMemoryEnabled: ReturnType<typeof vi.fn>;
    resolveAutoMemoryFrequency: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();

    mockMessageManager = {
      getMessages: vi.fn().mockReturnValue([]),
    };
    mockForkedAgentManager = {
      forkAndExecute: vi.fn().mockResolvedValue("fork-id"),
    };
    mockMemoryService = {
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    };
    mockConfigurationService = {
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveAutoMemoryFrequency: vi.fn().mockReturnValue(1),
    };

    container.register(
      "MessageManager",
      mockMessageManager as unknown as MessageManager,
    );
    container.register(
      "ForkedAgentManager",
      mockForkedAgentManager as unknown as ForkedAgentManager,
    );
    container.register(
      "MemoryService",
      mockMemoryService as unknown as MemoryService,
    );
    container.register(
      "ConfigurationService",
      mockConfigurationService as unknown as ConfigurationService,
    );

    autoMemoryService = new AutoMemoryService(container);
  });

  it("should not run if auto-memory is disabled", async () => {
    mockConfigurationService.resolveAutoMemoryEnabled.mockReturnValue(false);
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).not.toHaveBeenCalled();
  });

  it("should respect throttling frequency", async () => {
    mockConfigurationService.resolveAutoMemoryFrequency.mockReturnValue(2);
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    // Turn 1
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).not.toHaveBeenCalled();

    // Turn 2
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalled();
  });

  it("should skip extraction if manual memory write is detected", async () => {
    const memoryDir = "/mock/memory";
    mockMemoryService.getAutoMemoryDirectory.mockReturnValue(memoryDir);

    const messages = [
      {
        id: "msg1",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Write",
            parameters: JSON.stringify({ file_path: "/mock/memory/test.md" }),
          },
        ],
      },
    ];
    mockMessageManager.getMessages.mockReturnValue(messages);

    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).not.toHaveBeenCalled();
  });

  it("should run extraction if no manual memory write is detected", async () => {
    const messages = [
      {
        id: "msg1",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Write",
            parameters: JSON.stringify({ file_path: "/other/path.md" }),
          },
        ],
      },
    ];
    mockMessageManager.getMessages.mockReturnValue(messages);

    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalled();
  });

  it("should properly identify recent messages since last extraction", async () => {
    mockConfigurationService.resolveAutoMemoryFrequency.mockReturnValue(1);

    const turn1Messages = [{ id: "msg1", role: "user", blocks: [] }];
    mockMessageManager.getMessages.mockReturnValue(turn1Messages);

    // Turn 1
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalledTimes(1);

    const turn2Messages = [
      ...turn1Messages,
      {
        id: "msg2",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Write",
            parameters: JSON.stringify({ file_path: "/mock/memory/test.md" }),
          },
        ],
      },
    ];
    mockMessageManager.getMessages.mockReturnValue(turn2Messages);

    // Turn 2 should skip due to manual write in msg2
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalledTimes(1);

    const turn3Messages = [
      ...turn2Messages,
      { id: "msg3", role: "user", blocks: [] },
      { id: "msg4", role: "assistant", blocks: [] },
    ];
    mockMessageManager.getMessages.mockReturnValue(turn3Messages);

    // Turn 3 should run because msg3 and msg4 don't have memory writes
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalledTimes(2);
  });

  it("should pass maxTurns: 5 to forkAndExecute", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    await autoMemoryService.onTurnEnd("/workdir");

    expect(mockForkedAgentManager.forkAndExecute).toHaveBeenCalledWith(
      "general-purpose",
      expect.any(Array),
      expect.objectContaining({ maxTurns: 5 }),
      expect.any(String),
    );
  });
});
