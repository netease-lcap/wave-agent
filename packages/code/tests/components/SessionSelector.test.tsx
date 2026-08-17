import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { SessionSelector } from "../../src/components/SessionSelector.js";
import type { SessionMetadata } from "wave-agent-sdk";

describe("SessionSelector", () => {
  const mockSessions: (SessionMetadata & { firstMessage?: string })[] = [
    {
      id: "12345678-1234-4321-8765-123456789012",
      createdAt: new Date("2023-01-01T10:00:00Z"),
      lastActiveAt: new Date("2023-01-01T10:00:00Z"),
      latestTotalTokens: 100,
      firstMessage: "Hello world",
      sessionType: "main",
      workdir: "/test",
    },
    {
      id: "87654321-4321-1234-5678-210987654321",
      createdAt: new Date("2023-01-01T11:00:00Z"),
      lastActiveAt: new Date("2023-01-01T11:00:00Z"),
      latestTotalTokens: 200,
      firstMessage: "How are you?",
      sessionType: "main",
      workdir: "/test",
    },
  ];

  const mockProps = {
    sessions: mockSessions,
    onSelect: vi.fn(),
    onCancel: vi.fn(),
  };

  it("should render sessions correctly", () => {
    const { lastFrame } = render(<SessionSelector {...mockProps} />);
    const output = lastFrame();
    expect(output).toContain("Select a session to resume");
    // Only the first 8 chars of the session id are shown
    expect(output).toContain("12345678");
    expect(output).toContain("87654321");
    expect(output).toContain("Hello world");
    // Only the selected session's first message is shown
    expect(output).not.toContain("How are you?");
  });

  it("should handle empty sessions list", () => {
    const { lastFrame } = render(
      <SessionSelector {...mockProps} sessions={[]} />,
    );
    const output = lastFrame();
    expect(output).toContain("No sessions found.");
    expect(output).toContain("Press Escape to cancel");
  });

  it("should navigate with arrow keys", async () => {
    const { lastFrame, stdin } = render(<SessionSelector {...mockProps} />);

    // Initially first session is selected
    expect(lastFrame()).toContain("▶ 12345678");

    // Press down arrow
    stdin.write("\u001B[B"); // Down arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 87654321");
    });

    // Press up arrow
    stdin.write("\u001B[A"); // Up arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 12345678");
    });
  });

  it("should call onSelect when Enter is pressed", async () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <SessionSelector {...mockProps} onSelect={onSelect} />,
    );

    stdin.write("\r"); // Enter
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        "12345678-1234-4321-8765-123456789012",
      );
    });
  });

  it("should call onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <SessionSelector {...mockProps} onCancel={onCancel} />,
    );

    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should handle pagination when many sessions exist", () => {
    const manySessions: (SessionMetadata & { firstMessage?: string })[] =
      Array.from({ length: 15 }, (_, i) => ({
        id: `session-${i}`,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        latestTotalTokens: 0,
        firstMessage: `Message ${i}`,
        sessionType: "main",
        workdir: "/test",
      }));

    const { lastFrame } = render(
      <SessionSelector {...mockProps} sessions={manySessions} />,
    );
    const output = lastFrame();
    expect(output).toContain("showing 3 of 15 sessions");
  });

  it("should call onToggleAllProjects when Ctrl+A is pressed", async () => {
    const onToggleAllProjects = vi.fn();
    const { stdin } = render(
      <SessionSelector
        {...mockProps}
        onToggleAllProjects={onToggleAllProjects}
      />,
    );

    stdin.write("\x01"); // Ctrl+A
    await vi.waitFor(() => {
      expect(onToggleAllProjects).toHaveBeenCalledWith(true);
    });

    stdin.write("\x01"); // Ctrl+A again → back to current dir scope
    await vi.waitFor(() => {
      expect(onToggleAllProjects).toHaveBeenCalledWith(false);
    });
  });

  it("should call onToggleAllWorktrees on Ctrl+W only with multiple worktrees", async () => {
    const onToggleAllWorktrees = vi.fn();
    // Single worktree: Ctrl+W is a no-op
    const { stdin: singleStdin } = render(
      <SessionSelector
        {...mockProps}
        worktreePaths={["/repo"]}
        onToggleAllWorktrees={onToggleAllWorktrees}
      />,
    );
    singleStdin.write("\x17"); // Ctrl+W
    await new Promise((r) => setTimeout(r, 20));
    expect(onToggleAllWorktrees).not.toHaveBeenCalled();

    // Multiple worktrees: Ctrl+W toggles the scope
    const { stdin } = render(
      <SessionSelector
        {...mockProps}
        worktreePaths={["/repo", "/repo-wt"]}
        onToggleAllWorktrees={onToggleAllWorktrees}
      />,
    );
    stdin.write("\x17"); // Ctrl+W
    await vi.waitFor(() => {
      expect(onToggleAllWorktrees).toHaveBeenCalledWith(true);
    });
  });

  it("should render workdir at row end when showProjectPath is set", () => {
    const { lastFrame } = render(
      <SessionSelector {...mockProps} showProjectPath />,
    );
    const output = lastFrame();
    expect(output).toContain("| /test");
  });

  it("should render the git branch tag when the session has a branch", () => {
    const sessions = mockSessions.map((s, i) => ({
      ...s,
      branch: i === 0 ? "feature/x" : undefined,
    }));
    const { lastFrame } = render(
      <SessionSelector {...mockProps} sessions={sessions} />,
    );
    const output = lastFrame();
    expect(output).toContain("| [feature/x]");
  });

  it("should show Ctrl+A / Ctrl+W hints when their toggles are available", () => {
    // No toggles → no shortcut hints
    const { lastFrame: plainFrame } = render(
      <SessionSelector {...mockProps} />,
    );
    expect(plainFrame()).not.toContain("Ctrl+A");
    expect(plainFrame()).not.toContain("Ctrl+W");

    // All-projects toggle available → Ctrl+A hint shown
    const { lastFrame: withA } = render(
      <SessionSelector {...mockProps} onToggleAllProjects={vi.fn()} />,
    );
    expect(withA()).toContain("Ctrl+A");

    // Multiple worktrees → Ctrl+W hint shown
    const { lastFrame: withW } = render(
      <SessionSelector
        {...mockProps}
        worktreePaths={["/repo", "/repo-wt"]}
        onToggleAllWorktrees={vi.fn()}
      />,
    );
    expect(withW()).toContain("Ctrl+W");
  });
});
