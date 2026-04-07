import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "@/managers/subagentManager.js";
import { Container } from "@/utils/container.js";
import type { Message } from "@/types/index.js";
import type { ToolManager } from "@/managers/toolManager.js";
import type { SubagentConfiguration } from "@/utils/subagentParser.js";
import { MessageManager } from "@/managers/messageManager.js";

vi.mock("@/managers/messageManager.js");
vi.mock("@/managers/aiManager.js");
vi.mock("@/managers/toolManager.js");
vi.mock("@/managers/permissionManager.js", () => {
  class PermissionManager {
    getConfiguredPermissionMode = vi.fn();
    getAllowedRules = vi.fn();
    getDeniedRules = vi.fn();
    addTemporaryRules = vi.fn();
  }
  return { PermissionManager };
});

describe("SubagentManager.forkAgent", () => {
  let container: Container;
  let subagentManager: SubagentManager;
  let mockToolManager: {
    initializeBuiltInTools: ReturnType<typeof vi.fn>;
    getTools: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    container = new Container();
    mockToolManager = {
      initializeBuiltInTools: vi.fn(),
      getTools: vi.fn().mockReturnValue([]),
    };
    container.register(
      "ToolManager",
      mockToolManager as unknown as ToolManager,
    );

    subagentManager = new SubagentManager(container, {
      workdir: "/workdir",
      stream: false,
    });

    // Mock MessageManager to return messages from getMessages
    vi.mocked(MessageManager).prototype.getMessages = vi
      .fn()
      .mockImplementation(function (this: { messages?: Message[] }) {
        return this.messages || [];
      });
    vi.mocked(MessageManager).prototype.setMessages = vi
      .fn()
      .mockImplementation(function (
        this: { messages?: Message[] },
        msgs: Message[],
      ) {
        this.messages = msgs;
      });

    // Mock findSubagent
    vi.spyOn(subagentManager, "findSubagent").mockResolvedValue({
      name: "general-purpose",
      description: "test",
      tools: [],
      systemPrompt: "test",
      filePath: "/test.md",
      scope: "builtin",
      priority: 3,
    } as SubagentConfiguration);
  });

  it("should create a forked agent with history", async () => {
    const messages = [{ role: "user", content: "hello" } as unknown as Message];
    const parameters = { description: "fork test" };

    const instance = await subagentManager.forkAgent(
      "general-purpose",
      messages,
      parameters,
    );

    expect(instance.description).toBe("fork test");
    expect(instance.subagentType).toBe("general-purpose");
    // Verify that setMessages was called on the isolated messageManager
    expect(instance.messageManager.getMessages()).toEqual(
      expect.arrayContaining(messages),
    );
  });
});
