import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors, MessageSource } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";

describe("RewindCommand Content", () => {
  it("should display text content", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [{ type: "text", content: "Hello world" }],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("Hello world");
    });
  });

  it("should display slash command content as text", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          {
            type: "text",
            content: "/settings theme dark",
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("/settings theme dark");
    });
  });

  it("should exclude bang command messages", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          {
            type: "bang",
            command: "ls -la",
            output: "",
            stage: "end" as const,
            exitCode: 0,
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      // bang 命令消息是系统执行结果，不作为回滚点
      expect(output).not.toContain("!ls -la");
      expect(output).toContain("No user messages found to rewind to.");
    });
  });

  it("should exclude task notifications and hook-injected messages", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [{ type: "text", content: "real input" }],
      },
      {
        id: "2",
        role: "user",
        blocks: [
          {
            type: "task_notification",
            taskId: "t1",
            taskType: "shell",
            status: "completed",
            summary: "后台任务完成",
          },
        ],
      },
      {
        id: "3",
        role: "user",
        blocks: [
          { type: "text", content: "hook 输出", source: MessageSource.HOOK },
        ],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("real input");
      expect(output).not.toContain("hook 输出");
      // 后台通知没有文本内容，过滤后不应出现"(No text content)"占位条目
      expect(output).not.toContain("(No text content)");
    });
  });

  it("should dedupe user messages by id after compaction", async () => {
    // 压缩 append-only 后磁盘完整线程保留压缩前历史 + 压缩后 append 的重复消息
    //（同 id 同内容）。CLI 只应展示每个用户消息一次。
    const mockMessages: Partial<Message>[] = [
      {
        id: "u1",
        role: "user",
        blocks: [{ type: "text", content: "one" }],
      },
      {
        id: "a1",
        role: "assistant",
        blocks: [{ type: "text", content: "hi1" }],
      },
      {
        id: "u2",
        role: "user",
        blocks: [{ type: "text", content: "two" }],
      },
      {
        id: "a2",
        role: "assistant",
        blocks: [{ type: "text", content: "hi2" }],
      },
      {
        id: "u3",
        role: "user",
        blocks: [{ type: "text", content: "three" }],
      },
      {
        id: "a3",
        role: "assistant",
        blocks: [{ type: "text", content: "hi3" }],
      },
      {
        id: "c1",
        role: "assistant",
        blocks: [{ type: "compact", content: "summary" }],
      },
      {
        id: "u2",
        role: "user",
        blocks: [{ type: "text", content: "two" }],
      },
      {
        id: "a2",
        role: "assistant",
        blocks: [{ type: "text", content: "hi2" }],
      },
      {
        id: "u3",
        role: "user",
        blocks: [{ type: "text", content: "three" }],
      },
      {
        id: "a3",
        role: "assistant",
        blocks: [{ type: "text", content: "hi3" }],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("one");
      expect(output).toContain("two");
      expect(output).toContain("three");
      // 重复 id 只渲染一次（出现两次说明压缩后重复没去重）
      const twoCount = output.split("two").length - 1;
      const threeCount = output.split("three").length - 1;
      expect(twoCount).toBe(1);
      expect(threeCount).toBe(1);
    });
  });
});
