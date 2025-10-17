import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Complete Slash Command Flow", () => {
  let mockExecuteSlashCommand: ReturnType<typeof vi.fn>;
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
    mockExecuteSlashCommand = vi.fn();
    mockHasSlashCommand = vi.fn();
    mockSendMessage = vi.fn();
    vi.clearAllMocks();
  });

  it("should complete the full workflow: type partial command -> select from dropdown -> execute -> clear input", async () => {
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
    expect(mockExecuteSlashCommand).toHaveBeenCalledWith("/git-commit");
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Step 6: 验证输入框被清空并返回初始状态
    const finalFrame = lastFrame();
    expect(finalFrame).toContain("Type your message");
    expect(finalFrame).not.toContain("Command Selector");
    expect(finalFrame).not.toContain("/git");
  });

  it("should work with direct command typing and execution", async () => {
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

    // 直接输入完整命令
    stdin.write("/git-commit some arguments");
    await delay(50);

    expect(lastFrame()).toContain("/git-commit some arguments");

    // 按回车执行
    stdin.write("\r");
    await delay(100);

    // 验证命令执行
    expect(mockExecuteSlashCommand).toHaveBeenCalledWith(
      "/git-commit some arguments",
    );
    expect(mockSendMessage).not.toHaveBeenCalled();

    // 验证输入框被清空
    expect(lastFrame()).toContain("Type your message");
  });
});
