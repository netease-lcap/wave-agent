import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, it, expect, vi } from "vitest";
import { BtwDisplay } from "../../src/components/BtwDisplay.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { BtwState } from "../../src/managers/inputReducer.js";

const DOWN = "\u001B[B";
const UP = "\u001B[A";
const CTRL_N = "\u000E";
const CTRL_P = "\u0010";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 80 logical lines of Markdown — far more than any terminal, and more than the
// viewport the overlay is allowed to take.
const longAnswer = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");

// 5 logical lines that each wrap over several terminal rows (100 columns in
// ink-testing-library), so the row count only overflows once wrapped rows are
// counted.
const wrappedAnswer = Array.from(
  { length: 5 },
  (_, i) => `${i}-${"x".repeat(300)}`,
).join("\n");

const answered = (answer: string): BtwState => ({
  question: "why?",
  answer,
  isLoading: false,
});

const frame = (lastFrame: () => string | undefined) =>
  stripAnsiColors(lastFrame() || "");

const press = async (stdin: { write: (data: string) => void }, key: string) => {
  stdin.write(key);
  await sleep(10);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BtwDisplay viewport", () => {
  it("caps a long answer so the whole overlay stays inside the terminal", async () => {
    const { lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={24} />,
    );

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    // The only thing that keeps the frame inside the terminal is the viewport:
    // without it the 80-line answer pushes the frame to ~86 rows.
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(24);
    expect(frame(lastFrame)).toContain("line 0");
    // 13 rows are visible (24 - 11 reserved rows), so line 13 is the first
    // content row outside the viewport.
    expect(frame(lastFrame)).toContain("line 12");
    expect(frame(lastFrame)).not.toContain("line 13");
  });

  it("scrolls three rows per ↓ and stops at the last line", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={24} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    await press(stdin, DOWN);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 3");
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    for (let i = 0; i < 40; i++) {
      await press(stdin, DOWN);
    }

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 79");
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    // Already at the bottom: further presses do not move the viewport.
    const atBottom = frame(lastFrame);
    await press(stdin, DOWN);
    await press(stdin, DOWN);
    expect(frame(lastFrame)).toBe(atBottom);
  });

  it("scrolls back up with ↑ and stops at the first line", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={24} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    for (let i = 0; i < 10; i++) {
      await press(stdin, DOWN);
    }
    await vi.waitFor(() => {
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    for (let i = 0; i < 40; i++) {
      await press(stdin, UP);
    }
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 0");
    });

    const atTop = frame(lastFrame);
    await press(stdin, UP);
    await press(stdin, UP);
    expect(frame(lastFrame)).toBe(atTop);
  });

  it("scrolls with Ctrl+N / Ctrl+P like ↓ / ↑", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={24} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    await press(stdin, CTRL_N);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 3");
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    await press(stdin, CTRL_P);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 0");
    });
  });

  it("counts wrapped rows when deciding whether the answer overflows", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(wrappedAnswer)} rows={24} />,
    );

    // 5 logical lines, but ~4 terminal rows each: overflow only shows up if the
    // measured height includes the wrapped rows.
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });
    expect(frame(lastFrame)).not.toContain("4-");

    for (let i = 0; i < 20; i++) {
      await press(stdin, DOWN);
    }
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("4-");
    });
  });

  it("recomputes the viewport after a terminal resize", async () => {
    const { rerender, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={24} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });
    expect(frame(lastFrame)).not.toContain("line 13");

    // A taller terminal grows the viewport instead of leaving it at 13 rows.
    rerender(<BtwDisplay btwState={answered(longAnswer)} rows={40} />);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 28");
      expect(frame(lastFrame)).not.toContain("line 29");
    });
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(40);
  });

  it("keeps the plain dismiss hint and ignores the arrow keys for a short answer", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay
        btwState={answered("42\nis the answer\nto everything")}
        rows={24}
      />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("to everything");
    });

    expect(frame(lastFrame)).toContain("Escape to dismiss");
    expect(frame(lastFrame)).not.toContain("↑/↓ to scroll");

    // Nothing overflows, so the viewport never takes the arrow keys over: the
    // frame cannot move.
    const before = frame(lastFrame);
    await press(stdin, DOWN);
    await press(stdin, CTRL_N);
    expect(frame(lastFrame)).toBe(before);
  });

  it("shows the loading state without a viewport or scroll hint", async () => {
    const { lastFrame } = render(
      <BtwDisplay
        btwState={{
          question: "why?",
          answer: undefined,
          isLoading: true,
        }}
        rows={24}
      />,
    );

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("✻ Answering");
    });
    expect(frame(lastFrame)).not.toContain("↑/↓ to scroll");
    expect(frame(lastFrame)).not.toContain("to dismiss");
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(24);
  });
});
