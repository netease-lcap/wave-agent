import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import type { SlashCommand } from "wave-agent-sdk";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Complete Slash Command Flow", () => {
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
    mockHasSlashCommand = vi.fn();
    mockSendMessage = vi.fn();
    vi.clearAllMocks();
  });

  it("should complete the full workflow: type partial command -> select from dropdown -> execute -> clear input", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Step 1: Initial state should show placeholder
    expect(lastFrame()).toContain("Type your message");

    // Step 2: Input "/" to activate command selector
    stdin.write("/");
    await delay(50);

    const afterSlashFrame = lastFrame();
    expect(afterSlashFrame).toContain("Command Selector");
    expect(afterSlashFrame).toContain("git-commit");
    expect(afterSlashFrame).toContain("docs");

    // Step 3: Input "git" to filter commands
    stdin.write("git");
    await delay(50);

    const filteredFrame = lastFrame();
    expect(filteredFrame).toContain("git-commit");
    expect(filteredFrame).not.toContain("docs"); // docs should be filtered out

    // Step 4: Press Enter to select and execute command
    stdin.write("\r");
    await delay(100);

    // Step 5: Verify command is executed correctly
    expect(mockHasSlashCommand).toHaveBeenCalledWith("git-commit");
    expect(mockSendMessage).toHaveBeenCalledWith("/git-commit");

    // Step 6: Verify input box is cleared and returns to initial state
    const finalFrame = lastFrame();
    expect(finalFrame).toContain("Type your message");
    expect(finalFrame).not.toContain("Command Selector");
    expect(finalFrame).not.toContain("/git");
  });

  it("should send slash command as message when typed directly", async () => {
    mockHasSlashCommand.mockReturnValue(true);
    mockSendMessage.mockResolvedValue(undefined);

    const { stdin, lastFrame } = render(
      <InputBox
        slashCommands={testCommands}
        hasSlashCommand={mockHasSlashCommand}
        sendMessage={mockSendMessage}
      />,
    );

    // Input complete command directly
    stdin.write("/git-commit some arguments");
    await delay(50);

    expect(lastFrame()).toContain("/git-commit some arguments");

    // Press Enter - this will be sent as regular message, slash command will be handled inside sendMessage
    stdin.write("\r");
    await delay(100);

    // Verify sent as message (slash command processing now inside sendMessage)
    expect(mockSendMessage).toHaveBeenCalledWith(
      "/git-commit some arguments",
      undefined,
    );

    // Verify input box is cleared
    expect(lastFrame()).toContain("Type your message");
  });
});
