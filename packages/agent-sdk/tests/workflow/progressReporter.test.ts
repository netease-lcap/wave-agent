import { describe, it, expect } from "vitest";
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
});
