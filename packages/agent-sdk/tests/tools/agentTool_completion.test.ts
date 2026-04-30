import { describe, it, expect, vi, beforeEach } from "vitest";
import { agentTool } from "../../src/tools/agentTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { ToolContext } from "../../src/tools/types.js";
import { Container } from "../../src/utils/container.js";

// Mock the subagent manager
vi.mock("../../src/managers/subagentManager.js");

describe("Agent Tool Completion shortResult", () => {
  let mockSubagentManager: SubagentManager;
  const mockToolContext: ToolContext = {
    abortSignal: new AbortController().signal,
    workdir: "/test/workdir",
    taskManager: new TaskManager(new Container(), "test-session"),
  };

  const gpConfig: SubagentConfiguration = {
    name: "general-purpose",
    description: "General-purpose agent",
    systemPrompt: "You are an agent...",
    model: "fastModel",
    filePath: "<builtin:general-purpose>",
    scope: "builtin",
    priority: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock subagent manager
    mockSubagentManager = {
      getConfigurations: vi.fn(() => [gpConfig]),
      findSubagent: vi.fn(),
      createInstance: vi.fn(),
      executeAgent: vi.fn(),
      cleanupInstance: vi.fn(),
    } as unknown as SubagentManager;

    // Set the mock manager in the context
    mockToolContext.subagentManager = mockSubagentManager;
  });

  it("should include tool count and tokens in shortResult on completion", async () => {
    const mockInstance = {
      subagentId: "gp-test-id",
      usedTools: [],
      messageManager: {
        getMessages: vi.fn(() => [
          { blocks: [{ type: "tool" }, { type: "tool" }] },
          { blocks: [{ type: "tool" }] },
        ]),
        getLatestTotalTokens: vi.fn(() => 1234),
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
      mockInstance as unknown as SubagentInstance,
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue("done");

    const result = await agentTool.execute(
      {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "general-purpose",
      },
      mockToolContext,
    );

    expect(result.success).toBe(true);
    expect(result.shortResult).toBe("Agent completed (3 tools | 1,234 tokens)");
  });

  it("should show only tool count if tokens is 0", async () => {
    const mockInstance = {
      subagentId: "gp-test-id",
      usedTools: [],
      messageManager: {
        getMessages: vi.fn(() => [{ blocks: [{ type: "tool" }] }]),
        getLatestTotalTokens: vi.fn(() => 0),
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
      mockInstance as unknown as SubagentInstance,
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue("done");

    const result = await agentTool.execute(
      {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "general-purpose",
      },
      mockToolContext,
    );

    expect(result.shortResult).toBe("Agent completed (1 tools)");
  });

  it("should show only 'Agent completed' if tool count is 0", async () => {
    const mockInstance = {
      subagentId: "gp-test-id",
      usedTools: [],
      messageManager: {
        getMessages: vi.fn(() => []),
        getLatestTotalTokens: vi.fn(() => 0),
      },
    };

    vi.mocked(mockSubagentManager.findSubagent).mockResolvedValue(gpConfig);
    vi.mocked(mockSubagentManager.createInstance).mockResolvedValue(
      mockInstance as unknown as SubagentInstance,
    );
    vi.mocked(mockSubagentManager.executeAgent).mockResolvedValue("done");

    const result = await agentTool.execute(
      {
        description: "Test task",
        prompt: "Test prompt",
        subagent_type: "general-purpose",
      },
      mockToolContext,
    );

    expect(result.shortResult).toBe("Agent completed");
  });
});
