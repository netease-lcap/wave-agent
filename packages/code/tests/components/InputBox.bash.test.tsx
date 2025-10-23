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

    // Input single line text starting with ! (simulating paste operation)
    const pastedText = "!pwd";
    stdin.write(pastedText);
    await waitForText(lastFrame, "pwd");

    // Send message
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "pwd");

    // Verify sendMessage is called and detected as bash command
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

    // Input multi-line text starting with ! (simulating paste operation)
    const pastedText = "!This is multi-line\ncommand";
    stdin.write(pastedText);
    await waitForText(lastFrame, "!This is multi-line");

    // Send message
    stdin.write("\r"); // Enter key
    await waitForTextToDisappear(lastFrame, "!This is multi-line");

    // Verify sendMessage is called but not detected as bash command
    expect(mockSendMessage).toHaveBeenCalled();

    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images] = sendMessageCalls[0];
    expect(content).toBe("!This is multi-line\ncommand");
    expect(images).toBeUndefined();
  });

  it("should execute bash command directly when pressing Enter in bash history selector", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} />,
    );

    // Type ! to trigger bash history selector
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    // Type some search text
    stdin.write("ls");
    await waitForText(lastFrame, "Press Enter to execute: ls");

    // Press Enter to execute directly
    stdin.write("\r");
    await waitForTextToDisappear(lastFrame, "ls");

    // Should execute the command directly with ! prefix
    expect(mockSendMessage).toHaveBeenCalledWith("!ls");
  });

  it("should insert bash command with Tab in bash history selector", async () => {
    const { stdin, lastFrame } = render(
      <InputBox sendMessage={mockSendMessage} />,
    );

    // Type ! to trigger bash history selector
    stdin.write("!");
    await waitForText(lastFrame, "No bash history found");

    // Type some search text
    stdin.write("ls");
    await waitForText(lastFrame, "Press Tab to insert: ls");

    // Press Tab to insert
    stdin.write("\t");
    await waitForTextToDisappear(lastFrame, "No bash history found");

    // Should insert the command into input
    const output = lastFrame();
    expect(output).toContain("!ls");

    // Now press Enter to send as normal message
    stdin.write("\r");

    expect(mockSendMessage).toHaveBeenCalled();
    const sendMessageCalls = mockSendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);
    const [content, images] = sendMessageCalls[0];
    expect(content).toBe("!ls");
    expect(images).toBeUndefined();
  });
});
