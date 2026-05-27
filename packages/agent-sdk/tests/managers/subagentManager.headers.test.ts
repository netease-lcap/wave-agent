import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import type { AgentOptions } from "../../src/types/agent.js";

vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([
    {
      name: "test-agent",
      description: "Test agent",
      systemPrompt: "You are a test agent",
      tools: [],
      model: "test-model",
    },
  ]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/managers/messageManager.js", () => ({
  MessageManager: vi.fn().mockImplementation(function () {
    return {
      addUserMessage: vi.fn(),
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "done" }] },
        ]),
    };
  }),
}));

vi.mock("../../src/managers/toolManager.js", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return {
      initializeBuiltInTools: vi.fn(),
    };
  }),
}));

vi.mock("../../src/services/configurationService.js", () => ({
  ConfigurationService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("../../src/managers/permissionManager.js", () => ({
  PermissionManager: vi.fn().mockImplementation(function () {
    return {
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue(["agent"]),
      getInstanceDeniedRules: vi.fn().mockReturnValue([]),
      getInstanceAllowedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("ask"),
      addTemporaryRules: vi.fn(),
    };
  }),
}));

// Capture the child container from AIManager constructor
let capturedContainer: Container | undefined;

vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function (container: Container) {
    capturedContainer = container;
    return {
      abortAIMessage: vi.fn(),
      sendAIMessage: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

function getSubagentDefaultHeaders(): Record<string, string> | undefined {
  if (!capturedContainer) return undefined;
  const opts = capturedContainer.get<AgentOptions>("AgentOptions");
  return opts?.defaultHeaders;
}

describe("SubagentManager subagentHeaders", () => {
  let container: Container;
  let subagentManager: SubagentManager;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContainer = undefined;
    container = new Container();
    container.register("ToolManager", {
      initializeBuiltInTools: vi.fn(),
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
  });

  it("should merge subagentHeaders into subagent defaultHeaders", async () => {
    const parentOptions: AgentOptions = {
      defaultHeaders: { "X-Agent-Type": "main" },
      subagentHeaders: {
        Explore: { "X-Subagent-Type": "Explore" },
      },
    };
    container.register("AgentOptions", parentOptions);

    const config = (await subagentManager.loadConfigurations())[0];
    await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Explore something",
      subagent_type: "Explore",
    });

    const headers = getSubagentDefaultHeaders();
    expect(headers).toEqual({
      "X-Agent-Type": "main",
      "X-Subagent-Type": "Explore",
    });
  });

  it("should not affect main agent defaultHeaders", async () => {
    const parentOptions: AgentOptions = {
      defaultHeaders: { "X-Agent-Type": "main" },
      subagentHeaders: {
        Explore: { "X-Subagent-Type": "Explore" },
      },
    };
    container.register("AgentOptions", parentOptions);

    // Parent options should not be modified
    expect(parentOptions.defaultHeaders).toEqual({ "X-Agent-Type": "main" });
  });

  it("should override parent defaultHeaders with subagentHeaders", async () => {
    const parentOptions: AgentOptions = {
      defaultHeaders: { "X-Shared": "base" },
      subagentHeaders: {
        Explore: { "X-Shared": "explore-override" },
      },
    };
    container.register("AgentOptions", parentOptions);

    const config = (await subagentManager.loadConfigurations())[0];
    await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Explore something",
      subagent_type: "Explore",
    });

    const headers = getSubagentDefaultHeaders();
    expect(headers).toEqual({ "X-Shared": "explore-override" });
  });

  it("should not add extra headers for unknown subagent type", async () => {
    const parentOptions: AgentOptions = {
      defaultHeaders: { "X-Shared": "base" },
      subagentHeaders: {
        Explore: { "X-Subagent-Type": "Explore" },
      },
    };
    container.register("AgentOptions", parentOptions);

    const config = (await subagentManager.loadConfigurations())[0];
    await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Plan something",
      subagent_type: "Plan",
    });

    // Plan is not in subagentHeaders, so subagent should only get parent defaultHeaders
    const headers = getSubagentDefaultHeaders();
    expect(headers).toEqual({ "X-Shared": "base" });
  });

  it("should make merged headers available for customFetch", async () => {
    const parentOptions: AgentOptions = {
      defaultHeaders: { "X-Agent-Type": "main" },
      subagentHeaders: {
        Explore: {
          "X-Agent-Type": "subagent",
          "X-Subagent-Type": "Explore",
        },
      },
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    };
    container.register("AgentOptions", parentOptions);

    const config = (await subagentManager.loadConfigurations())[0];
    await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Explore something",
      subagent_type: "Explore",
    });

    // Verify subagent's defaultHeaders are merged correctly
    const headers = getSubagentDefaultHeaders();
    expect(headers).toEqual({
      "X-Agent-Type": "subagent",
      "X-Subagent-Type": "Explore",
    });

    // customFetch is passed through to subagent options
    const opts = capturedContainer?.get<AgentOptions>("AgentOptions");
    expect(opts?.fetch).toBe(parentOptions.fetch);
  });
});
