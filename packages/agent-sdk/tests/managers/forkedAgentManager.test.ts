import { describe, it, expect, vi, beforeEach } from "vitest";
import { ForkedAgentManager } from "@/managers/forkedAgentManager.js";
import { Container } from "@/utils/container.js";
import type { Message } from "@/types/index.js";
import {
  SubagentManager,
  type SubagentInstance,
} from "@/managers/subagentManager.js";
import type { AIManager } from "@/managers/aiManager.js";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

vi.mock("@/managers/subagentManager.js");
vi.mock("@/managers/aiManager.js");

const mockWriteStreamFactory = () => ({
  write: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
});

vi.mock("fs", () => ({
  createWriteStream: vi.fn(() => mockWriteStreamFactory()),
}));

vi.mock("os", () => ({
  tmpdir: vi.fn(() => "/tmp"),
}));

describe("ForkedAgentManager", () => {
  let container: Container;
  let forkedAgentManager: ForkedAgentManager;
  let mockSubagentManager: {
    findSubagent: ReturnType<typeof vi.fn>;
    createInstance: ReturnType<typeof vi.fn>;
    executeAgent: ReturnType<typeof vi.fn>;
  };
  const mockMessages = [
    { role: "user", blocks: [{ type: "text", content: "hello" }] },
  ] as Message[];
  const mockParameters = { description: "fork test" };
  const mockPrompt = "extract memory";

  function createMockInstance(): SubagentInstance {
    return {
      subagentId: `test-subagent-${Math.random()}`,
      configuration: {
        name: "general-purpose",
        description: "test",
        tools: [],
        systemPrompt: "test",
        filePath: "/test.md",
        scope: "builtin",
        priority: 3,
      },
      aiManager: {
        abortAIMessage: vi.fn(),
      } as unknown as AIManager,
      messageManager: {
        setMessages: vi.fn(),
      } as unknown as import("@/managers/messageManager.js").MessageManager,
      toolManager:
        {} as unknown as import("@/managers/toolManager.js").ToolManager,
      status: "active",
      messages: [],
      lastTools: [],
      subagentType: "general-purpose",
      description: "",
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();

    mockSubagentManager = {
      findSubagent: vi.fn().mockResolvedValue({
        name: "general-purpose",
        description: "test",
        tools: [],
        systemPrompt: "test",
        filePath: "/test.md",
        scope: "builtin",
        priority: 3,
      }),
      createInstance: vi
        .fn()
        .mockImplementation(async () => createMockInstance()),
      executeAgent: vi.fn().mockResolvedValue("extracted memory content"),
    };

    container.register(
      "SubagentManager",
      mockSubagentManager as unknown as SubagentManager,
    );

    forkedAgentManager = new ForkedAgentManager(container);
  });

  it("should create a forked agent with history and run it async", async () => {
    const id = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    expect(id).toBeTypeOf("string");

    // Fire-and-forget: entry exists but execution is async
    const activeForks = forkedAgentManager.getActiveForks();
    expect(activeForks).toHaveLength(1);
    expect(activeForks[0].id).toBe(id);
    expect(activeForks[0].status).toBe("running");

    await vi.waitFor(() => {
      expect(mockSubagentManager.findSubagent).toHaveBeenCalledWith(
        "general-purpose",
      );
      expect(mockSubagentManager.createInstance).toHaveBeenCalled();
      expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
        expect.objectContaining({ subagentId: expect.any(String) }),
        mockPrompt,
        undefined,
        false,
      );
    });
  });

  it("should return immediately (non-blocking to caller)", async () => {
    const id = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    // Should have returned with an ID immediately
    expect(id).toBeTypeOf("string");
    // Agent is still running at this point
    expect(forkedAgentManager.getActiveForks()[0].status).toBe("running");
  });

  it("should NOT call BackgroundTaskManager", async () => {
    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );
    // Wait for executeAgent to be called
    await vi.waitFor(() => {
      expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
        false,
      );
    });
  });

  it("should create a log file at os.tmpdir()/wave-forked-agent-<id>.log", async () => {
    const id = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    const expectedLogPath = path.join(
      os.tmpdir(),
      `wave-forked-agent-${id}.log`,
    );
    expect(fs.createWriteStream).toHaveBeenCalledWith(expectedLogPath, {
      flags: "a",
    });
  });

  it("should update task status to completed on success", async () => {
    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    await vi.waitFor(() => {
      expect(forkedAgentManager.getActiveForks()[0].status).toBe("completed");
    });
    const stream = vi.mocked(fs.createWriteStream).mock.results[0].value;
    expect(stream.write).toHaveBeenCalledWith(
      expect.stringContaining("Final response"),
    );
    expect(stream.end).toHaveBeenCalled();
  });

  it("should update task status to failed on error", async () => {
    mockSubagentManager.executeAgent.mockRejectedValueOnce(
      new Error("exec error"),
    );

    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    await vi.waitFor(() => {
      expect(forkedAgentManager.getActiveForks()[0].status).toBe("failed");
    });
    const stream = vi.mocked(fs.createWriteStream).mock.results[0].value;
    expect(stream.write).toHaveBeenCalledWith(
      expect.stringContaining("Agent failed: exec error"),
    );
    expect(stream.end).toHaveBeenCalled();
  });

  it("stop() should abort a running forked agent and clean up", async () => {
    const id = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    // Wait for the instance to be created (fire-and-forget async)
    await vi.waitFor(() => {
      const fork = forkedAgentManager.getActiveForks().find((f) => f.id === id);
      expect(fork?.instance?.subagentId).toBeTruthy();
    });

    forkedAgentManager.stop(id);

    const createdInstance =
      await mockSubagentManager.createInstance.mock.results[0].value;
    expect(createdInstance.aiManager.abortAIMessage).toHaveBeenCalled();
    const stream = vi.mocked(fs.createWriteStream).mock.results[0].value;
    expect(stream.destroy).toHaveBeenCalled();
    expect(forkedAgentManager.getActiveForks()).toHaveLength(0);
  });

  it("cleanup() should stop all running agents and clear the map", async () => {
    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );
    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    // Wait for both instances to be created
    await vi.waitFor(() => {
      expect(mockSubagentManager.createInstance).toHaveBeenCalledTimes(2);
    });

    forkedAgentManager.cleanup();

    // Two separate instances, each with its own abortAIMessage
    const instance1 =
      await mockSubagentManager.createInstance.mock.results[0].value;
    const instance2 =
      await mockSubagentManager.createInstance.mock.results[1].value;
    expect(instance1.aiManager.abortAIMessage).toHaveBeenCalled();
    expect(instance2.aiManager.abortAIMessage).toHaveBeenCalled();

    expect(forkedAgentManager.getActiveForks()).toHaveLength(0);
  });

  it("multiple forked agents can run concurrently independently", async () => {
    const id1 = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );
    const id2 = await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      mockParameters,
      mockPrompt,
    );

    expect(forkedAgentManager.getActiveForks()).toHaveLength(2);

    forkedAgentManager.stop(id1);
    expect(forkedAgentManager.getActiveForks()).toHaveLength(1);
    expect(forkedAgentManager.getActiveForks()[0].id).toBe(id2);
  });

  it("should pass maxTurns through forkAndExecute to createInstance", async () => {
    await forkedAgentManager.forkAndExecute(
      "general-purpose",
      mockMessages,
      { ...mockParameters, maxTurns: 5 },
      mockPrompt,
    );

    await vi.waitFor(() => {
      expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxTurns: 5 }),
        false,
      );
    });
  });
});
