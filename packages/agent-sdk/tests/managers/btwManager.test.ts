import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { BtwManager } from "../../src/managers/btwManager.js";
import { Container } from "../../src/utils/container.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";

// Mock MessageManager and AIManager
vi.mock("../../src/managers/messageManager.js", () => {
  return {
    MessageManager: vi.fn().mockImplementation(function (this: {
      setMessages: Mock;
      getMessages: Mock;
      addUserMessage: Mock;
      addUsage: Mock;
      addErrorBlock: Mock;
    }) {
      this.setMessages = vi.fn();
      this.getMessages = vi.fn().mockReturnValue([]);
      this.addUserMessage = vi.fn();
      this.addUsage = vi.fn();
      this.addErrorBlock = vi.fn();
    }),
  };
});

vi.mock("../../src/managers/aiManager.js", () => {
  return {
    AIManager: vi.fn().mockImplementation(function (this: {
      sendAIMessage: Mock;
    }) {
      this.sendAIMessage = vi.fn().mockResolvedValue(undefined);
    }),
  };
});

describe("BtwManager", () => {
  let btwManager: BtwManager;
  let container: Container;
  let mockMainMessageManager: {
    getMessages: Mock;
    addUsage: Mock;
  };
  const workdir = "/mock/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();

    mockMainMessageManager = {
      getMessages: vi
        .fn()
        .mockReturnValue([{ role: "user", content: "main context" }]),
      addUsage: vi.fn(),
    };

    container.register("MessageManager", mockMainMessageManager);
    container.register("AgentOptions", { callbacks: {}, stream: true });

    btwManager = new BtwManager(container, workdir);
  });

  it("should create a new side agent instance if none exists", async () => {
    const subagentId = await btwManager.btw("What is this?");

    expect(subagentId).toBeDefined();
    expect(MessageManager).toHaveBeenCalled();
    expect(AIManager).toHaveBeenCalled();

    const sideMessageManager = vi.mocked(MessageManager).mock.results[0].value;
    expect(sideMessageManager.setMessages).toHaveBeenCalledWith(
      mockMainMessageManager.getMessages(),
    );

    expect(sideMessageManager.addUserMessage).toHaveBeenCalledWith({
      content: "What is this?",
    });

    const sideAiManager = vi.mocked(AIManager).mock.results[0].value;
    expect(sideAiManager.sendAIMessage).toHaveBeenCalledWith({ tools: [] });
  });

  it("should reuse existing side agent instance", async () => {
    await btwManager.btw("First question");
    const firstCallCount = vi.mocked(MessageManager).mock.calls.length;

    await btwManager.btw("Second question");
    expect(vi.mocked(MessageManager).mock.calls.length).toBe(firstCallCount);

    const sideMessageManager = vi.mocked(MessageManager).mock.results[0].value;
    expect(sideMessageManager.addUserMessage).toHaveBeenCalledWith({
      content: "Second question",
    });
  });

  it("should correctly identify side agent ID", async () => {
    const subagentId = await btwManager.btw("Question");

    expect(btwManager.isSideAgent(subagentId)).toBe(true);
    expect(btwManager.isSideAgent("other-agent")).toBe(false);
  });

  it("should clear side agent on dismiss", async () => {
    const subagentId = await btwManager.btw("Question");
    expect(btwManager.isSideAgent(subagentId)).toBe(true);

    btwManager.dismiss();
    expect(btwManager.isSideAgent(subagentId)).toBe(false);

    await btwManager.btw("New question");
    expect(vi.mocked(MessageManager).mock.calls.length).toBe(2);
  });
});
