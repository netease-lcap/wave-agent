import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { PlanView } from "../../src/components/PlanView.js";
import { stripAnsiColors } from "wave-agent-sdk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("PlanView", () => {
  const onCancel = vi.fn();

  const bigPlan = Array.from({ length: 30 }, (_, i) => `plan line ${i}`).join(
    "\n",
  );

  it("shows a status message only when content is absent", async () => {
    const { lastFrame } = render(
      <PlanView message="Enabled plan mode" onCancel={onCancel} />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Enabled plan mode");
      expect(frame).toContain("Press Escape to continue");
      expect(frame).not.toContain("Current Plan");
    });
  });

  it("shows the current plan header, path and content when it fits", async () => {
    const { lastFrame } = render(
      <PlanView
        path="/tmp/session/plan.md"
        content={"short plan"}
        maxHeight={10}
        onCancel={onCancel}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Current Plan");
      expect(frame).toContain("/tmp/session/plan.md");
      expect(frame).toContain("short plan");
      expect(frame).not.toContain("more");
      expect(frame).not.toContain("half page");
    });
  });

  it("shows the first viewport with a down indicator when content overflows", async () => {
    const { lastFrame } = render(
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
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
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
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

  it("reaches the last content line with repeated PgDn", async () => {
    const { stdin, lastFrame } = render(
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
    );
    await sleep(30);

    for (let i = 0; i < 6; i++) {
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

  it("scrolls down half a page with Ctrl+d", async () => {
    const { stdin, lastFrame } = render(
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
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

  it("shows the scroll key hint while content is scrollable", async () => {
    const { lastFrame } = render(
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("PgUp/PgDn page");
      expect(frame).toContain("Ctrl+u/d half page");
    });
  });

  it("shows 'No plan written yet.' when the plan file is empty", async () => {
    const { lastFrame } = render(
      <PlanView
        path="/tmp/session/plan.md"
        content={""}
        maxHeight={10}
        onCancel={onCancel}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("No plan written yet.");
    });
  });

  it("calls onCancel when Escape is pressed", async () => {
    const { stdin } = render(
      <PlanView content={bigPlan} maxHeight={10} onCancel={onCancel} />,
    );
    await sleep(30);

    stdin.write("\u001B"); // Escape
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });
});
