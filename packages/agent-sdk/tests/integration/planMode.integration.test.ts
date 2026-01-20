import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock os.homedir BEFORE importing anything else
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => "/home/user",
    default: {
      ...actual,
      homedir: () => "/home/user",
    },
  };
});

import { Agent } from "../../src/agent.js";
import fs from "node:fs/promises";
import path from "node:path";
import { callAgent } from "../../src/services/aiService.js";

vi.mock("node:fs/promises");
vi.mock("../../src/services/aiService.js");

describe("Plan Mode Integration", () => {
  const workdir = "/test/workdir";
  const homedir = "/home/user";
  const planDir = path.join(homedir, ".wave", "plans");

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    process.env.WAVE_API_KEY = "test-key";
    process.env.WAVE_BASE_URL = "https://test.api";
  });

  it("should transition to plan mode and generate a plan file path", async () => {
    const agent = await Agent.create({ workdir });

    expect(agent.getPermissionMode()).toBe("default");

    // Transition to plan mode
    agent.setPermissionMode("plan");

    expect(agent.getPermissionMode()).toBe("plan");

    // Wait for async plan file path generation
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fs.mkdir).toHaveBeenCalledWith(planDir, { recursive: true });
  });

  it("should include plan reminder in system prompt when in plan mode", async () => {
    const agent = await Agent.create({ workdir });

    // Transition to plan mode and wait for path generation
    agent.setPermissionMode("plan");

    // Wait for async plan file path generation
    let planFilePath: string | undefined;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // @ts-expect-error - accessing private for testing
      planFilePath = agent.permissionManager.getPlanFilePath();
      if (planFilePath) break;
    }
    expect(planFilePath).toBeDefined();

    vi.mocked(callAgent).mockResolvedValue({
      content: "I will write a plan.",
      finish_reason: "stop",
    });

    // @ts-expect-error - accessing private for testing
    await agent.aiManager.sendAIMessage();

    // Check all calls to callAgent
    const calls = vi.mocked(callAgent).mock.calls;

    // In integration test, we want to see if the systemPrompt passed to callAgent contains the reminder
    const callWithPlanInfo = calls.find((call) => {
      const options = call[0];
      return (
        options.systemPrompt && options.systemPrompt.includes("Plan File Info")
      );
    });

    expect(callWithPlanInfo).toBeDefined();
    if (callWithPlanInfo) {
      expect(callWithPlanInfo[0].systemPrompt).toContain("Plan File Info");
      expect(callWithPlanInfo[0].systemPrompt).toContain(
        "No plan file exists yet",
      );
    }
  });

  it("should allow writing to the plan file but block other writes", async () => {
    const agent = await Agent.create({ workdir });

    // Transition to plan mode and wait for path generation
    agent.setPermissionMode("plan");

    // Wait for async plan file path generation
    let planFilePath: string | undefined;
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      // @ts-expect-error - accessing private for testing
      planFilePath = agent.permissionManager.getPlanFilePath();
      if (planFilePath) break;
    }
    expect(planFilePath).toBeDefined();

    // Mock AI calling a tool to write to a non-plan file
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        content: undefined,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "Write",
              arguments: JSON.stringify({
                file_path: "/test/workdir/src/index.ts",
                content: "malicious code",
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      })
      .mockResolvedValueOnce({
        content: "Done",
        finish_reason: "stop",
      });

    // @ts-expect-error - accessing private for testing
    await agent.aiManager.sendAIMessage();

    // The assistant message should contain the tool result indicating denial
    const messages = agent.messages;
    // Find the assistant message that contains the tool block
    const assistantMessage = messages.find(
      (m) => m.role === "assistant" && m.blocks?.some((b) => b.type === "tool"),
    );

    expect(assistantMessage).toBeDefined();
    const toolBlock = assistantMessage?.blocks?.find((b) => b.type === "tool");
    expect(toolBlock).toBeDefined();
    if (toolBlock && toolBlock.type === "tool") {
      // In integration test, the tool output is what we expect
      expect(String(toolBlock.result)).toContain(
        "only allowed to edit or delete the designated plan file",
      );
    }
  });
});
