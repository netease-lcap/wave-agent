import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { HistorySearch } from "../../src/components/HistorySearch.js";
import { PromptHistoryManager } from "wave-agent-sdk";
import { waitForText } from "../helpers/waitHelpers.js";

vi.mock("wave-agent-sdk", async () => {
  const actual = (await vi.importActual("wave-agent-sdk")) as object;
  return {
    ...actual,
    PromptHistoryManager: {
      searchHistory: vi.fn(),
    },
  };
});

describe("HistorySearch", () => {
  const mockEntries = [
    { prompt: "first prompt", timestamp: 1000 },
    { prompt: "second prompt", timestamp: 2000 },
  ];

  const mockProps = {
    searchQuery: "",
    onSelect: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PromptHistoryManager.searchHistory).mockResolvedValue(
      mockEntries,
    );
  });

  it("should render history entries", async () => {
    const { lastFrame } = render(<HistorySearch {...mockProps} />);

    // Wait for useEffect to fetch history
    await waitForText(lastFrame, "Prompt History");
    await waitForText(lastFrame, "first prompt");
    await waitForText(lastFrame, "second prompt");
  });

  it("should filter entries when searchQuery changes", async () => {
    const { lastFrame, rerender } = render(<HistorySearch {...mockProps} />);

    await waitForText(lastFrame, "first prompt");

    vi.mocked(PromptHistoryManager.searchHistory).mockResolvedValue([
      mockEntries[1],
    ]);
    rerender(<HistorySearch {...mockProps} searchQuery="second" />);

    await waitForText(lastFrame, 'filtering: "second"');
    await waitForText(lastFrame, "second prompt");

    await vi.waitFor(() => {
      const output = lastFrame() || "";
      expect(output).not.toContain("first prompt");
    });
  });

  it("should call onSelect when Enter is pressed", async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(
      <HistorySearch {...mockProps} onSelect={onSelect} />,
    );

    await waitForText(lastFrame, "first prompt");

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("first prompt");
    });
  });

  it("should call onCancel when Escape is pressed", async () => {
    const onCancel = vi.fn();
    const { stdin, lastFrame } = render(
      <HistorySearch {...mockProps} onCancel={onCancel} />,
    );

    await waitForText(lastFrame, "first prompt");

    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should navigate with arrow keys", async () => {
    const onSelect = vi.fn();
    const { stdin, lastFrame } = render(
      <HistorySearch {...mockProps} onSelect={onSelect} />,
    );

    await waitForText(lastFrame, "first prompt");

    stdin.write("\u001B[B"); // Down arrow

    // Wait for selection to change in UI
    await waitForText(lastFrame, "second prompt");

    // Small delay to ensure state is fully propagated
    await new Promise((resolve) => setTimeout(resolve, 100));

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith("second prompt");
    });
  });

  it("should show empty state when no results", async () => {
    vi.mocked(PromptHistoryManager.searchHistory).mockResolvedValue([]);
    const { lastFrame } = render(
      <HistorySearch {...mockProps} searchQuery="nothing" />,
    );

    await waitForText(lastFrame, 'No history found for "nothing"');
  });
});
