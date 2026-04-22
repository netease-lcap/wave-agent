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

const mockSetPermissionMode = vi.fn();
const mockHandleRewindSelect = vi.fn();
const mockBackgroundCurrentTask = vi.fn();

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: () => ({
    permissionMode: "default",
    setPermissionMode: mockSetPermissionMode,
    backgroundTasks: [],
    messages: [],
    handleRewindSelect: mockHandleRewindSelect,
    backgroundCurrentTask: mockBackgroundCurrentTask,
  }),
}));

describe("InputBox Smoke Tests", () => {
  describe("Basic Functionality", () => {
    it("should show placeholder text when empty", async () => {
      const { lastFrame } = render(<InputBox />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });

      expect(lastFrame()).toMatch(
        /Type your message[\s\S]*use \/help for more info/,
      );
    });

    it("should handle basic text input", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      stdin.write("hello world");

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("hello world");
      });

      expect(lastFrame()).not.toContain(
        "Type your message (use /help for more info",
      );
    });

    it("should handle paste input with newlines", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      const pastedText = "This is line 1\nThis is line 2";
      stdin.write(pastedText);

      await vi.waitFor(() => {
        const output = stripAnsiColors(lastFrame() || "");
        expect(output).toContain("This is line 1");
        expect(output).toContain("This is line 2");
      });

      expect(lastFrame()).not.toContain(
        "Type your message (use /help for more info",
      );
    });

    it("should compact long text (>200 chars) into compacted format", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      const longText = "A".repeat(250);
      stdin.write(longText);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain("[LongText#1]");
      });

      expect(lastFrame()).not.toContain(longText);
    });
  });

  describe("Loading State", () => {
    it("should show normal placeholder when loading", async () => {
      const { lastFrame } = render(<InputBox isLoading={true} />);

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });
      expect(lastFrame()).toContain("Type your message");
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

      stdin.write("/");
      await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

      stdin.write("git");
      await vi.waitFor(() => expect(lastFrame()).toContain("git-commit"));

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          "/git-commit",
          undefined,
          {},
        );
      });

      expect(mockHasSlashCommand).toHaveBeenCalledWith("git-commit");
      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });
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

      stdin.write("/git-commit some arguments");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("/git-commit some arguments"),
      );

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          "/git-commit some arguments",
          undefined,
          {},
        );
      });

      await vi.waitFor(() => {
        expect(stripAnsiColors(lastFrame() || "")).toContain(
          "Type your message",
        );
      });
    });
  });

  describe("Additional Branch Coverage", () => {
    it("should render BackgroundTaskManager when showTaskManager is true", async () => {
      const { stdin, lastFrame } = render(<InputBox />);
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Type your message"),
      );

      stdin.write("/");
      await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

      stdin.write("tasks");
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ /tasks"));

      stdin.write("\r");
      await vi.waitFor(
        () => {
          expect(stripAnsiColors(lastFrame() || "")).toContain(
            "Background Tasks",
          );
        },
        { timeout: 2000 },
      );
    });

    it("should render McpManager when showMcpManager is true", async () => {
      const { stdin, lastFrame } = render(<InputBox />);
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Type your message"),
      );

      stdin.write("/");
      await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

      stdin.write("mcp");
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ /mcp"));

      stdin.write("\r");
      await vi.waitFor(
        () => {
          expect(stripAnsiColors(lastFrame() || "")).toMatch(
            /Manage MCP servers|Background Tasks/,
          );
        },
        { timeout: 2000 },
      );
    });

    it("should handle RewindManager", async () => {
      const { stdin, lastFrame } = render(<InputBox />);
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Type your message"),
      );

      stdin.write("/");
      await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

      stdin.write("rewind");
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ /rewind"));

      stdin.write("\r");
      await vi.waitFor(
        () => {
          expect(stripAnsiColors(lastFrame() || "")).toMatch(
            /Rewind|Background Tasks|No user messages found to rewind to/,
          );
        },
        { timeout: 2000 },
      );

      // Cancel rewind
      stdin.write("\u001b"); // Escape
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Type your message");
      });
    });

    it("should cycle permission mode on Shift+Tab", async () => {
      const { stdin } = render(<InputBox />);

      stdin.write("\u001b[Z"); // Shift+Tab
      await vi.waitFor(
        () => {
          expect(mockSetPermissionMode).toHaveBeenCalledWith("acceptEdits");
        },
        { timeout: 2000 },
      );
    });

    it("should handle cursor movement keys", async () => {
      const { stdin, lastFrame } = render(<InputBox />);

      stdin.write("abc");
      await vi.waitFor(() => expect(lastFrame()).toContain("abc"));

      stdin.write("\u001b[D"); // Move left
      await vi.waitFor(() => expect(lastFrame()).toContain("abc"));
    });

    it("should render HelpView when help command is executed", async () => {
      const { stdin, lastFrame } = render(<InputBox />);
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Type your message"),
      );

      stdin.write("/");
      await vi.waitFor(() => expect(lastFrame()).toContain("Command Selector"));

      stdin.write("help");
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ /help"));

      stdin.write("\r");
      await vi.waitFor(
        () => {
          const output = stripAnsiColors(lastFrame() || "");
          expect(output).toContain("General");
          expect(output).toContain("Commands");
        },
        { timeout: 2000 },
      );

      // Close help
      stdin.write("\u001b"); // Escape
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Type your message");
      });
    });
  });
});
