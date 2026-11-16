import { describe, it, expect } from "vitest";
import {
  MAX_TASK_NOTIFICATION_CHARS,
  capTaskNotification,
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

    it("should generate XML with an optional result field", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_789",
        taskType: "agent",
        status: "completed",
        summary: "Background task done",
        result: "The findings are in /tmp/report.md",
      };

      const xml = taskNotificationToXml(block);

      expect(xml).toContain(
        "<result>The findings are in /tmp/report.md</result>",
      );
    });

    it("should omit the result tag when result is absent", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_789",
        taskType: "agent",
        status: "failed",
        summary: "Background task failed",
      };

      const xml = taskNotificationToXml(block);

      expect(xml).not.toContain("<result>");
    });

    it("should render usage when the task reported it", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_900",
        taskType: "agent",
        status: "completed",
        summary: "Agent done",
        usage: { totalTokens: 1234, toolUses: 5, durationMs: 6789 },
      };

      const xml = taskNotificationToXml(block);

      expect(xml).toContain(
        "<usage><subagent_tokens>1234</subagent_tokens>" +
          "<tool_uses>5</tool_uses><duration_ms>6789</duration_ms></usage>",
      );
    });

    it("should omit usage when the task did not report it", () => {
      const block: TaskNotificationBlock = {
        type: "task_notification",
        taskId: "task_901",
        taskType: "shell",
        status: "completed",
        summary: "Shell done",
      };

      expect(taskNotificationToXml(block)).not.toContain("<usage>");
    });
  });

  describe("capTaskNotification", () => {
    it("should leave a notification under the ceiling untouched", () => {
      const xml = taskNotificationToXml({
        type: "task_notification",
        taskId: "task_1",
        taskType: "agent",
        status: "completed",
        summary: "Agent done",
        result: "short answer",
      });

      expect(capTaskNotification(xml)).toBe(xml);
    });

    it("should keep the identity tags and the closing summary of an oversized one", () => {
      const head = "h".repeat(60_000);
      const tail = "t".repeat(60_000);
      const xml = `<task-notification>\n<task-id>task_big</task-id>\n<result>${head}${tail}</result>\n<status>completed</status>\n<summary>Agent done</summary>\n</task-notification>`;

      const capped = capTaskNotification(xml);

      expect(capped.length).toBeLessThan(xml.length);
      expect(capped).toContain("<task-id>task_big</task-id>");
      expect(capped).toContain("<summary>Agent done</summary>");
      expect(capped).toContain("</task-notification>");
      expect(capped).toMatch(/\[truncated \d+ characters\]/);
    });

    it("should never exceed the ceiling by more than the marker", () => {
      const xml = `<task-notification>${"x".repeat(MAX_TASK_NOTIFICATION_CHARS * 2)}</task-notification>`;
      const capped = capTaskNotification(xml);
      const marker = capped.match(/\[truncated \d+ characters\]/)?.[0] ?? "";

      expect(capped.length - marker.length - 2).toBe(
        MAX_TASK_NOTIFICATION_CHARS,
      );
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

    it("should parse XML with a result field", () => {
      const xml = `<task-notification>
<task-id>task_789</task-id>
<task-type>agent</task-type>
<status>completed</status>
<summary>Background task done</summary>
<result>The findings are in /tmp/report.md</result>
</task-notification>`;

      const result = parseTaskNotificationXml(xml);

      expect(result).toEqual({
        type: "task_notification",
        taskId: "task_789",
        taskType: "agent",
        status: "completed",
        summary: "Background task done",
        result: "The findings are in /tmp/report.md",
      });
    });

    it("should parse the usage section", () => {
      const xml = `<task-notification>
<task-id>task_900</task-id>
<task-type>agent</task-type>
<status>completed</status>
<summary>Agent done</summary>
<usage><subagent_tokens>1234</subagent_tokens><tool_uses>5</tool_uses><duration_ms>6789</duration_ms></usage>
</task-notification>`;

      const result = parseTaskNotificationXml(xml);

      expect(result?.usage).toEqual({
        totalTokens: 1234,
        toolUses: 5,
        durationMs: 6789,
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
