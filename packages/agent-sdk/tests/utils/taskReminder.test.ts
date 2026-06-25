import { describe, it, expect } from "vitest";
import {
  getTaskReminderTurnCounts,
  buildTaskReminderText,
  maybeInjectTaskReminder,
  TASK_REMINDER_CONFIG,
} from "../../src/utils/taskReminder.js";
import type {
  Message,
  MessageBlock,
  ToolBlock,
} from "../../src/types/messaging.js";
import type { Task } from "../../src/types/tasks.js";
import type { ChatCompletionMessageParam } from "openai/resources";

function makeAssistantMessage(
  opts: { blocks?: MessageBlock[]; isMeta?: boolean } = {},
): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "assistant",
    blocks: opts.blocks ?? [{ type: "text", content: "response" }],
    timestamp: new Date().toISOString(),
    isMeta: opts.isMeta,
  };
}

function makeUserMessage(content: string): Message {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role: "user",
    blocks: [{ type: "text", content }],
    timestamp: new Date().toISOString(),
  };
}

function makeToolBlock(name: string): ToolBlock {
  return {
    type: "tool",
    name,
    stage: "end",
    success: true,
  };
}

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    subject: "Test task",
    description: "Test description",
    status: "pending",
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...overrides,
  };
}

describe("getTaskReminderTurnCounts", () => {
  it("returns 0 for task management when TaskCreate used in most recent message", () => {
    const messages: Message[] = [
      makeAssistantMessage(),
      makeAssistantMessage(),
      makeAssistantMessage(),
      makeAssistantMessage(),
      makeAssistantMessage({
        blocks: [{ type: "text", content: "ok" }, makeToolBlock("TaskCreate")],
      }),
    ];

    const result = getTaskReminderTurnCounts(messages);
    expect(result.turnsSinceLastTaskManagement).toBe(0);
  });

  it("counts 15 turns since last task management when no task tools used", () => {
    const messages: Message[] = Array.from({ length: 15 }, () =>
      makeAssistantMessage(),
    );

    const result = getTaskReminderTurnCounts(messages);
    expect(result.turnsSinceLastTaskManagement).toBe(15);
  });

  it("counts turns since last reminder marker correctly", () => {
    // 15 assistant messages with user messages interspersed
    // Put a reminder marker in a user message 5 assistant turns from the end
    const messages: Message[] = [];
    for (let i = 0; i < 15; i++) {
      messages.push(makeAssistantMessage());
      if (i === 9) {
        // After 10th assistant msg (index 9), before 11th
        // From the end: assistant turns at indices 14,13,12,11,10 = 5 turns
        // then we hit this user message with the marker
        messages.push(makeUserMessage("<!-- task-reminder -->\nReminder text"));
      }
    }

    const result = getTaskReminderTurnCounts(messages);
    expect(result.turnsSinceLastReminder).toBe(5);
  });

  it("handles empty messages array", () => {
    const result = getTaskReminderTurnCounts([]);
    expect(result.turnsSinceLastTaskManagement).toBe(0);
    expect(result.turnsSinceLastReminder).toBe(0);
  });

  it("ignores meta assistant messages", () => {
    const messages: Message[] = [
      makeAssistantMessage({ isMeta: true }),
      makeAssistantMessage({ isMeta: true }),
      makeAssistantMessage(),
    ];

    const result = getTaskReminderTurnCounts(messages);
    // Only 1 qualifying assistant turn
    expect(result.turnsSinceLastTaskManagement).toBe(1);
  });

  it("ignores reasoning-only assistant messages", () => {
    const messages: Message[] = [
      makeAssistantMessage({
        blocks: [{ type: "reasoning", content: "thinking" }],
      }),
      makeAssistantMessage(),
    ];

    const result = getTaskReminderTurnCounts(messages);
    // Only 1 qualifying assistant turn (the reasoning-only one doesn't count)
    expect(result.turnsSinceLastTaskManagement).toBe(1);
  });

  it("finds task tool in earlier message", () => {
    const messages: Message[] = [
      makeAssistantMessage({
        blocks: [{ type: "text", content: "ok" }, makeToolBlock("TaskUpdate")],
      }),
      makeAssistantMessage(),
      makeAssistantMessage(),
      makeAssistantMessage(),
    ];

    const result = getTaskReminderTurnCounts(messages);
    // TaskUpdate is in the earliest message; 3 assistant turns after it
    expect(result.turnsSinceLastTaskManagement).toBe(3);
  });
});

describe("buildTaskReminderText", () => {
  it("includes current task list content", () => {
    const tasks = [
      makeTask({ id: "1", subject: "Fix auth bug", status: "pending" }),
      makeTask({ id: "2", subject: "Add tests", status: "in_progress" }),
      makeTask({ id: "3", subject: "Update docs", status: "completed" }),
    ];

    const text = buildTaskReminderText(tasks);
    expect(text).toContain("<!-- task-reminder -->");
    expect(text).toContain("#1 [pending] Fix auth bug");
    expect(text).toContain("#2 [in_progress] Add tests");
    expect(text).toContain("#3 [completed] Update docs");
    expect(text).toContain("gentle reminder");
  });

  it("handles empty task list", () => {
    const text = buildTaskReminderText([]);
    expect(text).toContain("task list is currently empty");
    expect(text).toContain("<!-- task-reminder -->");
  });
});

describe("maybeInjectTaskReminder", () => {
  it("pushes message when thresholds are met", () => {
    const messages: ChatCompletionMessageParam[] = [];
    const turnCounts = {
      turnsSinceLastTaskManagement: TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE,
      turnsSinceLastReminder: TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS,
    };
    const tasks = [
      makeTask({ id: "1", subject: "Do something", status: "pending" }),
    ];

    maybeInjectTaskReminder(messages, turnCounts, tasks);

    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    const content =
      typeof messages[0].content === "string"
        ? messages[0].content
        : String(messages[0].content);
    expect(content).toContain("#1 [pending] Do something");
    expect(content).toContain("<!-- task-reminder -->");
  });

  it("does nothing when turnsSinceLastTaskManagement is below threshold", () => {
    const messages: ChatCompletionMessageParam[] = [];
    const turnCounts = {
      turnsSinceLastTaskManagement: TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE - 1,
      turnsSinceLastReminder: TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS,
    };

    maybeInjectTaskReminder(messages, turnCounts, []);
    expect(messages).toHaveLength(0);
  });

  it("does nothing when turnsSinceLastReminder is below threshold", () => {
    const messages: ChatCompletionMessageParam[] = [];
    const turnCounts = {
      turnsSinceLastTaskManagement: TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE,
      turnsSinceLastReminder: TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS - 1,
    };

    maybeInjectTaskReminder(messages, turnCounts, []);
    expect(messages).toHaveLength(0);
  });

  it("does nothing when both thresholds are below", () => {
    const messages: ChatCompletionMessageParam[] = [];
    const turnCounts = {
      turnsSinceLastTaskManagement: 0,
      turnsSinceLastReminder: 0,
    };

    maybeInjectTaskReminder(messages, turnCounts, []);
    expect(messages).toHaveLength(0);
  });
});
