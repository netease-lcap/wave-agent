import type { Message } from "../types/messaging.js";
import type { Task } from "../types/tasks.js";
import type { ChatCompletionMessageParam } from "openai/resources.js";

export const TASK_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
};

const TASK_MANAGEMENT_TOOLS = new Set([
  "TaskCreate",
  "TaskUpdate",
  "TaskList",
  "TaskGet",
]);
const TASK_REMINDER_MARKER = "<!-- task-reminder -->";

function isQualifyingAssistantMessage(message: Message): boolean {
  if (message.role !== "assistant") return false;
  if (message.isMeta) return false;
  return message.blocks.some((block) => block.type !== "reasoning");
}

export function getTaskReminderTurnCounts(messages: Message[]): {
  turnsSinceLastTaskManagement: number;
  turnsSinceLastReminder: number;
} {
  let assistantTurnCount = 0;
  let turnsSinceLastTaskManagement: number | undefined;
  let turnsSinceLastReminder: number | undefined;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    // Check blocks for task management tools and reminder markers
    for (const block of message.blocks) {
      if (
        turnsSinceLastTaskManagement === undefined &&
        block.type === "tool" &&
        block.name &&
        TASK_MANAGEMENT_TOOLS.has(block.name)
      ) {
        turnsSinceLastTaskManagement = assistantTurnCount;
      }
      if (
        turnsSinceLastReminder === undefined &&
        block.type === "text" &&
        block.content.includes(TASK_REMINDER_MARKER)
      ) {
        turnsSinceLastReminder = assistantTurnCount;
      }
    }

    if (isQualifyingAssistantMessage(message)) {
      assistantTurnCount++;
    }
  }

  return {
    turnsSinceLastTaskManagement:
      turnsSinceLastTaskManagement ?? assistantTurnCount,
    turnsSinceLastReminder: turnsSinceLastReminder ?? assistantTurnCount,
  };
}

export function buildTaskReminderText(tasks: Task[]): string {
  let text = `${TASK_REMINDER_MARKER}\n`;
  text +=
    "Here is a gentle reminder about the task list. The user may not have explicitly asked for the following to be done, but you should check the task list to see if any tasks need attention.\n";

  if (tasks.length > 0) {
    text += "\n";
    for (const task of tasks) {
      text += `#${task.id} [${task.status}] ${task.subject}\n`;
    }
  } else {
    text += "The task list is currently empty.\n";
  }

  return text;
}

export function maybeInjectTaskReminder(
  messages: ChatCompletionMessageParam[],
  turnCounts: {
    turnsSinceLastTaskManagement: number;
    turnsSinceLastReminder: number;
  },
  tasks: Task[],
): void {
  if (
    turnCounts.turnsSinceLastTaskManagement <
    TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE
  ) {
    return;
  }
  if (
    turnCounts.turnsSinceLastReminder <
    TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
  ) {
    return;
  }

  messages.push({
    role: "user",
    content: buildTaskReminderText(tasks),
  } as ChatCompletionMessageParam);
}
