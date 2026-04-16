import { describe, it, expect } from "vitest";
import {
  taskNotificationToXml,
  parseTaskNotificationXml,
} from "../../src/utils/notificationXml.js";
import type { TaskNotificationBlock } from "../../src/types/messaging.js";

describe("notificationXml", () => {
  describe("taskNotificationToXml", () => {
    it("should generate XML without outputFile", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_123",
        taskType: "shell",
        status: "completed",
        summary: "Task done",
      };

      const xml = taskNotificationToXml(block);

      expect(xml).toContain("<task-id>task_123</task-id>");
      expect(xml).toContain("<task-type>shell</task-type>");
      expect(xml).not.toContain("<output-file>");
      expect(xml).toContain("<status>completed</status>");
      expect(xml).toContain("<summary>Task done</summary>");
    });

    it("should generate XML with outputFile", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_456",
        taskType: "agent",
        status: "completed",
        summary: "Agent done",
        outputFile: "/tmp/output.log",
      };

      const xml = taskNotificationToXml(block);

      expect(xml).toContain("<task-id>task_456</task-id>");
      expect(xml).toContain("<task-type>agent</task-type>");
      expect(xml).toContain("<output-file>/tmp/output.log</output-file>");
      expect(xml).toContain("<status>completed</status>");
      expect(xml).toContain("<summary>Agent done</summary>");
    });
  });

  describe("parseTaskNotificationXml", () => {
    it("should parse XML without outputFile", () => {
      const xml = `<task-notification>
<task-id>task_123</task-id>
<task-type>shell</task-type>
<status>completed</status>
<summary>Task done</summary>
</task-notification>`;

      const result = parseTaskNotificationXml(xml);

      expect(result).toEqual({
        type: "task_notification",
        taskId: "task_123",
        taskType: "shell",
        status: "completed",
        summary: "Task done",
      });
    });

    it("should parse XML with outputFile", () => {
      const xml = `<task-notification>
<task-id>task_456</task-id>
<task-type>agent</task-type>
<output-file>/tmp/output.log</output-file>
<status>failed</status>
<summary>Error occurred</summary>
</task-notification>`;

      const result = parseTaskNotificationXml(xml);

      expect(result).toEqual({
        type: "task_notification",
        taskId: "task_456",
        taskType: "agent",
        status: "failed",
        summary: "Error occurred",
        outputFile: "/tmp/output.log",
      });
    });

    it("should return null for missing required fields", () => {
      const xml = `<task-notification>
<task-id>task_123</task-id>
</task-notification>`;

      const result = parseTaskNotificationXml(xml);

      expect(result).toBeNull();
    });

    it("should return null for malformed XML", () => {
      const result = parseTaskNotificationXml("not xml");

      expect(result).toBeNull();
    });
  });
});
