import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { ConfigurationService } from "../../src/services/configurationService.js";

function mockConfigurationService(defaultMode: string) {
  vi.mocked(ConfigurationService).mockImplementationOnce(function () {
    return {
      loadMergedConfiguration: vi.fn().mockResolvedValue({
        success: true,
        configuration: {
          permissions: {
            defaultMode,
          },
        },
      }),
      setOptions: vi.fn(),
      setTurnSnapshotSource: vi.fn(),
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
      resolveTelemetryConfig: vi.fn().mockReturnValue(undefined),
    } as unknown as ConfigurationService;
  });
}

vi.mock("../../src/services/configurationService.js", () => ({
  ConfigurationService: vi.fn(),
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(function () {
    return {
      getUserMemoryContent: vi.fn().mockResolvedValue(""),
      ensureUserMemoryFile: vi.fn().mockResolvedValue(undefined),
      readMemoryFile: vi.fn().mockResolvedValue(""),
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    };
  }),
}));

vi.mock("node:fs/promises", () => {
  const mockedFs = {
    mkdir: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
    access: vi.fn().mockRejectedValue(new Error("ENOENT")),
  };
  return { default: mockedFs, ...mockedFs };
});

function readBypassAuthorization(agent: Agent): boolean {
  return (
    agent as unknown as {
      permissionManager: { getBypassAuthorization: () => boolean };
    }
  ).permissionManager.getBypassAuthorization();
}

describe("Agent session bypass authorization", () => {
  const workdir = "/test/workdir";
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("authorizes a session created with defaultMode bypassPermissions", async () => {
    mockConfigurationService("bypassPermissions");
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    expect(agent.getPermissionMode()).toBe("bypassPermissions");
    expect(readBypassAuthorization(agent)).toBe(true);
  });

  it("keeps the authorization after switching to plan mode", async () => {
    mockConfigurationService("bypassPermissions");
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    agent.setPermissionMode("plan");

    expect(agent.getPermissionMode()).toBe("plan");
    expect(readBypassAuthorization(agent)).toBe(true);
  });

  it("does not authorize a session created with defaultMode default", async () => {
    mockConfigurationService("default");
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    expect(agent.getPermissionMode()).toBe("default");
    expect(readBypassAuthorization(agent)).toBe(false);
  });

  it("does not authorize a session that switches to bypassPermissions mid-session", async () => {
    mockConfigurationService("default");
    const agent = await Agent.create({ workdir });
    activeAgent = agent;

    agent.setPermissionMode("bypassPermissions");

    expect(agent.getPermissionMode()).toBe("bypassPermissions");
    expect(readBypassAuthorization(agent)).toBe(false);
  });
});
