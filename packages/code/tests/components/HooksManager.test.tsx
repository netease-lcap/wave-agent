import React from "react";
import { render } from "ink-testing-library";
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type Mock,
} from "vitest";
import {
  HooksManager,
  HooksManagerProps,
} from "../../src/components/HooksManager.js";

const mockHooks: HooksManagerProps["hooks"] = {
  user: {
    PreToolUse: [
      {
        matcher: "Write",
        hooks: [{ type: "command", command: "node lint.js" }],
      },
    ],
    Stop: [
      {
        hooks: [
          {
            type: "command",
            command: "echo stopped",
            async: true,
            timeout: 30,
          },
        ],
      },
    ],
  },
  project: {
    PostToolUse: [
      { matcher: "Bash", hooks: [{ type: "command", command: "echo proj" }] },
    ],
  },
  plugin: {
    SessionStart: [
      { hooks: [{ type: "command", command: "echo plugin-start" }] },
    ],
  },
};

describe("HooksManager", () => {
  let mockOnCancel: Mock<() => void>;
  let defaultProps: HooksManagerProps;

  beforeEach(() => {
    mockOnCancel = vi.fn<() => void>();
    defaultProps = {
      onCancel: mockOnCancel,
      hooks: mockHooks,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("list view", () => {
    it("should show header and hint", () => {
      const { lastFrame } = render(<HooksManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("Hooks");
      expect(output).toContain("Select a hook to view details");
    });

    it("should display hooks grouped by scope", () => {
      const { lastFrame } = render(<HooksManager {...defaultProps} />);
      const output = lastFrame();

      // Scope group headers
      expect(output).toContain("User hooks");
      expect(output).toContain("Project hooks");
      expect(output).toContain("Plugin hooks");

      // Hook names (Event:Matcher / bare Event)
      expect(output).toContain("PreToolUse:Write");
      expect(output).toContain("Stop");
      expect(output).toContain("PostToolUse:Bash");
      expect(output).toContain("SessionStart");
    });

    it("should show event summaries as sub text", () => {
      const { lastFrame } = render(<HooksManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("Before tool execution");
      expect(output).toContain("After tool execution");
    });

    it("should show navigation instructions", () => {
      const { lastFrame } = render(<HooksManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("↑/↓ to select");
      expect(output).toContain("Enter to view details");
      expect(output).toContain("Esc to close");
    });

    it("should show empty state with config guidance when no hooks", () => {
      const props = { ...defaultProps, hooks: {} };
      const { lastFrame } = render(<HooksManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("No hooks configured");
      expect(output).toContain("~/.wave/settings.json");
      expect(output).toContain("Press Escape to close");
    });

    it("should hide group headers for empty scopes", () => {
      const props = {
        ...defaultProps,
        hooks: { project: mockHooks.project },
      };
      const { lastFrame } = render(<HooksManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("Project hooks");
      expect(output).not.toContain("User hooks");
      expect(output).not.toContain("Plugin hooks");
    });
  });

  describe("navigation", () => {
    it("should change selection with arrow keys", async () => {
      const { lastFrame, stdin } = render(<HooksManager {...defaultProps} />);

      expect(lastFrame()).toContain("▶ 1. PreToolUse:Write");

      stdin.write("\u001B[B");
      await vi.waitFor(() => expect(lastFrame()).toContain("▶ 2. Stop"));
    });

    it("should clamp selection at the bottom", async () => {
      const { lastFrame, stdin } = render(<HooksManager {...defaultProps} />);

      for (let i = 0; i < 10; i++) {
        stdin.write("\u001B[B");
      }
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 4. SessionStart"),
      );
    });

    it("should enter detail view on Enter and go back on Escape", async () => {
      const { lastFrame, stdin } = render(<HooksManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Hook: PreToolUse:Write"),
      );

      // Detail shows event + summary + matcher + commands
      const output = lastFrame();
      expect(output).toContain("Event:");
      expect(output).toContain("Before tool execution");
      expect(output).toContain("Matcher: Write");
      expect(output).toContain("node lint.js");
      expect(output).toContain("Esc or Enter to go back");

      // Back to list
      stdin.write("\u001B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Select a hook to view details"),
      );
    });

    it("should call onCancel on Escape in list view", async () => {
      const { stdin } = render(<HooksManager {...defaultProps} />);

      stdin.write("\u001B");
      await vi.waitFor(() => expect(mockOnCancel).toHaveBeenCalled());
    });

    it("should ignore arrow keys in detail view", async () => {
      const { lastFrame, stdin } = render(<HooksManager {...defaultProps} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Hook: PreToolUse:Write"),
      );

      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Hook: PreToolUse:Write"),
      );
      expect(lastFrame()).toContain("Before tool execution");
    });
  });

  describe("detail view content", () => {
    it("should show matcher-less hook with async/timeout flags", async () => {
      const { lastFrame, stdin } = render(<HooksManager {...defaultProps} />);

      // Move to Stop (2nd entry, no matcher) and open detail
      stdin.write("\u001B[B");
      stdin.write("\r");
      await vi.waitFor(() => expect(lastFrame()).toContain("Hook: Stop"));
      const output = lastFrame();

      expect(output).toContain("echo stopped");
      expect(output).toContain("(async)");
      expect(output).toContain("(timeout 30s)");
      expect(output).toContain("Right before Claude concludes its response");
      // No matcher line for matcher-less hooks
      expect(output).not.toContain("Matcher:");
    });

    it("should show multiple commands", async () => {
      const props: HooksManagerProps = {
        ...defaultProps,
        hooks: {
          user: {
            PreToolUse: [
              {
                matcher: "Read",
                hooks: [
                  { type: "command", command: "cmd-one" },
                  { type: "command", command: "cmd-two" },
                ],
              },
            ],
          },
        },
      };
      const { lastFrame, stdin } = render(<HooksManager {...props} />);

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Hook: PreToolUse:Read"),
      );
      const output = lastFrame();
      expect(output).toContain("1. cmd-one");
      expect(output).toContain("2. cmd-two");
    });
  });

  describe("component lifecycle", () => {
    it("should cleanup properly on unmount", () => {
      const { unmount } = render(<HooksManager {...defaultProps} />);

      expect(() => unmount()).not.toThrow();
    });
  });
});
