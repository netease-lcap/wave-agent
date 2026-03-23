import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { BtwManager } from "../../src/managers/btwManager.js";
import { Container } from "../../src/utils/container.js";

describe("BtwManager", () => {
  let btwManager: BtwManager;
  let container: Container;
  let mockSubagentManager: {
    getInstance: Mock;
    loadConfigurations: Mock;
    createInstance: Mock;
    executeAgent: Mock;
  };
  let mockMainMessageManager: {
    getMessages: Mock;
  };

  beforeEach(() => {
    container = new Container();

    mockSubagentManager = {
      getInstance: vi.fn(),
      loadConfigurations: vi.fn().mockResolvedValue([{ name: "Explore" }]),
      createInstance: vi.fn().mockResolvedValue({
        subagentId: "side-agent-123",
        messageManager: {
          setMessages: vi.fn(),
        },
      }),
      executeAgent: vi.fn().mockResolvedValue("task-123"),
    };

    mockMainMessageManager = {
      getMessages: vi
        .fn()
        .mockReturnValue([{ role: "user", content: "main context" }]),
    };

    container.register("SubagentManager", mockSubagentManager);
    container.register("MessageManager", mockMainMessageManager);

    btwManager = new BtwManager(container);
  });

  it("should create a new side agent instance if none exists", async () => {
    const subagentId = await btwManager.btw("What is this?");

    expect(subagentId).toBe("side-agent-123");
    expect(mockSubagentManager.createInstance).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Explore" }),
      expect.objectContaining({
        description: "Side agent for /btw questions",
        prompt: "What is this?",
        subagent_type: "btw",
      }),
    );
    expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ subagentId: "side-agent-123" }),
      "What is this?",
      undefined,
      true,
    );
  });

  it("should reuse existing side agent instance if it is healthy", async () => {
    const mockInstance = {
      subagentId: "side-agent-123",
      status: "active",
      messageManager: { setMessages: vi.fn() },
    };

    // First call to set sideAgentId
    await btwManager.btw("First question");

    mockSubagentManager.getInstance.mockReturnValue(mockInstance);

    const subagentId = await btwManager.btw("Second question");

    expect(subagentId).toBe("side-agent-123");
    expect(mockSubagentManager.createInstance).toHaveBeenCalledTimes(1); // Only from first call
    expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
      mockInstance,
      "Second question",
      undefined,
      true,
    );
  });

  it("should create a new instance if existing one is errored", async () => {
    const mockErroredInstance = {
      subagentId: "side-agent-123",
      status: "error",
    };

    // First call to set sideAgentId
    await btwManager.btw("First question");

    mockSubagentManager.getInstance.mockReturnValue(mockErroredInstance);
    mockSubagentManager.createInstance.mockResolvedValue({
      subagentId: "side-agent-456",
      messageManager: { setMessages: vi.fn() },
    });

    const subagentId = await btwManager.btw("Second question");

    expect(subagentId).toBe("side-agent-456");
    expect(mockSubagentManager.createInstance).toHaveBeenCalledTimes(2);
  });

  it("should inherit context from main message manager when creating new instance", async () => {
    const mainMessages = [{ role: "user", content: "main context" }];
    mockMainMessageManager.getMessages.mockReturnValue(mainMessages);

    const mockSetMessages = vi.fn();
    mockSubagentManager.createInstance.mockResolvedValue({
      subagentId: "side-agent-123",
      messageManager: { setMessages: mockSetMessages },
    });

    await btwManager.btw("Question");

    expect(mockMainMessageManager.getMessages).toHaveBeenCalled();
    expect(mockSetMessages).toHaveBeenCalledWith(mainMessages);
  });

  it("should correctly identify side agent ID", async () => {
    await btwManager.btw("Question");

    expect(btwManager.isSideAgent("side-agent-123")).toBe(true);
    expect(btwManager.isSideAgent("other-agent")).toBe(false);
  });

  it("should clear side agent ID on dismiss", async () => {
    await btwManager.btw("Question");
    expect(btwManager.isSideAgent("side-agent-123")).toBe(true);

    btwManager.dismiss();
    expect(btwManager.isSideAgent("side-agent-123")).toBe(false);
  });

  it("should throw error if Explore configuration is not found", async () => {
    mockSubagentManager.loadConfigurations.mockResolvedValue([]);

    await expect(btwManager.btw("Question")).rejects.toThrow(
      "Explore subagent configuration not found",
    );
  });
});
