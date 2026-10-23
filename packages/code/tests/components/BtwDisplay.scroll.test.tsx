import React from "react";
import { cleanup, render } from "ink-testing-library";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  BtwDisplay,
  BTW_CHROME_ROWS,
  BTW_SCROLL_LINES,
} from "../../src/components/BtwDisplay.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { BtwState } from "../../src/managers/inputReducer.js";

const DOWN = "\u001B[B";
const UP = "\u001B[A";
const CTRL_N = "\u000E";
const CTRL_P = "\u0010";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Terminal rows every case renders with; the viewport budget below is derived
// from it.
const ROWS = 24;

// 80 logical lines of Markdown — far more than any terminal, and more than the
// viewport the overlay is allowed to take.
const TOTAL_LINES = 80;
const longAnswer = Array.from(
  { length: TOTAL_LINES },
  (_, i) => `line ${i}`,
).join("\n");

// Rows the answer viewport shows, and the number of presses that walks the
// offset from the first line to the last one — both read from the component's
// own constants, so a change to either budget cannot silently leave these cases
// pressing too few keys.
const VIEWPORT_ROWS = ROWS - BTW_CHROME_ROWS;
const PRESSES_TO_BOTTOM = Math.ceil(
  (TOTAL_LINES - VIEWPORT_ROWS) / BTW_SCROLL_LINES,
);

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

/**
 * Types one key `times` times without waiting in between.
 *
 * Every `write` is its own stdin event, so the offsets still apply press by
 * press; what changes is the number of frames the test pays for. Each frame
 * re-renders the whole answer (~120ms on the Windows runner vs ~12ms locally),
 * so a `press()` per key spent ~5s of rendering on CI — exactly vitest's default
 * `testTimeout` — and timed the file out there while it stayed green here.
 * Callers assert on the settled frame with `vi.waitFor`.
 */
const pressRepeatedly = (
  stdin: { write: (data: string) => void },
  key: string,
  times: number,
) => {
  for (let i = 0; i < times; i++) {
    stdin.write(key);
  }
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BtwDisplay viewport", () => {
  it("caps a long answer so the whole overlay stays inside the terminal", async () => {
    const { lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={ROWS} />,
    );

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    // The only thing that keeps the frame inside the terminal is the viewport:
    // without it the 80-line answer pushes the frame to ~86 rows.
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(ROWS);
    expect(frame(lastFrame)).toContain("line 0");
    // VIEWPORT_ROWS rows are visible, so the first content row outside the
    // viewport is the one numbered VIEWPORT_ROWS.
    expect(frame(lastFrame)).toContain(`line ${VIEWPORT_ROWS - 1}`);
    expect(frame(lastFrame)).not.toContain(`line ${VIEWPORT_ROWS}`);
  });

  it("scrolls three rows per ↓ and stops at the last line", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={ROWS} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    await press(stdin, DOWN);
    await vi.waitFor(() => {
      // The 3-row step is the contract (aligned with Claude Code): after one
      // press the first three lines are gone and line 3 is at the top. Written
      // literally rather than derived from BTW_SCROLL_LINES — a test that read
      // its expectation back from the constant would pass at any step size —
      // and pinned as "line 3 is the top row" rather than just "line 3 is
      // visible": a one-row step shows line 3 too, three rows lower down.
      expect(frame(lastFrame)).toContain("line 3");
      expect(frame(lastFrame)).not.toContain("line 2");
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    pressRepeatedly(stdin, DOWN, PRESSES_TO_BOTTOM);

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain(`line ${TOTAL_LINES - 1}`);
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
      <BtwDisplay btwState={answered(longAnswer)} rows={ROWS} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    // Leave the top behind first, so a single ↑ cannot restore line 0 by
    // accident.
    pressRepeatedly(stdin, DOWN, 10);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    pressRepeatedly(stdin, UP, PRESSES_TO_BOTTOM);
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
      <BtwDisplay btwState={answered(longAnswer)} rows={ROWS} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });

    await press(stdin, CTRL_N);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 3");
      expect(frame(lastFrame)).not.toContain("line 2");
      expect(frame(lastFrame)).not.toContain("line 0");
    });

    await press(stdin, CTRL_P);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("line 0");
    });
  });

  it("counts wrapped rows when deciding whether the answer overflows", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay btwState={answered(wrappedAnswer)} rows={ROWS} />,
    );

    // 5 logical lines, but ~4 terminal rows each: overflow only shows up if the
    // measured height includes the wrapped rows.
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });
    expect(frame(lastFrame)).not.toContain("4-");

    // Wrapped answer: ~20 rows for 5 logical lines, VIEWPORT_ROWS of them
    // visible, so a handful of presses reaches the last one.
    pressRepeatedly(stdin, DOWN, 10);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("4-");
    });
  });

  it("recomputes the viewport after a terminal resize", async () => {
    const { rerender, lastFrame } = render(
      <BtwDisplay btwState={answered(longAnswer)} rows={ROWS} />,
    );
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("↑/↓ to scroll");
    });
    expect(frame(lastFrame)).not.toContain(`line ${VIEWPORT_ROWS}`);

    // A taller terminal grows the viewport instead of leaving it at
    // VIEWPORT_ROWS rows.
    const tallerRows = 40;
    const tallerViewportRows = tallerRows - BTW_CHROME_ROWS;
    rerender(<BtwDisplay btwState={answered(longAnswer)} rows={tallerRows} />);
    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain(`line ${tallerViewportRows - 1}`);
      expect(frame(lastFrame)).not.toContain(`line ${tallerViewportRows}`);
    });
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(tallerRows);
  });

  it("keeps the plain dismiss hint and ignores the arrow keys for a short answer", async () => {
    const { stdin, lastFrame } = render(
      <BtwDisplay
        btwState={answered("42\nis the answer\nto everything")}
        rows={ROWS}
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
        rows={ROWS}
      />,
    );

    await vi.waitFor(() => {
      expect(frame(lastFrame)).toContain("✻ Answering");
    });
    expect(frame(lastFrame)).not.toContain("↑/↓ to scroll");
    expect(frame(lastFrame)).not.toContain("to dismiss");
    expect(frame(lastFrame).split("\n").length).toBeLessThanOrEqual(ROWS);
  });
});
