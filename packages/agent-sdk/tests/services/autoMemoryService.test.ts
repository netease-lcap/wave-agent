import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoMemoryService } from "@/services/autoMemoryService.js";
import { Container } from "@/utils/container.js";
import type { MessageManager } from "@/managers/messageManager.js";
import type { AIManager } from "@/managers/aiManager.js";
import type { MemoryService } from "@/services/memory.js";
import type { ConfigurationService } from "@/services/configurationService.js";

vi.mock("@/managers/messageManager.js");
vi.mock("@/managers/aiManager.js");
vi.mock("@/services/memory.js");
vi.mock("@/services/configurationService.js");

describe("AutoMemoryService", () => {
  let container: Container;
  let autoMemoryService: AutoMemoryService;
  let mockMessageManager: {
    getMessages: ReturnType<typeof vi.fn>;
  };
  let mockAiManager: {
    runAutoMemoryFork: ReturnType<typeof vi.fn>;
  };
  let mockMemoryService: {
    getAutoMemoryDirectory: ReturnType<typeof vi.fn>;
    ensureAutoMemoryDirectory: ReturnType<typeof vi.fn>;
  };
  let mockConfigurationService: {
    resolveAutoMemoryEnabled: ReturnType<typeof vi.fn>;
    resolveAutoMemoryFrequency: ReturnType<typeof vi.fn>;
  };

  /** Extract the canUseTool gate passed to the first runAutoMemoryFork call. */
  function captureToolGate(): (
    name: string,
    args: Record<string, unknown>,
  ) => boolean {
    const call = mockAiManager.runAutoMemoryFork.mock.calls[0];
    const options = call[2] as {
      canUseTool: (name: string, args: Record<string, unknown>) => boolean;
    };
    return options.canUseTool;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();

    mockMessageManager = {
      getMessages: vi.fn().mockReturnValue([]),
    };
    mockAiManager = {
      runAutoMemoryFork: vi.fn().mockResolvedValue({}),
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
    container.register("AIManager", mockAiManager as unknown as AIManager);
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
    expect(mockAiManager.runAutoMemoryFork).not.toHaveBeenCalled();
  });

  it("should respect throttling frequency", async () => {
    mockConfigurationService.resolveAutoMemoryFrequency.mockReturnValue(2);
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    // Turn 1
    await autoMemoryService.onTurnEnd("/workdir");
    expect(mockAiManager.runAutoMemoryFork).not.toHaveBeenCalled();

    // Turn 2
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalled();
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
    expect(mockAiManager.runAutoMemoryFork).not.toHaveBeenCalled();
  });

  it("should run extraction if the memory write was denied", async () => {
    // A denied/failed write didn't update memory, so the extraction fork must
    // still run or the information is lost.
    const messages = [
      {
        id: "msg1",
        role: "assistant",
        blocks: [
          {
            type: "tool",
            name: "Write",
            success: false,
            parameters: JSON.stringify({ file_path: "/mock/memory/test.md" }),
          },
        ],
      },
    ];
    mockMessageManager.getMessages.mockReturnValue(messages);

    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalled();
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
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalled();
  });

  it("should properly identify recent messages since last extraction", async () => {
    mockConfigurationService.resolveAutoMemoryFrequency.mockReturnValue(1);

    const turn1Messages = [{ id: "msg1", role: "user", blocks: [] }];
    mockMessageManager.getMessages.mockReturnValue(turn1Messages);

    // Turn 1
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(1);

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
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(1);

    const turn3Messages = [
      ...turn2Messages,
      { id: "msg3", role: "user", blocks: [] },
      { id: "msg4", role: "assistant", blocks: [] },
    ];
    mockMessageManager.getMessages.mockReturnValue(turn3Messages);

    // Turn 3 should run because msg3 and msg4 don't have memory writes
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();
    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(2);
  });

  it("should pass maxTurns 5 and the memory directory to runAutoMemoryFork", async () => {
    mockMemoryService.getAutoMemoryDirectory.mockReturnValue("/mock/memory");
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();

    expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining("/mock/memory"),
      expect.objectContaining({ maxTurns: 5 }),
    );
  });

  it("should allow Read/Grep/Glob and deny other tools in the extraction fork gate", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();

    const gate = captureToolGate();
    expect(gate("Read", { file_path: "/any/file.ts" })).toBe(true);
    expect(gate("Grep", { pattern: "foo" })).toBe(true);
    expect(gate("Glob", { pattern: "**/*.ts" })).toBe(true);
    expect(gate("Agent", { prompt: "hi" })).toBe(false);
    expect(gate("WebFetch", { url: "https://example.com" })).toBe(false);
    expect(gate("Task", { subject: "x" })).toBe(false);
  });

  it("should allow Write/Edit only inside the memory directory", async () => {
    mockMemoryService.getAutoMemoryDirectory.mockReturnValue("/mock/memory");
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);
    await autoMemoryService.onTurnEnd("/mock/workdir");
    await autoMemoryService.drain();

    const gate = captureToolGate();
    // Inside the memory directory
    expect(gate("Write", { file_path: "/mock/memory/test.md" })).toBe(true);
    expect(gate("Edit", { file_path: "/mock/memory/sub/dir/test.md" })).toBe(
      true,
    );
    // Outside the memory directory
    expect(gate("Write", { file_path: "/other/path.md" })).toBe(false);
    expect(gate("Edit", { file_path: "../outside.md" })).toBe(false);
    // Prefix boundary: a sibling directory must not match
    expect(gate("Write", { file_path: "/mock/memory-evil/test.md" })).toBe(
      false,
    );
    // Missing path
    expect(gate("Write", { content: "x" })).toBe(false);
  });

  it("should allow read-only bash commands in the extraction fork gate", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();

    const gate = captureToolGate();
    expect(gate("Bash", { command: "ls -la" })).toBe(true);
    expect(gate("Bash", { command: "cat /mock/memory/test.md" })).toBe(true);
    expect(gate("Bash", { command: "grep -r foo /mock/memory" })).toBe(true);
    expect(gate("Bash", { command: "find /mock/memory -name '*.md'" })).toBe(
      true,
    );
  });

  it("should deny write-capable bash commands in the extraction fork gate", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);
    await autoMemoryService.onTurnEnd("/workdir");
    await autoMemoryService.drain();

    const gate = captureToolGate();
    expect(gate("Bash", { command: "rm -rf /mock/memory" })).toBe(false);
    expect(gate("Bash", { command: "touch /mock/memory/x.md" })).toBe(false);
    expect(gate("Bash", { command: "mkdir /mock/memory/sub" })).toBe(false);
    expect(gate("Bash", { command: "echo hello > /tmp/out.txt" })).toBe(false);
    expect(
      gate("Bash", { command: "sed -i s/a/b/g /mock/memory/test.md" }),
    ).toBe(false);
    expect(gate("Bash", { command: "find /mock/memory -exec rm {} \\;" })).toBe(
      false,
    );
    expect(gate("Bash", { command: "cat $(ls /mock/memory)" })).toBe(false);
    expect(gate("Bash", {})).toBe(false);
  });

  it("should skip triggering while an extraction is in flight", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    // Deferred promise keeps the first extraction in flight until we settle it
    let resolveExtraction!: (value: unknown) => void;
    mockAiManager.runAutoMemoryFork.mockReturnValue(
      new Promise((resolve) => {
        resolveExtraction = resolve;
      }),
    );

    // Turn 1 triggers an extraction that stays in flight
    await autoMemoryService.onTurnEnd("/workdir");
    await vi.waitFor(() => {
      expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(1);
    });

    // Turn 2 while in flight: skipped without resetting the counters
    await autoMemoryService.onTurnEnd("/workdir");
    await vi.waitFor(() => {
      expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(1);
    });

    // Settle the in-flight extraction
    resolveExtraction({});
    await autoMemoryService.drain();

    // Turn 3: eligible again
    await autoMemoryService.onTurnEnd("/workdir");
    await vi.waitFor(() => {
      expect(mockAiManager.runAutoMemoryFork).toHaveBeenCalledTimes(2);
    });
  });

  it("should drain the in-flight extraction", async () => {
    mockMessageManager.getMessages.mockReturnValue([
      { id: "msg1", role: "user", blocks: [] },
    ]);

    let resolveExtraction!: (value: unknown) => void;
    mockAiManager.runAutoMemoryFork.mockReturnValue(
      new Promise((resolve) => {
        resolveExtraction = resolve;
      }),
    );

    await autoMemoryService.onTurnEnd("/workdir");

    let drained = false;
    const drainPromise = autoMemoryService.drain().then(() => {
      drained = true;
    });

    // Still in flight: drain has not resolved yet
    expect(drained).toBe(false);

    resolveExtraction({});
    await drainPromise;
    expect(drained).toBe(true);
  });
});
