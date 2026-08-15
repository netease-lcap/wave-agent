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
      expect(frame).not.toContain("plan line 6"); // outside the 6-row viewport
      expect(frame).toContain("↓ 24 more");
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
      expect(frame).toContain("plan line 6");
      expect(frame).not.toContain("plan line 0");
      expect(frame).toContain("↑ 6 more");
      expect(frame).toContain("↓ 18 more");
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

    for (let i = 0; i < 4; i++) {
      stdin.write("\u001B[6~"); // PgDn
      await sleep(20);
    }

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("plan line 29"); // last line reachable
      expect(frame).not.toContain("↓ ");
      expect(frame).toContain("↑ 24 more");
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

  it("shows no indicators when the content fits", async () => {
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
    });
  });
});
