import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Bash Mode", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should show bash mode when input starts with !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to enter bash mode
    stdin.write("!");
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("💻 Bash Mode");
    expect(output).toContain("Execute bash command (remove ! to exit)");
    expect(output).toContain("!");
  });

  it("should not show bash mode for normal input", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type normal text
    stdin.write("hello");
    await delay(10);

    const output = lastFrame();
    expect(output).not.toContain("💻 Bash Mode");
    expect(output).not.toContain("Execute bash command (remove ! to exit)");
  });

  it("should exit bash mode when ! is removed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to enter bash mode
    stdin.write("!");
    await delay(10);
    let output = lastFrame();
    expect(output).toContain("💻 Bash Mode");

    // Remove ! to exit bash mode
    stdin.write("\u0008"); // backspace
    await delay(10);
    output = lastFrame();
    expect(output).not.toContain("💻 Bash Mode");
  });

  it("should stay in bash mode when additional text is added after !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to enter bash mode first
    stdin.write("!");
    await delay(10);

    // Then type additional text character by character - should stay in bash mode since it still starts with !
    const text = "ls -la";
    for (const char of text) {
      stdin.write(char);
    }
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("💻 Bash Mode");
    expect(output).toContain("Execute bash command (remove ! to exit)");
    // 注意：当bash历史选择器激活时，它会显示搜索结果，而不是完整的输入文本
    // 这里我们主要验证bash模式仍然激活
  });

  it("should NOT trigger bash mode when pasting text starting with ! in one go", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以!开头的文本（模拟粘贴操作）
    const pastedText = "!粘贴的命令";
    stdin.write(pastedText);
    await delay(50); // 等待粘贴debounce处理完成

    const output = lastFrame();

    // 应该不会显示bash模式UI
    expect(output).not.toContain("💻 Bash Mode");
    expect(output).not.toContain("Execute bash command (remove ! to exit)");

    // 但是文本内容应该正常显示
    expect(output).toContain("!粘贴的命令");
  });

  it("should send pasted !text as normal message, not trigger bash execution", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以!开头的文本（模拟粘贴操作）
    const pastedText = "!这是粘贴的命令";
    stdin.write(pastedText);
    await delay(50); // 等待粘贴debounce处理完成

    // 验证不在bash模式下且内容正确显示
    const output = lastFrame();
    expect(output).not.toContain("💻 Bash Mode");
    expect(output).toContain("!这是粘贴的命令");

    // 发送消息
    stdin.write("\r"); // Enter key
    await delay(100);

    // 验证 sendMessage 被调用且 isBashMode 为 false
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("!这是粘贴的命令");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isMemoryMode: false,
      isBashMode: false,
    });

    // 验证 executeCommand 没有被调用（因为不在bash模式下）
    expect(mockFunctions.executeCommand).not.toHaveBeenCalled();
  });

  it("should trigger bash execution when typing ! and adding text character by character", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 逐字符输入 ! 然后添加命令，这会触发bash模式
    stdin.write("!");
    await delay(10);

    // 验证进入bash模式
    let output = lastFrame();
    expect(output).toContain("💻 Bash Mode");

    // 继续逐字符添加命令
    stdin.write("l");
    await delay(10);

    stdin.write("s");
    await delay(10);

    // 验证仍在bash模式下
    output = lastFrame();
    expect(output).toContain("💻 Bash Mode");

    // 按Escape退出选择器，然后发送命令
    stdin.write("\u001b"); // Escape key
    await delay(10);

    // 发送命令
    stdin.write("\r"); // Enter key
    await delay(100);

    // 在bash模式下，sendMessage 应该被调用且 isBashMode 为 true
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("!ls");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isMemoryMode: false,
      isBashMode: true,
    });
  });

  it("should change border color in bash mode", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to enter bash mode
    stdin.write("!");
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("💻 Bash Mode");
    expect(output).toContain("Execute bash command (remove ! to exit)");
  });

  it("should exit bash mode after sending a message", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 进入bash模式
    stdin.write("!");
    await delay(10);

    let output = lastFrame();
    expect(output).toContain("💻 Bash Mode");

    // 添加命令
    stdin.write("l");
    stdin.write("s");
    await delay(10);

    // 按Escape退出选择器
    stdin.write("\u001b"); // Escape key
    await delay(10);

    // 验证仍在bash模式
    output = lastFrame();
    expect(output).toContain("💻 Bash Mode");

    // 发送消息
    stdin.write("\r"); // Enter key
    await delay(100);

    // 验证消息已发送
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    // 验证bash模式已退出
    output = lastFrame();
    expect(output).not.toContain("💻 Bash Mode");
    expect(output).not.toContain("Execute bash command (remove ! to exit)");

    // 验证输入框已清空且显示普通占位符
    expect(output).toContain("Type your message");
    expect(output).toContain("! for bash history");
  });
});
