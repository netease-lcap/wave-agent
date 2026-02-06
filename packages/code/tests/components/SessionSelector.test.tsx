import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { SessionSelector } from "../../src/components/SessionSelector.js";
import type { SessionMetadata } from "wave-agent-sdk";

describe("SessionSelector", () => {
  const mockSessions: (SessionMetadata & { firstMessage?: string })[] = [
    {
      id: "session-1",
      lastActiveAt: new Date("2023-01-01T10:00:00Z"),
      latestTotalTokens: 100,
      firstMessage: "Hello world",
      sessionType: "main",
      workdir: "/test",
    },
    {
      id: "session-2",
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
    expect(output).toContain("session-1");
    expect(output).toContain("session-2");
    expect(output).toContain("Hello world");
    expect(output).toContain("How are you?");
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
    expect(lastFrame()).toContain("▶ session-1");

    // Press down arrow
    stdin.write("\u001B[B"); // Down arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ session-2");
    });

    // Press up arrow
    stdin.write("\u001B[A"); // Up arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ session-1");
    });
  });

  it("should call onSelect when Enter is pressed", () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <SessionSelector {...mockProps} onSelect={onSelect} />,
    );

    stdin.write("\r"); // Enter
    expect(onSelect).toHaveBeenCalledWith("session-1");
  });

  it("should call onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <SessionSelector {...mockProps} onCancel={onCancel} />,
    );

    stdin.write("\u001B"); // Escape
    expect(onCancel).toHaveBeenCalled();
  });

  it("should handle pagination when many sessions exist", () => {
    const manySessions: (SessionMetadata & { firstMessage?: string })[] =
      Array.from({ length: 15 }, (_, i) => ({
        id: `session-${i}`,
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
    expect(output).toContain("showing 10 of 15 sessions");
  });
});
