import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { Logger } from "@/types/index.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry to control tool execution
const { instance: mockToolManagerInstance, execute: mockToolExecute } =
  createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent Backgrounding Recursion Tests", () => {
  let agent: Agent;

  beforeEach(async () => {
    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    const mockLogger: Logger = {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    // Create Agent instance
    agent = await Agent.create({
      callbacks: mockCallbacks,
      logger: mockLogger,
    });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should stop recursion when ALL tools are manually backgrounded", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    let aiServiceCallCount = 0;

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;
      if (aiServiceCallCount === 1) {
        return {
          tool_calls: [
            {
              id: "call_bg_1",
              type: "function" as const,
              index: 0,
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "sleep 100" }),
              },
            },
            {
              id: "call_bg_2",
              type: "function" as const,
              index: 1,
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "sleep 200" }),
              },
            },
          ],
        };
      }
      return { content: "Should not be called" };
    });

    // Mock tool execution to simulate manual backgrounding for BOTH tools
    mockToolExecute.mockImplementation(async () => {
      return {
        success: true,
        content: "Command moved to background",
        isManuallyBackgrounded: true,
      };
    });

    // Call sendMessage
    await agent.sendMessage("Run two long commands");

    // Verify AI service was called only once
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(aiServiceCallCount).toBe(1);
  });

  it("should NOT stop recursion when only SOME tools are manually backgrounded", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    let aiServiceCallCount = 0;

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;
      if (aiServiceCallCount === 1) {
        return {
          tool_calls: [
            {
              id: "call_bg",
              type: "function" as const,
              index: 0,
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "sleep 100" }),
              },
            },
            {
              id: "call_normal",
              type: "function" as const,
              index: 1,
              function: {
                name: "ls",
                arguments: JSON.stringify({ path: "." }),
              },
            },
          ],
        };
      }
      return { content: "Final response" };
    });

    // Mock tool execution: one backgrounded, one normal
    mockToolExecute.mockImplementation(async (name) => {
      if (name === "bash") {
        return {
          success: true,
          content: "Command moved to background",
          isManuallyBackgrounded: true,
        };
      }
      return {
        success: true,
        content: "file1.txt",
        isManuallyBackgrounded: false,
      };
    });

    // Call sendMessage
    await agent.sendMessage("Run one long and one short command");

    // Verify AI service was called twice (recursion continued)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);
  });
});
