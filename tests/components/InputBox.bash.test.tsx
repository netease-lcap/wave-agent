import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";
import { waitForText, waitForTextToDisappear } from "tests/helpers/waitHelpers";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

describe("InputBox Bash Functionality", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should trigger bash history selector when input starts with !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to trigger bash history selector
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");
    expect(lastFrame()).toContain("!");
  });

  it("should not trigger bash history selector for normal input", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    stdin.write("hello");

    await waitForText(lastFrame, "hello");

    expect(lastFrame()).not.toContain("No bash history found");
  });

  it("should close bash history selector when ! is removed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to trigger bash history selector
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    // Remove ! to close bash history selector
    stdin.write("\u0008"); // backspace
    await waitForTextToDisappear(lastFrame, "No bash history found");
  });

  it("should keep bash history selector active when additional text is added after !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to trigger bash history selector first
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    stdin.write("ls");

    // Should show bash history selector with search query
    await waitForText(lastFrame, 'No bash history found for "ls"');
    expect(lastFrame()).toContain("Press Enter to execute: ls");
  });

  it("should send pasted !text as bash command when it's single line", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以!开头的单行文本（模拟粘贴操作）
    const pastedText = "!pwd";
    stdin.write(pastedText);
    await waitForText(lastFrame, "pwd");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "pwd");

    // 验证 sendMessage 被调用且检测为 bash 命令
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("!pwd");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isBashCommand: true,
    });
  });

  it("should NOT send pasted multiline !text as bash command", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以!开头的多行文本（模拟粘贴操作）
    const pastedText = "!这是多行\n命令";
    stdin.write(pastedText);
    await waitForText(lastFrame, "!这是多行");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!这是多行");

    // 验证 sendMessage 被调用但不会检测为 bash 命令
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("!这是多行\n命令");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isBashCommand: false,
    });
  });

  it("should execute bash command when typing ! and single line text", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    stdin.write("!ls");

    await waitForText(lastFrame, "!ls");

    // 发送命令
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!ls");

    // 应该被检测为 bash 命令
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("!ls");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isBashCommand: true,
    });
  });

  it("should clear input after sending bash command", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    stdin.write("!pwd");

    await waitForText(lastFrame, "!pwd");

    // Send command
    stdin.write("\r"); // Enter key
    await waitForText(lastFrame, "Type your message");
  });
});
