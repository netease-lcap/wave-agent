import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { waitForText } from "tests/helpers/waitHelpers";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Memory Functionality", () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockSaveMemory: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSendMessage = vi.fn();
    mockSaveMemory = vi.fn();
  });

  it("should not show memory mode UI when input starts with #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # - should not show memory mode UI
    stdin.write("#");
    await waitForText(lastFrame, "#");

    const output = lastFrame();
    // Should not show memory mode UI anymore
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).toContain("#");
  });

  it("should trigger memory type selector when sending message that starts with #", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} saveMemory={mockSaveMemory} />,
    );

    // Type memory content (character by character to avoid paste detection)
    const text = "# remember this";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    await waitForText(lastFrame, "# remember this");

    // Send message
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Save Memory:");

    // Should trigger memory type selector, not send normal message
    expect(mockSendMessage).not.toHaveBeenCalled();

    // Should show memory type selector
    const output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("remember this");
    expect(output).toContain("Project Memory");
    expect(output).toContain("User Memory");
  });

  it("should send pasted #text as normal message when it contains newlines", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} saveMemory={mockSaveMemory} />,
    );

    // 一口气输入包含换行的#文本（模拟粘贴操作）
    const pastedText = "#这是多行\n记忆内容";
    stdin.write(pastedText);
    await waitForText(lastFrame, "#这是多行");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Type your message");

    // 验证 sendMessage 被调用，因为包含换行符
    expect(mockSendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("#这是多行\n记忆内容");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isBashCommand: false,
    });
  });

  it("should send single line #text to memory type selector", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} saveMemory={mockSaveMemory} />,
    );

    // 逐字符输入单行记忆内容
    const memoryText = "# important note";
    for (const char of memoryText) {
      stdin.write(char);
      await delay(5);
    }

    await waitForText(lastFrame, "# important note");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Save Memory:");

    // 应该触发记忆类型选择器，而不是发送消息
    expect(mockSendMessage).not.toHaveBeenCalled();

    // 应该显示记忆类型选择器
    const output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("important note");
    expect(output).toContain("Project Memory");
    expect(output).toContain("User Memory");
  });

  it("should save memory when selecting memory type", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} saveMemory={mockSaveMemory} />,
    );

    // Type memory content (character by character)
    const text = "# test memory";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    await waitForText(lastFrame, "# test memory");

    // Send message to trigger memory type selector
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Save Memory:");

    // Verify memory type selector is shown
    let output = lastFrame();
    expect(output).toContain("Save Memory:");
    expect(output).toContain("test memory");

    // Select project memory (press Enter, defaults to first option)
    stdin.write("\r");
    await waitForText(lastFrame, "Type your message");

    // Verify saveMemory was called
    expect(mockSaveMemory).toHaveBeenCalledWith("# test memory", "project");

    // Verify input box is cleared
    output = lastFrame();
    expect(output).toContain("Type your message");
  });

  it("should clear input after saving memory", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} saveMemory={mockSaveMemory} />,
    );

    // Type memory content (character by character)
    const text = "# another memory";
    for (const char of text) {
      stdin.write(char);
      await delay(5);
    }

    await waitForText(lastFrame, "# another memory");

    // Send message to trigger memory type selector
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Save Memory:");

    // Select user memory (press down arrow, then Enter)
    stdin.write("\u001B[B"); // Down arrow to select user memory
    await delay(10);
    stdin.write("\r"); // Enter to select
    await waitForText(lastFrame, "Type your message");

    // Verify saveMemory was called
    expect(mockSaveMemory).toHaveBeenCalledWith("# another memory", "user");

    // Verify input box is cleared and shows normal placeholder
    const output = lastFrame();
    expect(output).toContain("Type your message");
  });
});
