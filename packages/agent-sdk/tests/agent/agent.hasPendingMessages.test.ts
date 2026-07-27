import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/mcpManager.js");
vi.mock("../../src/managers/skillManager.js");
vi.mock("../../src/services/session.js");

interface MessageQueueHandle {
  enqueueNotification(xml: string): void;
  drainNotifications(): string[];
}

function getMessageQueue(agent: Agent): MessageQueueHandle {
  return (agent as unknown as { messageQueue: MessageQueueHandle })
    .messageQueue;
}

/**
 * Mark the main agent as mid-turn so dispatch does not immediately consume
 * enqueued notifications (mirrors the regression scenario where a background
 * task completes while the main agent is still processing a previous turn).
 */
function setMainAgentLoading(agent: Agent, isLoading: boolean): void {
  (
    agent as unknown as { aiManager: { isLoading: boolean } }
  ).aiManager.isLoading = isLoading;
}

const NOTIFICATION_XML = `<task-notification>
<task-id>t1</task-id>
<task-type>agent</task-type>
<status>completed</status>
<summary>Agent task done</summary>
</task-notification>`;

describe("Agent hasPendingMessages (print-mode wait condition)", () => {
  const workdir = "/test/workdir";
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([]);
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("is false by default", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    expect(agent.hasPendingMessages).toBe(false);
  });

  it("is true while a completion notification is queued behind a busy main agent", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    setMainAgentLoading(agent, true);
    getMessageQueue(agent).enqueueNotification(NOTIFICATION_XML);
    // Notification stays pending because the main agent is mid-turn, so
    // dispatch (which runs synchronously up to sendAIMessage) is blocked.
    expect(agent.hasPendingMessages).toBe(true);
  });

  it("is false again after queued notifications are drained", async () => {
    const agent = await Agent.create({ workdir });
    activeAgent = agent;
    const queue = getMessageQueue(agent);
    setMainAgentLoading(agent, true);
    queue.enqueueNotification(NOTIFICATION_XML);
    expect(agent.hasPendingMessages).toBe(true);
    queue.drainNotifications();
    expect(agent.hasPendingMessages).toBe(false);
  });
});
