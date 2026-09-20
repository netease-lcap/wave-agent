import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmationDetails } from "../../src/components/ConfirmationDetails.js";
import { stripAnsiColors } from "wave-agent-sdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ConfirmationDetails scrolling", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const bigPlan = Array.from({ length: 30 }, (_, i) => `plan line ${i}`).join(
    "\n",
  );

  it("shows the first viewport of content with a down indicator when it overflows", async () => {
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 0");
      expect(frame).not.toContain("plan line 5"); // outside the 5-row viewport
      expect(frame).toContain("↓ 25 more");
      expect(frame).not.toContain("↑ ");
    });
  });

  it("scrolls down a page with PgDn and shows the up indicator", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );
    await sleep(30);

    stdin.write("\u001B[6~"); // PgDn
    await sleep(30);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 5");
      expect(frame).not.toContain("plan line 0");
      expect(frame).toContain("↑ 5 more");
      expect(frame).toContain("↓ 20 more");
    });
  });

  it("reaches the last content line with repeated PgDn (browse the full content)", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );
    await sleep(30);

    for (let i = 0; i < 5; i++) {
      stdin.write("\u001B[6~"); // PgDn
      await sleep(20);
    }

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 29"); // last line reachable
      expect(frame).not.toContain("↓ ");
      expect(frame).toContain("↑ 25 more");
    });
  });

  it("scrolls back up with PgUp", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );
    await sleep(30);

    stdin.write("\u001B[6~"); // PgDn
    await sleep(20);
    stdin.write("\u001B[5~"); // PgUp
    await sleep(20);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 0");
      expect(frame).not.toContain("↑ ");
    });
  });

  it("scrolls down half a page with Ctrl+d", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );
    await sleep(30);

    stdin.write("\u0004"); // Ctrl+d
    await sleep(30);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 3"); // half of 5 rounded up
      expect(frame).not.toContain("plan line 2");
      expect(frame).toContain("↑ 3 more");
      expect(frame).toContain("↓ 22 more");
    });
  });

  it("scrolls back up half a page with Ctrl+u", async () => {
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );
    await sleep(30);

    stdin.write("\u001B[6~"); // PgDn → offset 5
    await sleep(20);
    stdin.write("\u0015"); // Ctrl+u → offset 2
    await sleep(20);

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 2");
      expect(frame).not.toContain("plan line 1");
      expect(frame).toContain("↑ 2 more");
      expect(frame).toContain("↓ 23 more");
    });
  });

  it("shows the scroll key hint while content is scrollable", async () => {
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={bigPlan}
        maxHeight={10}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("PgUp/PgDn page");
      expect(frame).toContain("Ctrl+u/d half page");
    });
  });

  it("shows no indicators or hint when the content fits", async () => {
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={"short plan"}
        maxHeight={10}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("short plan");
      expect(frame).not.toContain("more");
      expect(frame).not.toContain("half page");
      // Short content keeps its natural height: the content area is bounded by
      // the row budget, not padded up to it (2 header rows + the rendered plan,
      // which carries one trailing row).
      expect(lastFrame()!.split("\n").length).toBe(4);
    });
  });

  // Rows wider than the terminal wrap into several rows. Counting logical lines
  // underestimates the frame height (breaking the row budget) and mis-reports
  // the scroll indicators, so rolling is driven by the laid-out row count.
  it("counts wrapped rows for paging and keeps the row budget", async () => {
    const widePlan = [0, 1, 2]
      .map((i) => `line${i}-${"x".repeat(240)}`)
      .join("\n");
    const { stdin, lastFrame } = render(
      <ConfirmationDetails
        toolName="ExitPlanMode"
        planContent={widePlan}
        maxHeight={10}
      />,
    );

    // 3 logical lines, 246 columns each → 3 rows each at 100 columns = 9 rows,
    // which overflows the 5-row viewport.
    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("↓ 4 more");
      expect(lastFrame()!.split("\n").length).toBeLessThanOrEqual(10);
    });

    stdin.write("\u001B[6~"); // PgDn → clamped to the last 5-row page (offset 4)
    await sleep(30);

    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("↑ 4 more");
      expect(plain).not.toContain("↓ ");
      expect(plain).not.toContain("line0-"); // scrolled past the first line
      expect(plain).toContain("line2-"); // last wrapped row reachable
      expect(lastFrame()!.split("\n").length).toBeLessThanOrEqual(10);
    });
  });

  it("counts wrapped rows of a diff the same way", async () => {
    // Same viewport as the plan: an Edit diff whose long code lines wrap is
    // clipped and paged by the row count the layout reports.
    const longLine = `new-${"y".repeat(240)}`;
    const { lastFrame } = render(
      <ConfirmationDetails
        toolName="Edit"
        toolInput={{
          old_string: "old",
          new_string: `${longLine}\n${longLine}`,
        }}
        maxHeight={10}
      />,
    );

    // Two logical added lines × 3 wrapped rows + 1 removed row = 7 rows, which
    // overflows the 5-row viewport.
    await vi.waitFor(() => {
      const plain = stripAnsiColors(lastFrame() || "");
      expect(plain).toContain("new-");
      expect(plain).toContain("↓ 2 more");
      expect(lastFrame()!.split("\n").length).toBeLessThanOrEqual(10);
    });
  });
});
