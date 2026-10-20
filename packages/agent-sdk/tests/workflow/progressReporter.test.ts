import { describe, it, expect, vi } from "vitest";
import { ProgressReporter } from "../../src/workflow/progressReporter.js";
import type { WorkflowMeta } from "../../src/workflow/types.js";

const testMeta: WorkflowMeta = {
  name: "test-workflow",
  description: "A test workflow",
};

describe("ProgressReporter", () => {
  it("setPhase creates a new phase", () => {
    const reporter = new ProgressReporter(testMeta);
    reporter.setPhase("Phase 1");

    const phases = reporter.getPhaseStates();
    expect(phases).toHaveLength(1);
    expect(phases[0].title).toBe("Phase 1");
    expect(phases[0].agentCount).toBe(0);
    expect(phases[0].tokens).toBe(0);
  });

  it("re-entering existing phase reuses it", () => {
    const reporter = new ProgressReporter(testMeta);
    reporter.setPhase("Phase 1");
    reporter.agentStarted();

    // Switch away then come back
    reporter.setPhase("Phase 2");
    reporter.agentStarted();
    reporter.agentStarted();

    reporter.setPhase("Phase 1");

    const phases = reporter.getPhaseStates();
    // Should still be 2 phases, not 3
    expect(phases).toHaveLength(2);
    // Phase 1 should still have its original agent count
    expect(phases[0].agentCount).toBe(1);
  });

  it("agentStarted tracks counts per phase", () => {
    const reporter = new ProgressReporter(testMeta);
    reporter.setPhase("Phase 1");
    reporter.agentStarted();
    reporter.agentStarted();

    reporter.setPhase("Phase 2");
    reporter.agentStarted();

    const phases = reporter.getPhaseStates();
    expect(phases[0].agentCount).toBe(2);
    expect(phases[1].agentCount).toBe(1);
    expect(reporter.totalAgents).toBe(3);
  });

  it("agentCompleted accumulates tokens in current phase", () => {
    const reporter = new ProgressReporter(testMeta);
    reporter.setPhase("Phase 1");
    reporter.agentCompleted(100);
    reporter.agentCompleted(50);

    const phases = reporter.getPhaseStates();
    expect(phases[0].tokens).toBe(150);
    expect(reporter.totalTokens).toBe(150);
  });

  it("formatSummary produces expected format", () => {
    const reporter = new ProgressReporter(testMeta);
    reporter.setPhase("Research");
    reporter.agentStarted();
    reporter.agentCompleted(2000);

    const summary = reporter.formatSummary();
    // Should contain phase info, agent count, tokens, and time
    expect(summary).toContain("Phase 1/1: Research");
    expect(summary).toContain("1 agents");
    expect(summary).toContain("2.0k tokens");
  });

  it("formatSummary shows Initializing when no phase set", () => {
    const reporter = new ProgressReporter(testMeta);
    const summary = reporter.formatSummary();
    expect(summary).toContain("Initializing");
  });

  it("finalize settles the elapsed time of a phase whose agents were interrupted", () => {
    // Only `agentCompleted` used to write `elapsed`, so a run stopped while its
    // agents were in flight recorded the phase it was actually in as `0ms`.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
      const reporter = new ProgressReporter(testMeta);
      reporter.setPhase("Research");
      reporter.agentStarted(); // still running when the run is stopped

      vi.setSystemTime(new Date("2026-10-20T00:00:09Z"));
      reporter.finalize();

      const [phase] = reporter.getPhaseStates();
      expect(phase.elapsed).toBe(9000);
      expect(phase.tokens).toBe(0);
      expect(reporter.totalAgents).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("entering the next phase settles the one it leaves", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-20T00:00:00Z"));
      const reporter = new ProgressReporter(testMeta);
      reporter.setPhase("Research");

      vi.setSystemTime(new Date("2026-10-20T00:00:05Z"));
      reporter.setPhase("Summarize");

      const phases = reporter.getPhaseStates();
      expect(phases[0].elapsed).toBe(5000);
      expect(phases[1].elapsed).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
