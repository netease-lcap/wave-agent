import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import { waitForText, waitForTextToDisappear } from "../helpers/waitHelpers.js";

describe("InputBox Bash Functionality", () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  const virtualWorkdir = "/virtual/test/directory";

  beforeEach(() => {
    mockSendMessage = vi.fn();
    // Mock process.cwd to return the virtual workdir
    vi.spyOn(process, "cwd").mockReturnValue(virtualWorkdir);
  });

  it("should trigger bash history selector when input starts with !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to trigger bash history selector
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    // Should show "No bash history found" message since we're using a virtual workdir
    const output = lastFrame();
    expect(output).toContain("No bash history found");
    expect(output).toContain("!");
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

    // Should show placeholder text again (when input is empty)
    await waitForText(lastFrame, "Type your message");
    // Input should be empty, showing placeholder
  });

  it("should keep bash history selector active when additional text is added after !", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type ! to trigger bash history selector first
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    stdin.write("ls");
    await waitForText(lastFrame, "!ls");

    // Should still show ! and additional text
    const output = lastFrame();
    expect(output).toContain("!ls");
  });

  it("should send pasted !text as bash command when it's single line", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} />,
    );

    // 一口气输入以!开头的单行文本（模拟粘贴操作）
    const pastedText = "!pwd";
    stdin.write(pastedText);
    await waitForText(lastFrame, "pwd");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "pwd");

    // 验证 sendMessage 被调用且检测为 bash 命令
    expect(mockSendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images] = sendMessageCalls[0];
    expect(content).toBe("!pwd");
    expect(images).toBeUndefined();
  });

  it("should NOT send pasted multiline !text as bash command", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} />,
    );

    // 一口气输入以!开头的多行文本（模拟粘贴操作）
    const pastedText = "!这是多行\n命令";
    stdin.write(pastedText);
    await waitForText(lastFrame, "!这是多行");

    // 发送消息
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!这是多行");

    // 验证 sendMessage 被调用但不会检测为 bash 命令
    expect(mockSendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images] = sendMessageCalls[0];
    expect(content).toBe("!这是多行\n命令");
    expect(images).toBeUndefined();
  });

  it("should execute bash command when typing ! and single line text", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} />,
    );

    stdin.write("!ls");

    await waitForText(lastFrame, "!ls");

    // 发送命令
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!ls");

    // 应该被检测为 bash 命令
    expect(mockSendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images] = sendMessageCalls[0];
    expect(content).toBe("!ls");
    expect(images).toBeUndefined();
  });

  it("should clear input after sending bash command", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    stdin.write("!pwd");

    await waitForText(lastFrame, "!pwd");

    // Send command
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!pwd");
  });
});
