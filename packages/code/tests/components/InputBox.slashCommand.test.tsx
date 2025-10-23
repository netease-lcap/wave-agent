import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Slash Command Functionality", () => {
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
    mockHasSlashCommand = vi.fn();
    mockSendMessage = vi.fn();
    vi.clearAllMocks();
  });

  it("should show command selector when typing /", async () => {
    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // Input / to trigger command selector
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
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // Input /test character by character to avoid being treated as paste operation
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
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Input /test character by character
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

    // Press Enter to select the first command
    stdin.write("\r");
    await delay(100);

    // Verify command is executed
    expect(mockHasSlashCommand).toHaveBeenCalledWith("test-command");
    expect(mockSendMessage).toHaveBeenCalledWith("/test-command");

    // Verify input box is cleared (should not have any input content)
    const output = lastFrame();
    expect(output).toContain("Type your message"); // Should display placeholder
  });

  it("should send slash command as message when entered directly and pressed enter", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Input complete slash command
    stdin.write("/test-command with args");
    await delay(50);

    // Press Enter directly - this will handle slash command through sendMessage
    stdin.write("\r");
    await delay(100);

    // Verify input box is cleared
    const output = lastFrame();
    expect(output).toContain("Type your message");

    // Verify sent as message (slash command will be handled internally in sendMessage)
    expect(mockSendMessage).toHaveBeenCalledWith(
      "/test-command with args",
      undefined,
    );
  });

  it("should send slash command as message when entered directly (no command selector)", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Input slash command
    stdin.write("/test-command");
    await delay(50);

    // Press Enter - handle through sendMessage
    stdin.write("\r");
    await delay(100);

    // Verify sent as message (slash command will be handled internally in sendMessage)
    expect(mockSendMessage).toHaveBeenCalledWith("/test-command", undefined);
  });

  it("should insert command with Tab and allow adding arguments", async () => {
    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
      />,
    );

    // Input /test character by character
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

    // Press Tab to insert command
    stdin.write("\t");
    await delay(50);

    // Verify command is inserted and can continue to input parameters
    const output = lastFrame();
    expect(output).toContain("/test-command ");
    expect(output).not.toContain("Command Selector"); // Selector should close

    // Continue inputting parameters
    stdin.write("arg1 arg2");
    await delay(50);

    const finalOutput = lastFrame();
    expect(finalOutput).toContain("/test-command arg1 arg2");
  });
});
