import React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { SlashCommand } from "wave-agent-sdk";

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      addEntry: vi.fn().mockResolvedValue(undefined),
      searchHistory: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    permissionMode: "default",
    setPermissionMode: vi.fn(),
  }),
}));

describe("InputBox Smoke Tests", () => {
  describe("Basic Functionality", () => {
    it("should show placeholder text when empty", async () => {
      const { lastFrame } = render(<InputBox />);

      // Wait for the component to render after InputManager initializes
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });

      // Verify placeholder text is displayed (may be wrapped)
      expect(lastFrame()).toMatch(/Type your message[\s\S]*use @ to reference/);
    });

    it("should handle basic text input", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      // Simulate basic input
      stdin.write("hello world");

      // Wait for input text to appear
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("hello world");
      });

      // Verify input text is displayed correctly
      expect(lastFrame()).toContain("hello world");

      // Verify placeholder text is no longer displayed
      expect(lastFrame()).not.toContain(
        "Type your message (use @ to reference files",
      );
    });

    it("should handle paste input with newlines", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      // Simulate user pasting text with newlines
      const pastedText = "This is line 1\nThis is line 2";
      stdin.write(pastedText);

      // Wait for paste processing to complete
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("This is line 1");
      });

      // Verify text is processed correctly
      const output = lastFrame();
      expect(output).toContain("This is line 1");
      expect(output).toContain("This is line 2");
      expect(output).not.toContain(
        "Type your message (use @ to reference files",
      );
    });

    it("should compress long text (>200 chars) into compressed format", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      // Simulate pasting long text over 200 characters
      const longText = "A".repeat(250); // 250 character long text
      stdin.write(longText);

      // Wait for compression processing completion
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("[LongText#1]");
      });

      // Verify long text is compressed to [LongText#1] format
      const output = lastFrame();
      expect(output).toContain("[LongText#1]");
      expect(output).not.toContain(longText); // Should not display original text
    });
  });

  describe("Loading State", () => {
    it("should show normal placeholder when loading", async () => {
      const { lastFrame } = render(<InputBox isLoading={true} />);

      // Wait for the component to render after InputManager initializes
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });
      const output = lastFrame();

      // Should show normal placeholder and allow input even when loading
      expect(output).toContain("Type your message");
    });
  });

  describe("Slash Commands", () => {
    let mockHasSlashCommand: Mock<(commandId: string) => boolean>;
    let mockSendMessage: Mock<
      (message: string, images?: { path: string; mimeType: string }[]) => void
    >;

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
      mockHasSlashCommand = vi.fn<(commandId: string) => boolean>();
      mockSendMessage =
        vi.fn<
          (
            message: string,
            images?: { path: string; mimeType: string }[],
          ) => void
        >();
      vi.clearAllMocks();
    });

    it("should complete slash command workflow: filter -> select -> execute", async () => {
      mockHasSlashCommand.mockReturnValue(true);
      mockSendMessage.mockResolvedValue(undefined);

      const { stdin, lastFrame } = render(
        <InputBox
          slashCommands={testCommands}
          hasSlashCommand={mockHasSlashCommand}
          sendMessage={mockSendMessage}
        />,
      );

      // Step 1: Input "/" to activate command selector
      stdin.write("/");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Command Selector",
        );
      });

      const afterSlashFrame = lastFrame();
      expect(afterSlashFrame).toContain("docs");

      // Step 2: Input "git" to filter commands
      stdin.write("git");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).not.toContain("docs");
      });

      const filteredFrame = lastFrame();
      expect(filteredFrame).toContain("git-commit");
      expect(filteredFrame).not.toContain("docs"); // docs should be filtered out

      // Step 3: Press Enter to select and execute command
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).not.toContain(
          "Command Selector",
        );
      });

      // Step 4: Verify command is executed and input is cleared
      expect(mockHasSlashCommand).toHaveBeenCalledWith("git-commit");
      expect(mockSendMessage).toHaveBeenCalledWith("/git-commit");

      const finalFrame = lastFrame();
      expect(finalFrame).toContain("Type your message");
      expect(finalFrame).not.toContain("Command Selector");
    });

    it("should send complete slash command as message", async () => {
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
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "/git-commit some arguments",
        );
      });

      // Press Enter to send
      stdin.write("\r");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });

      // Verify sent as message
      expect(mockSendMessage).toHaveBeenCalledWith(
        "/git-commit some arguments",
        undefined,
      );
    });
  });
});
