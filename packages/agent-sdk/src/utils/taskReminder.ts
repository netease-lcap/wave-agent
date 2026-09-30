import type { Message, MessageBlock } from "../types/messaging.js";
import type { Task } from "../types/tasks.js";

export const TASK_REMINDER_CONFIG = {
  TURNS_SINCE_WRITE: 10,
  TURNS_BETWEEN_REMINDERS: 10,
};

const TASK_MANAGEMENT_TOOLS = new Set(["TaskCreate", "TaskUpdate"]);
const TASK_REMINDER_MARKER = "<!-- task-reminder -->";

/**
 * Whether this block is a task-management write.
 *
 * One question, two shapes. A flat `TaskUpdate` is a block of its own; a deferred
 * one is only reachable from the sandbox, so it leaves no block of its own and its
 * name rides on the `Exec` block that carried it (`ToolBlock.nestedToolCalls`, see
 * `docs/specs/core/exec-tool.md`). Both must reset the counter — reading only the
 * block name would let the reminder nag an agent that just updated its task list,
 * and would make the count depend on how the tool happened to be declared.
 */
function isTaskManagementWrite(block: MessageBlock): boolean {
  if (block.type !== "tool") return false;
  if (block.name && TASK_MANAGEMENT_TOOLS.has(block.name)) return true;
  return (block.nestedToolCalls ?? []).some((name) =>
    TASK_MANAGEMENT_TOOLS.has(name),
  );
}

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
        isTaskManagementWrite(block)
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
    "The task tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, consider using TaskCreate to add new tasks and TaskUpdate to update task status (set to in_progress when starting, completed when done). Also consider cleaning up the task list if it has become stale. Only use these if relevant to the current work. This is just a gentle reminder - ignore if not applicable. Make sure that you never mention this reminder to the user";

  if (tasks.length > 0) {
    text += "\n\nHere are the existing tasks:\n";
    for (const task of tasks) {
      text += `#${task.id} [${task.status}] ${task.subject}\n`;
    }
  }

  return text;
}

export function maybeInjectTaskReminder(
  turnCounts: {
    turnsSinceLastTaskManagement: number;
    turnsSinceLastReminder: number;
  },
  tasks: Task[],
): string | null {
  if (
    turnCounts.turnsSinceLastTaskManagement <
    TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE
  ) {
    return null;
  }
  if (
    turnCounts.turnsSinceLastReminder <
    TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
  ) {
    return null;
  }

  return buildTaskReminderText(tasks);
}
