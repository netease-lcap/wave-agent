import type { TaskNotificationBlock } from "../types/messaging.js";

export function taskNotificationToXml(block: TaskNotificationBlock): string {
  let xml = `<task-notification>\n`;
  xml += `<task-id>${block.taskId}</task-id>\n`;
  xml += `<task-type>${block.taskType}</task-type>\n`;
  if (block.outputFile) {
    xml += `<output-file>${block.outputFile}</output-file>\n`;
  }
  xml += `<status>${block.status}</status>\n`;
  xml += `<summary>${block.summary}</summary>\n`;
  xml += `</task-notification>`;
  return xml;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>(.*?)</${tag}>`, "s");
  const match = xml.match(regex);
  return match ? match[1] : null;
}

export function parseTaskNotificationXml(
  xml: string,
): TaskNotificationBlock | null {
  try {
    const taskId = extractTag(xml, "task-id");
    const taskType = extractTag(xml, "task-type") as "shell" | "agent" | null;
    const status = extractTag(xml, "status") as
      | "completed"
      | "failed"
      | "killed"
      | null;
    const summary = extractTag(xml, "summary");

    if (!taskId || !taskType || !status || !summary) {
      return null;
    }

    const outputFile = extractTag(xml, "output-file") || undefined;

    return {
      type: "task_notification",
      taskId,
      taskType,
      status,
      summary,
      ...(outputFile && { outputFile }),
    };
  } catch {
    return null;
  }
}
