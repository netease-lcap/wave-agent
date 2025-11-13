import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";
import { waitForText, waitForTextToDisappear } from "../helpers/waitHelpers.js";

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
    await waitForText(lastFrame, "Command Selector");

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
    await waitForText(lastFrame, "Command Selector");
    stdin.write("test");
    await waitForTextToDisappear(lastFrame, "another-command");

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
    await waitForText(lastFrame, "Command Selector");
    stdin.write("test");
    await waitForTextToDisappear(lastFrame, "another-command");

    // Press Enter to select the first command
    stdin.write("\r");

    await waitForTextToDisappear(lastFrame, "Command Selector");

    // Wait for the command to be processed and verify expectations
    expect(mockHasSlashCommand).toHaveBeenCalledWith("test-command");
    expect(mockSendMessage).toHaveBeenCalledWith("/test-command");
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
    await waitForText(lastFrame, "/test-command with args");

    // Press Enter directly - this will handle slash command through sendMessage
    stdin.write("\r");
    await waitForText(lastFrame, "Type your message");

    // Verify sent as message (slash command will be handled internally in sendMessage)
    expect(mockSendMessage).toHaveBeenCalledWith(
      "/test-command with args",
      undefined,
    );
  });

  it("should send slash command as message when entered directly (no command selector)", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Input slash command
    stdin.write("/test-command");
    await waitForText(lastFrame, "/test-command");

    // Press Enter - handle through sendMessage
    stdin.write("\r");
    await waitForText(lastFrame, "Type your message");

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
    await waitForText(lastFrame, "Command Selector");

    // Add slight delay to ensure command selector is ready
    stdin.write("test");
    await waitForTextToDisappear(lastFrame, "another-command");

    // Press Tab to insert command
    stdin.write("\t");
    await waitForTextToDisappear(lastFrame, "Command Selector");

    // Verify command is inserted and can continue to input parameters
    const output = lastFrame();
    expect(output).toContain("/test-command");
    expect(output).not.toContain("Command Selector"); // Selector should close

    // Continue inputting parameters
    stdin.write(" arg1 arg2");
    await waitForText(lastFrame, "arg1 arg2");

    const finalOutput = lastFrame();
    expect(finalOutput).toContain("/test-command");
    expect(finalOutput).toContain("arg1 arg2");
  });
});
