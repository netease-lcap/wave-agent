import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { ConfigurationService } from "../../src/services/configurationService.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// Mock ConfigurationService
vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: vi.fn().mockImplementation(function () {
      return {
        loadMergedConfiguration: vi.fn().mockResolvedValue({
          success: true,
          configuration: {
            permissions: {
              permissionMode: "plan",
            },
          },
        }),
        setOptions: vi.fn(),
        resolveGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://test.api",
        }),
        resolveModelConfig: vi.fn().mockReturnValue({
          model: "test-model",
          fastModel: "test-fast-model",
        }),
        resolveMaxInputTokens: vi.fn().mockReturnValue(100000),
        getEnvironmentVars: vi.fn().mockReturnValue({}),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      };
    }),
  };
});

// Mock memory
const mockMemoryServiceInstance = {
  getUserMemoryContent: vi.fn().mockResolvedValue(""),
  ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
  readMemoryFile: vi.fn().mockResolvedValue(""),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
  getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
  ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
  getAutoMemoryContent: vi.fn().mockResolvedValue(""),
};

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return mockMemoryServiceInstance;
  }),
}));

// Mock fs/promises
vi.mock("node:fs/promises", () => {
  return {
    default: {
      mkdir: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(""),
      access: vi.fn().mockRejectedValue(new Error("ENOENT")),
    },
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
  };
});

describe("Agent Plan Mode Default", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    mockMemoryServiceInstance.getUserMemoryContent.mockResolvedValue("");
    mockMemoryServiceInstance.readMemoryFile.mockResolvedValue("");
  });

  it("should generate plan file path when default mode is plan in configuration", async () => {
    const agent = await Agent.create({ workdir });

    // Wait for async plan file path generation
    // We need to wait because the callback is async and not awaited in initialize
    let planFilePath: string | undefined;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      planFilePath = agent.getPlanFilePath();
      if (planFilePath) break;
    }

    expect(agent.getPermissionMode()).toBe("plan");
    expect(planFilePath).toBeDefined();
    expect(planFilePath).toContain(path.join(os.homedir(), ".wave", "plans"));
    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(os.homedir(), ".wave", "plans"),
      { recursive: true },
    );
  });

  it("should NOT generate plan file path when default mode is NOT plan in configuration", async () => {
    // Override mock for this test
    const { ConfigurationService } = await import(
      "../../src/services/configurationService.js"
    );
    vi.mocked(ConfigurationService).mockImplementationOnce(function () {
      return {
        loadMergedConfiguration: vi.fn().mockResolvedValue({
          success: true,
          configuration: {
            permissions: {
              permissionMode: "default",
            },
          },
        }),
        setOptions: vi.fn(),
        resolveGatewayConfig: vi.fn().mockReturnValue({
          apiKey: "test-key",
          baseURL: "https://test.api",
        }),
        resolveModelConfig: vi.fn().mockReturnValue({
          model: "test-model",
          fastModel: "test-fast-model",
        }),
        resolveMaxInputTokens: vi.fn().mockReturnValue(100000),
        getEnvironmentVars: vi.fn().mockReturnValue({}),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      } as unknown as ConfigurationService;
    });

    const agent = await Agent.create({ workdir });

    expect(agent.getPermissionMode()).toBe("default");
    expect(agent.getPlanFilePath()).toBeUndefined();
    // fs.mkdir might be called for memory directory, but not for plans directory
    const calls = vi.mocked(fs.mkdir).mock.calls;
    const plansDirCall = calls.find((call) =>
      (call[0] as string).includes("plans"),
    );
    expect(plansDirCall).toBeUndefined();
  });
});
