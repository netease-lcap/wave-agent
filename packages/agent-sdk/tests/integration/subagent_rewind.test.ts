import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { FileSnapshot } from "../../src/types/reversion.js";
import type { BackgroundTask } from "../../src/types/processes.js";

vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

describe("Subagent Rewind Support", () => {
  let parentMessageManager: MessageManager;
  let subagentManager: SubagentManager;
  let backgroundTaskManager: BackgroundTaskManager;
  const workdir = "/tmp/test-rewind";

  beforeEach(async () => {
    vi.clearAllMocks();

    backgroundTaskManager = new BackgroundTaskManager({ workdir });

    parentMessageManager = new MessageManager({
      callbacks: {
        onSubagentTaskStopRequested: (subagentId) => {
          backgroundTaskManager.stopTask(subagentId);
        },
      },
      workdir,
    });

    subagentManager = new SubagentManager({
      workdir,
      parentToolManager: new ToolManager({
        mcpManager: {} as unknown as McpManager,
      }),
      parentMessageManager,
      backgroundTaskManager,
      taskManager: {} as unknown as TaskManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "http://localhost" }),
      getModelConfig: () => ({ agentModel: "test", fastModel: "test" }),
      getMaxInputTokens: () => 1000,
      getLanguage: () => undefined,
    });

    await subagentManager.initialize();
  });

  it("should forward file history from subagent to parent", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "test-subagent",
      description: "test",
      systemPrompt: "test",
      tools: [],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "test",
      prompt: "test",
      subagent_type: "test-subagent",
    });

    const snapshots: FileSnapshot[] = [
      {
        messageId: "msg-1",
        filePath: "test.txt",
        timestamp: Date.now(),
        operation: "modify",
      },
    ];

    // Trigger file history in subagent
    instance.messageManager.addAssistantMessage("making changes");
    instance.messageManager.addFileHistoryBlock(snapshots);

    // Verify parent received it
    const parentMessages = parentMessageManager.getMessages();
    const lastMessage = parentMessages[parentMessages.length - 1];
    const fileHistoryBlock = lastMessage.blocks.find(
      (b) => b.type === "file_history",
    );

    expect(fileHistoryBlock).toBeDefined();
    if (fileHistoryBlock && fileHistoryBlock.type === "file_history") {
      expect(fileHistoryBlock.snapshots).toEqual(snapshots);
    }
  });

  it("should stop background subagent task when its initiating message is rewound", async () => {
    const subagentId = "test-subagent-id";
    const mockConfig: SubagentConfiguration = {
      name: "test-subagent",
      description: "test",
      systemPrompt: "test",
      tools: [],
      model: "inherit",
      filePath: "/tmp/test.md",
      scope: "project",
      priority: 1,
    };

    // 1. Add a subagent block to parent messages
    parentMessageManager.addAssistantMessage("Starting subagent");
    parentMessageManager.addSubagentBlock(
      subagentId,
      "test-subagent",
      "session-1",
      mockConfig,
      "active",
      { description: "test", prompt: "test", subagent_type: "test" },
      true, // runInBackground
    );

    // 2. Manually add a running task to backgroundTaskManager to simulate a running subagent
    const stopSpy = vi.fn();
    backgroundTaskManager.addTask({
      id: subagentId,
      type: "subagent",
      status: "running",
      description: "test",
      startTime: Date.now(),
      onStop: stopSpy,
    } as unknown as BackgroundTask);

    expect(backgroundTaskManager.getTask(subagentId)?.status).toBe("running");

    // 3. Truncate history to before the subagent block (index 0 is the assistant message)
    // The subagent block is in the last message (index 0)
    await parentMessageManager.truncateHistory(0);

    // 4. Verify task was stopped
    expect(backgroundTaskManager.getTask(subagentId)?.status).toBe("killed");
    expect(stopSpy).toHaveBeenCalled();
  });
});
