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
    });
  });
});
