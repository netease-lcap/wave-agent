import type { TaskNotificationBlock } from "../types/messaging.js";

export function taskNotificationToXml(block: TaskNotificationBlock): string {
  let xml = `<task-notification>\n`;
  xml += `<task-id>${block.taskId}</task-id>\n`;
  xml += `<task-type>${block.taskType}</task-type>\n`;
  if (block.outputFile) {
    xml += `<output-file>${block.outputFile}</output-file>\n`;
  }
  if (block.result) {
    xml += `<result>${block.result}</result>\n`;
  }
  xml += `<status>${block.status}</status>\n`;
  xml += `<summary>${block.summary}</summary>\n`;
  if (block.usage) {
    xml += `<usage>`;
    xml += `<subagent_tokens>${block.usage.totalTokens}</subagent_tokens>`;
    xml += `<tool_uses>${block.usage.toolUses}</tool_uses>`;
    xml += `<duration_ms>${block.usage.durationMs}</duration_ms>`;
    xml += `</usage>\n`;
  }
  xml += `</task-notification>`;
  return xml;
}

/**
 * A task notification is a message the model reads, so a chatty subagent must
 * not be able to flood the parent's context with one. Past the ceiling the
 * middle is dropped and the head and tail are kept — the markup around a
 * subagent's answer travels in the middle, while the opening identity tags and
 * the closing `<summary>`/`</task-notification>` are what consumers read.
 */
export const MAX_TASK_NOTIFICATION_CHARS = 100_000;

export function capTaskNotification(xml: string): string {
  if (xml.length <= MAX_TASK_NOTIFICATION_CHARS) return xml;
  const head = Math.floor(MAX_TASK_NOTIFICATION_CHARS / 2);
  const tail = MAX_TASK_NOTIFICATION_CHARS - head;
  const omitted = xml.length - MAX_TASK_NOTIFICATION_CHARS;
  return `${xml.slice(0, head)}\n[truncated ${omitted} characters]\n${xml.slice(-tail)}`;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

function parseUsage(
  xml: string,
): { totalTokens: number; toolUses: number; durationMs: number } | undefined {
  const raw = ["subagent_tokens", "tool_uses", "duration_ms"].map((tag) =>
    extractTag(xml, tag),
  );
  if (raw.some((value) => value === null)) return undefined;
  const [totalTokens, toolUses, durationMs] = raw.map(Number);
  if (![totalTokens, toolUses, durationMs].every(Number.isFinite)) {
    return undefined;
  }
  return { totalTokens, toolUses, durationMs };
}

export function parseTaskNotificationXml(
  xml: string,
): TaskNotificationBlock | null {
  try {
    const taskId = extractTag(xml, "task-id");
    const taskType = extractTag(xml, "task-type") as
      | "shell"
      | "agent"
      | "workflow"
      | "hook"
      | null;
    const status = extractTag(xml, "status") as
      | "completed"
      | "failed"
      | "killed"
      | "aborted"
      | null;
    const summary = extractTag(xml, "summary");

    if (!taskId || !taskType || !status || !summary) {
      return null;
    }

    const outputFile = extractTag(xml, "output-file") || undefined;
    const result = extractTag(xml, "result") || undefined;
    const usage = parseUsage(xml);

    return {
      type: "task_notification",
      taskId,
      taskType,
      status,
      summary,
      ...(outputFile && { outputFile }),
      ...(result && { result }),
      ...(usage && { usage }),
    };
  } catch {
    return null;
  }
}
