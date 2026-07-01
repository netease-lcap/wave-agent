import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryService } from "@/services/memory.js";
import { MessageManager } from "@/managers/messageManager.js";
import { Container } from "@/utils/container.js";
import fsPromises from "node:fs/promises";

vi.mock("node:fs/promises");

vi.mock("@/utils/globalLogger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/utils/constants", () => ({
  USER_MEMORY_FILE: "/mock/AGENTS.md",
  DATA_DIRECTORY: "/mock/data",
}));

vi.mock("@/utils/gitUtils.js", () => ({
  getGitCommonDir: vi.fn((dir: string) => dir),
}));

vi.mock("@/utils/pathEncoder.js", () => ({
  pathEncoder: {
    encodeSync: vi.fn((p: string) => Buffer.from(p).toString("base64")),
  },
}));

vi.mock("@/services/session.js", () => ({
  createSession: vi.fn(),
  appendMessages: vi.fn(),
  generateSessionId: vi.fn().mockReturnValue("test-session-id"),
  SESSION_DIR: "/tmp/sessions",
}));

describe("MemoryService — auto-memory cache", () => {
  let memoryService: MemoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fsPromises.access).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readFile).mockResolvedValue("");

    const container = new Container();
    memoryService = new MemoryService(container);
  });

  it("caches auto-memory content across calls", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue("# Memory\nCached");

    const first = await memoryService.getAutoMemoryContent("/w");
    const second = await memoryService.getAutoMemoryContent("/w");

    expect(first).toBe("# Memory\nCached");
    expect(second).toBe(first);
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it("caches empty string on ENOENT", async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue({ code: "ENOENT" });

    const first = await memoryService.getAutoMemoryContent("/w");
    const second = await memoryService.getAutoMemoryContent("/w");

    expect(first).toBe("");
    expect(second).toBe("");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(1);
  });

  it("clearCache resets auto-memory cache", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue("v1");
    await memoryService.getAutoMemoryContent("/w");

    memoryService.clearCache();

    vi.mocked(fsPromises.readFile).mockResolvedValue("v2");
    const second = await memoryService.getAutoMemoryContent("/w");
    expect(second).toBe("v2");
    expect(fsPromises.readFile).toHaveBeenCalledTimes(2);
  });
});

describe("MessageManager — stable memory and rules dedup", () => {
  let messageManager: MessageManager;
  let mockMemoryService: { getCombinedMemoryContent: ReturnType<typeof vi.fn> };
  let mockMemoryRuleManager: { getActiveRules: ReturnType<typeof vi.fn> };
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();

    mockMemoryService = {
      getCombinedMemoryContent: vi.fn().mockResolvedValue("base memory"),
    };
    mockMemoryRuleManager = { getActiveRules: vi.fn().mockReturnValue([]) };

    const container = new Container();
    container.register(
      "MemoryService",
      mockMemoryService as unknown as Record<string, unknown>,
    );
    container.register(
      "MemoryRuleManager",
      mockMemoryRuleManager as unknown as Record<string, unknown>,
    );

    messageManager = new MessageManager(container, { callbacks: {}, workdir });
  });

  it("getStableMemory caches across calls", async () => {
    await messageManager.getStableMemory();
    await messageManager.getStableMemory();
    await messageManager.getStableMemory();

    expect(mockMemoryService.getCombinedMemoryContent).toHaveBeenCalledTimes(1);
  });

  it("getActiveRulesContent returns content on first call", () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1", scope: { path: "src/**" } },
    ]);
    messageManager.touchFile("src/index.ts");

    expect(messageManager.getActiveRulesContent()).toBe("Rule 1");
  });

  it("getActiveRulesContent deduplicates on repeated call", () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1", scope: { path: "src/**" } },
    ]);
    messageManager.touchFile("src/index.ts");

    expect(messageManager.getActiveRulesContent()).toBe("Rule 1");
    expect(messageManager.getActiveRulesContent()).toBe("");
  });

  it("getActiveRulesContent returns new content when rules change", () => {
    mockMemoryRuleManager.getActiveRules
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        { id: "rule-2", content: "Rule 2", scope: { path: "lib/**" } },
      ]);

    expect(messageManager.getActiveRulesContent()).toBe("");

    messageManager.touchFile("lib/utils.ts");

    expect(messageManager.getActiveRulesContent()).toBe("Rule 2");
  });

  it("clearMemoryCache resets both caches", async () => {
    await messageManager.getStableMemory();
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Rule 1", scope: { path: "**" } },
    ]);
    messageManager.touchFile("file.ts");
    messageManager.getActiveRulesContent();

    messageManager.clearMemoryCache();

    mockMemoryService.getCombinedMemoryContent.mockResolvedValue("new memory");
    expect(await messageManager.getStableMemory()).toBe("new memory");
    expect(mockMemoryService.getCombinedMemoryContent).toHaveBeenCalledTimes(2);

    expect(messageManager.getActiveRulesContent()).toBe("Rule 1");
  });

  it("getCombinedMemory composes stable + active rules", async () => {
    mockMemoryRuleManager.getActiveRules.mockReturnValue([
      { id: "rule-1", content: "Active rule", scope: { path: "**" } },
    ]);
    messageManager.touchFile("file.ts");

    const combined = await messageManager.getCombinedMemory();
    expect(combined).toContain("base memory");
    expect(combined).toContain("Active rule");
  });

  it("getActiveRulesContent returns empty without memoryRuleManager", () => {
    const container = new Container();
    container.register(
      "MemoryService",
      mockMemoryService as unknown as Record<string, unknown>,
    );

    const mm = new MessageManager(container, { callbacks: {}, workdir });
    expect(mm.getActiveRulesContent()).toBe("");
  });
});
