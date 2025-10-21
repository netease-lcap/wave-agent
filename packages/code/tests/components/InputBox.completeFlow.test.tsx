import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Complete Slash Command Flow", () => {
  let mockHasSlashCommand: ReturnType<typeof vi.fn>;
  let mockSendMessage: ReturnType<typeof vi.fn>;

  const testCommands: SlashCommand[] = [
    {
      id: "git-commit",
      name: "git-commit",
      description: "Generate a git commit message",
      handler: () => {},
    },
    {
      id: "docs",
      name: "docs",
      description: "Generate documentation",
      handler: () => {},
    },
  ];

  beforeEach(() => {
    mockHasSlashCommand = vi.fn();
    mockSendMessage = vi.fn();
    vi.clearAllMocks();
  });

  it("should complete the full workflow: type partial command -> select from dropdown -> execute -> clear input", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Step 1: 初始状态应该显示占位符
    expect(lastFrame()).toContain("Type your message");

    // Step 2: 输入 "/" 激活命令选择器
    stdin.write("/");
    await delay(50);

    const afterSlashFrame = lastFrame();
    expect(afterSlashFrame).toContain("Command Selector");
    expect(afterSlashFrame).toContain("git-commit");
    expect(afterSlashFrame).toContain("docs");

    // Step 3: 输入 "git" 过滤命令
    stdin.write("git");
    await delay(50);

    const filteredFrame = lastFrame();
    expect(filteredFrame).toContain("git-commit");
    expect(filteredFrame).not.toContain("docs"); // docs 应该被过滤掉

    // Step 4: 按回车选择并执行命令
    stdin.write("\r");
    await delay(100);

    // Step 5: 验证命令被正确执行
    expect(mockHasSlashCommand).toHaveBeenCalledWith("git-commit");
    expect(mockSendMessage).toHaveBeenCalledWith("/git-commit");

    // Step 6: 验证输入框被清空并返回初始状态
    const finalFrame = lastFrame();
    expect(finalFrame).toContain("Type your message");
    expect(finalFrame).not.toContain("Command Selector");
    expect(finalFrame).not.toContain("/git");
  });

  it("should send slash command as message when typed directly", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // 直接输入完整命令
    stdin.write("/git-commit some arguments");
    await delay(50);

    expect(lastFrame()).toContain("/git-commit some arguments");

    // 按回车 - 这会作为普通消息发送，斜杠命令会在 sendMessage 内部处理
    stdin.write("\r");
    await delay(100);

    // 验证作为消息发送（斜杠命令处理现在在 sendMessage 内部）
    expect(mockSendMessage).toHaveBeenCalledWith(
      "/git-commit some arguments",
      undefined,
    );

    // 验证输入框被清空
    expect(lastFrame()).toContain("Type your message");
  });
});
