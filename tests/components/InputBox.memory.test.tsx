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

describe("InputBox Memory Functionality", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should not show memory mode UI when input starts with #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # - should not show memory mode UI
    stdin.write("#");
    await delay(10);

    const output = lastFrame();
    // Should not show memory mode UI anymore
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).toContain("#");
  });

  it("should trigger memory type selector when sending message that starts with #", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // Type memory content (character by character to avoid paste detection)
    const text = "# remember this";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    // Send message
    stdin.write("\r"); // Enter key
    await delay(100);

    // Should trigger memory type selector, not send normal message
    expect(mockFunctions.sendMessage).not.toHaveBeenCalled();

    // Should show memory type selector
    const output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("remember this");
    expect(output).toContain("Project Memory");
    expect(output).toContain("User Memory");
  });

  it("should send pasted #text as normal message when it contains newlines", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin } = render(<InputBox />);

    // 一口气输入包含换行的#文本（模拟粘贴操作）
    const pastedText = "#这是多行\n记忆内容";
    stdin.write(pastedText);
    await delay(50); // 等待粘贴debounce处理完成

    // 发送消息
    stdin.write("\r"); // Enter key
    await delay(100);

    // 验证 sendMessage 被调用，因为包含换行符
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("#这是多行\n记忆内容");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isBashCommand: false,
    });
  });

  it("should send single line #text to memory type selector", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 逐字符输入单行记忆内容
    const memoryText = "# important note";
    for (const char of memoryText) {
      stdin.write(char);
      await delay(5);
    }

    // 发送消息
    stdin.write("\r"); // Enter key
    await delay(100);

    // 应该触发记忆类型选择器，而不是发送消息
    expect(mockFunctions.sendMessage).not.toHaveBeenCalled();

    // 应该显示记忆类型选择器
    const output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("important note");
    expect(output).toContain("Project Memory");
    expect(output).toContain("User Memory");
  });

  it("should save memory when selecting memory type", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // Type memory content (character by character)
    const text = "# test memory";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    // Send message to trigger memory type selector
    stdin.write("\r"); // Enter key
    await delay(10);

    // Verify memory type selector is shown
    let output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("test memory");

    // Select project memory (press Enter, defaults to first option)
    stdin.write("\r");
    await delay(100);

    // Verify saveMemory was called
    expect(mockFunctions.saveMemory).toHaveBeenCalledWith(
      "# test memory",
      "project",
    );

    // Verify input box is cleared
    output = lastFrame();
    expect(output).toContain("Type your message");
  });

  it("should clear input after saving memory", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // Type memory content (character by character)
    const text = "# another memory";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    // Send message to trigger memory type selector
    stdin.write("\r"); // Enter key
    await delay(10);

    // Select user memory (press down arrow, then Enter)
    stdin.write("\u001B[B"); // Down arrow to select user memory
    await delay(10);
    stdin.write("\r"); // Enter to select
    await delay(100);

    // Verify saveMemory was called
    expect(mockFunctions.saveMemory).toHaveBeenCalledWith(
      "# another memory",
      "user",
    );

    // Verify input box is cleared and shows normal placeholder
    const output = lastFrame();
    expect(output).toContain("Type your message");
  });
});
