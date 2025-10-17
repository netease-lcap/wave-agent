import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Slash Command Functionality", () => {
  let mockExecuteSlashCommand: ReturnType<typeof vi.fn>;
  let mockHasSlashCommand: ReturnType<typeof vi.fn>;
  let mockSendMessage: ReturnType<typeof vi.fn>;

  const testCommands: SlashCommand[] = [
    {
      id: "test-command",
      name: "test-command",
      description: "A test command",
      handler: () => {},
    },
    {
      id: "another-command",
      name: "another-command",
      description: "Another test command",
      handler: () => {},
    },
  ];

  beforeEach(() => {
    mockExecuteSlashCommand = vi.fn();
    mockHasSlashCommand = vi.fn();
    mockSendMessage = vi.fn();
    vi.clearAllMocks();
  });

  it("should show command selector when typing /", async () => {
    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // 输入 / 触发命令选择器
    stdin.write("/");
    await delay(50);

    const output = lastFrame();
    expect(output).toContain("Command Selector");
    expect(output).toContain("test-command");
    expect(output).toContain("another-command");
  });

  it("should filter commands when typing after /", async () => {
    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // 逐个字符输入 /test，避免被当作粘贴操作
    stdin.write("/");
    await delay(50);
    stdin.write("t");
    await delay(50);
    stdin.write("e");
    await delay(50);
    stdin.write("s");
    await delay(50);
    stdin.write("t");
    await delay(50);

    const output = lastFrame();
    expect(output).toContain("Command Selector");
    expect(output).toContain("test-command");
    expect(output).not.toContain("another-command");
  });

  it("should execute command and clear input when selected with Enter", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockExecuteSlashCommand.mockResolvedValue(true);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // 逐个字符输入 /test
    stdin.write("/");
    await delay(50);
    stdin.write("t");
    await delay(50);
    stdin.write("e");
    await delay(50);
    stdin.write("s");
    await delay(50);
    stdin.write("t");
    await delay(50);

    // 按回车选择第一个命令
    stdin.write("\r");
    await delay(100);

    // 验证命令被执行
    expect(mockHasSlashCommand).toHaveBeenCalledWith("test-command");
    expect(mockExecuteSlashCommand).toHaveBeenCalledWith("/test-command");

    // 验证输入框被清空（不应该再有任何输入内容）
    const output = lastFrame();
    expect(output).toContain("Type your message"); // 应该显示占位符

    // 验证没有发送普通消息
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("should not send as message after successful slash command execution", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockExecuteSlashCommand.mockResolvedValue(true);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // 输入完整的斜杠命令
    stdin.write("/test-command with args");
    await delay(50);

    // 直接按回车执行命令
    stdin.write("\r");
    await delay(100);

    // 验证命令被执行
    expect(mockExecuteSlashCommand).toHaveBeenCalledWith(
      "/test-command with args",
    );

    // 验证输入框被清空
    const output = lastFrame();
    expect(output).toContain("Type your message");

    // 验证没有发送普通消息
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("should send as message if command execution fails", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockExecuteSlashCommand.mockResolvedValue(false); // 命令执行失败

    const { stdin } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // 输入斜杠命令
    stdin.write("/test-command");
    await delay(50);

    // 按回车
    stdin.write("\r");
    await delay(100);

    // 验证命令被尝试执行
    expect(mockExecuteSlashCommand).toHaveBeenCalledWith("/test-command");

    // 由于命令执行失败，应该作为普通消息发送
    expect(mockSendMessage).toHaveBeenCalledWith("/test-command", undefined);
  });

  it("should insert command with Tab and allow adding arguments", async () => {
    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        executeSlashCommand={mockExecuteSlashCommand}
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // 逐个字符输入 /test
    stdin.write("/");
    await delay(50);
    stdin.write("t");
    await delay(50);
    stdin.write("e");
    await delay(50);
    stdin.write("s");
    await delay(50);
    stdin.write("t");
    await delay(50);

    // 按 Tab 插入命令
    stdin.write("\t");
    await delay(50);

    // 验证命令被插入且可以继续输入参数
    const output = lastFrame();
    expect(output).toContain("/test-command ");
    expect(output).not.toContain("Command Selector"); // 选择器应该关闭

    // 继续输入参数
    stdin.write("arg1 arg2");
    await delay(50);

    const finalOutput = lastFrame();
    expect(finalOutput).toContain("/test-command arg1 arg2");
  });
});
