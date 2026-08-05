import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import type { ConfigurationService } from "@/services/configurationService.js";

// Mock the toolManager
const { instance: mockToolManagerInstance } = createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock memory manager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn().mockImplementation(function () {
    return {
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
    };
  }),
}));

// Mock custom commands loader to avoid FS access
vi.mock("@/utils/customCommands", () => ({
  loadCustomSlashCommands: vi.fn().mockReturnValue([]),
}));

describe("Agent - additional directories", () => {
  let agent: Agent;

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  async function createAgent(options: Record<string, unknown> = {}) {
    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-add-dir",
      ...options,
    });
    return agent;
  }

  it("should include AgentOptions additionalDirectories in getAdditionalDirectories", async () => {
    const a = await createAgent({
      additionalDirectories: ["/tmp/test-add-dir/config"],
    });

    expect(a.getAdditionalDirectories()).toContain("/tmp/test-add-dir/config");
  });

  it("should add a directory session-level via addAdditionalDirectory", async () => {
    const a = await createAgent();

    await a.addAdditionalDirectory("/tmp/shared");

    expect(a.getAdditionalDirectories()).toContain("/tmp/shared");
  });

  it("should not persist when remember is false", async () => {
    const a = await createAgent();
    const configService = (
      a as unknown as { configurationService: ConfigurationService }
    ).configurationService;
    const spy = vi.spyOn(configService, "addAdditionalDirectory");

    await a.addAdditionalDirectory("/tmp/session-only", { remember: false });

    expect(spy).not.toHaveBeenCalled();
    expect(a.getAdditionalDirectories()).toContain("/tmp/session-only");
  });

  it("should persist via configurationService when remember is true", async () => {
    const a = await createAgent();
    const configService = (
      a as unknown as { configurationService: ConfigurationService }
    ).configurationService;
    const spy = vi.spyOn(configService, "addAdditionalDirectory");

    await a.addAdditionalDirectory("/tmp/persisted", { remember: true });

    expect(spy).toHaveBeenCalledWith("/tmp/test-add-dir", "/tmp/persisted");
    expect(a.getAdditionalDirectories()).toContain("/tmp/persisted");
  });
});
