import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryService } from "@/services/memory.js";
import { MessageManager } from "@/managers/messageManager.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";

// Mock fs operations
vi.mock("node:fs/promises");

// Mock the logger
vi.mock("@/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the constants
vi.mock("@/utils/constants", () => ({
  USER_MEMORY_FILE: "/mock/user/AGENTS.md",
  DATA_DIRECTORY: "/mock/data",
}));

// Mock gitUtils
vi.mock("@/utils/gitUtils.js", () => ({
  getGitCommonDir: vi.fn((dir) => dir),
}));

// Mock pathEncoder
vi.mock("@/utils/pathEncoder.js", () => ({
  pathEncoder: {
    encodeSync: vi.fn((p: string) => Buffer.from(p).toString("base64")),
  },
}));

// Mock session service
vi.mock("@/services/session.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue(undefined),
    appendMessages: vi.fn().mockResolvedValue(undefined),
    generateSessionId: vi.fn().mockReturnValue("test-session-id"),
    SESSION_DIR: "/tmp/sessions",
  };
});

describe("MemoryService — auto-memory cache", () => {
  let memoryService: MemoryService;
  let container: Container;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue("");

    container = new Container();
    memoryService = new MemoryService(container);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return cached value on second call without reading disk again", async () => {
    const workdir = "/mock/workdir";
    const memoryContent = "# Memory\n\nCached content here";
    vi.mocked(fsPromises.readFile).mockResolvedValue(memoryContent);

    const first = await memoryService.getAutoMemoryContent(workdir);
    const second = await memoryService.getAutoMemoryContent(workdir);

    expect(first).toBe(memoryContent);
    expect(second).toBe(memoryContent);
    // readFile should only be called once — second call uses cache
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it("should cache empty string when file does not exist", async () => {
    const workdir = "/mock/workdir";
    vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

    const first = await memoryService.getAutoMemoryContent(workdir);
    const second = await memoryService.getAutoMemoryContent(workdir);

    expect(first).toBe("");
    expect(second).toBe("");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it("should reset auto-memory cache on clearCache()", async () => {
    const workdir = "/mock/workdir";
    vi.mocked(fsPromises.readFile).mockResolvedValue("content v1");

    const first = await memoryService.getAutoMemoryContent(workdir);
    expect(first).toBe("content v1");

    memoryService.clearCache();

    vi.mocked(fsPromises.readFile).mockResolvedValue("content v2");
    const second = await memoryService.getAutoMemoryContent(workdir);
    expect(second).toBe("content v2");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });
});

describe("MessageManager — stable memory and rules dedup", () => {
  let messageManager: MessageManager;
  let mockMemoryService: {
    getCombinedMemoryContent: ReturnType<typeof vi.fn>;
  };
  let mockMemoryRuleManager: {
    getActiveRules: ReturnType<typeof vi.fn>;
  };
  let container: Container;
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemoryService = {
      getCombinedMemoryContent: vi
        .fn()
        .mockResolvedValue("base memory content"),
    };

    mockMemoryRuleManager = {
      getActiveRules: vi.fn().mockReturnValue([]),
    };

    container = new Container();
    container.register(
      "MemoryService",
      mockMemoryService as unknown as Record<string, unknown>,
    );
    container.register(
      "MemoryRuleManager",
      mockMemoryRuleManager as unknown as Record<string, unknown>,
    );

    messageManager = new MessageManager(container, {
      callbacks: {},
      workdir,
    });
  });

  it("getStableMemory() returns identical string across multiple calls", async () => {
    const first = await messageManager.getStableMemory();
    const second = await messageManager.getStableMemory();
    const third = await messageManager.getStableMemory();

    expect(first).toBe("base memory content");
    expect(second).toBe("base memory content");
    expect(third).toBe("base memory content");
    // getCombinedMemoryContent should only be called once
    expect(mockMemoryService.getCombinedMemoryContent).toHaveBeenCalledTimes(1);
  });

  it("getActiveRulesContent() returns content when rules change", () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1 content", scope: { path: "src/**" } },
    ]);

    // Touch a file so filesInContext is non-empty
    messageManager.touchFile("src/index.ts");

    const result = messageManager.getActiveRulesContent();
    expect(result).toBe("Rule 1 content");
  });

  it("getActiveRulesContent() returns empty string when rules haven't changed (dedup)", () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1 content", scope: { path: "src/**" } },
    ]);

    messageManager.touchFile("src/index.ts");

    const first = messageManager.getActiveRulesContent();
    expect(first).toBe("Rule 1 content");

    // Second call with same rules should return empty (dedup)
    const second = messageManager.getActiveRulesContent();
    expect(second).toBe("");
  });

  it("getActiveRulesContent() returns new content when filesInContext changes", () => {
    mockMemoryRuleManager.getActiveRules
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { id: "rule-2", content: "Rule 2 content", scope: { path: "lib/**" } },
      ]);

    // First call — no active rules
    const first = messageManager.getActiveRulesContent();
    expect(first).toBe("");

    // Now touch a new file, changing filesInContext
    messageManager.touchFile("lib/utils.ts");

    // Second call — now rule-2 is active
    const second = messageManager.getActiveRulesContent();
    expect(second).toBe("Rule 2 content");
  });

  it("clearMemoryCache() resets stable memory cache and rules dedup", async () => {
    // Populate caches
    await messageManager.getStableMemory();
    expect(mockMemoryService.getCombinedMemoryContent).toHaveBeenCalledTimes(1);

    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1", scope: { path: "**" } },
    ]);
    messageManager.touchFile("file.ts");
    messageManager.getActiveRulesContent();

    // Clear caches
    messageManager.clearMemoryCache();

    // Stable memory should be re-fetched
    mockMemoryService.getCombinedMemoryContent.mockResolvedValue("new memory");
    const refreshed = await messageManager.getStableMemory();
    expect(refreshed).toBe("new memory");
    expect(mockMemoryService.getCombinedMemoryContent).toHaveBeenCalledTimes(2);

    // Rules dedup should be reset — same rules should be returned again
    const rulesAgain = messageManager.getActiveRulesContent();
    expect(rulesAgain).toBe("Rule 1");
  });

  it("getCombinedMemory() composes from getStableMemory + getActiveRulesContent", async () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Active rule content", scope: { path: "**" } },
    ]);
    messageManager.touchFile("file.ts");

    const combined = await messageManager.getCombinedMemory();
    expect(combined).toContain("base memory content");
    expect(combined).toContain("Active rule content");
  });

  it("getActiveRulesContent() returns empty when no memoryRuleManager", () => {
    // Create a container without MemoryRuleManager
    const noRulesContainer = new Container();
    noRulesContainer.register(
      "MemoryService",
      mockMemoryService as unknown as Record<string, unknown>,
    );

    const mm = new MessageManager(noRulesContainer, {
      callbacks: {},
      workdir,
    });

    expect(mm.getActiveRulesContent()).toBe("");
  });
});
