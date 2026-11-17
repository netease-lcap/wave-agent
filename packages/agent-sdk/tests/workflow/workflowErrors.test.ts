import { describe, it, expect } from "vitest";
import { isWorkflowRunOversized } from "../../src/workflow/workflowErrors.js";
import {
  resolveWorkflowSizeLimits,
  WORKFLOW_SIZE_WARNING_AGENTS,
  WORKFLOW_SIZE_WARNING_TOKENS,
} from "../../src/constants/workflowLimits.js";

/**
 * The three axes of the size warning, copied from Claude Code 2.1.325's `NH`:
 * declared slots, tokens spent, and the projection `mean × slots`. Each axis
 * answers a different question, so each has a case where it is the only one
 * that fires — that is what the tests below pin.
 */
const limits = {
  agents: WORKFLOW_SIZE_WARNING_AGENTS,
  tokens: WORKFLOW_SIZE_WARNING_TOKENS,
};

describe("isWorkflowRunOversized", () => {
  it("stays quiet on a run that is at the line, not over it", () => {
    expect(
      isWorkflowRunOversized({
        totalAgents: 25,
        totalTokens: 10_000,
        scheduledAgents: 25,
        sizeLimits: limits,
      }),
    ).toBe(false);
  });

  it("counts declared slots, so a wide batch is flagged before any agent runs", () => {
    // The whole point of the slot axis: `parallel([...30])` is oversized the
    // moment it is called, not after 30 agents have spent their tokens.
    expect(
      isWorkflowRunOversized({
        totalAgents: 0,
        totalTokens: 0,
        scheduledAgents: 30,
        sizeLimits: limits,
      }),
    ).toBe(true);
  });

  it("falls back to the started count when the script declared no slots", () => {
    // A `for` loop on `agent()` never calls parallel/pipeline, so nothing is
    // declared and the started count is the best estimate there is.
    expect(
      isWorkflowRunOversized({
        totalAgents: 26,
        totalTokens: 0,
        sizeLimits: limits,
      }),
    ).toBe(true);
    expect(
      isWorkflowRunOversized({
        totalAgents: 25,
        totalTokens: 0,
        sizeLimits: limits,
      }),
    ).toBe(false);
  });

  it("flags on tokens spent before the agent axis is anywhere near it", () => {
    expect(
      isWorkflowRunOversized({
        totalAgents: 1,
        totalTokens: 1_600_000,
        scheduledAgents: 1,
        sizeLimits: limits,
      }),
    ).toBe(true);
  });

  it("projects the declared slots at the average the finished agents set", () => {
    // 4 slots at the 400k each the first two actually cost = 1.6M projected,
    // while only 800k has been spent. This is the case the old predicate could
    // not see at all: it would have waited for the full 1.5M to burn.
    const run = {
      totalAgents: 2,
      totalTokens: 800_000,
      scheduledAgents: 4,
      sizeLimits: limits,
    };
    expect(run.totalTokens).toBeLessThan(WORKFLOW_SIZE_WARNING_TOKENS);
    expect(isWorkflowRunOversized(run)).toBe(true);
  });

  it("guesses 70k per agent while nothing has finished", () => {
    // No sample yet, so the mean is the guess (Claude Code's `z1t`): 24 slots
    // project 1.68M and cross the token line even though the agent axis does
    // not.
    expect(
      isWorkflowRunOversized({
        totalAgents: 0,
        totalTokens: 0,
        scheduledAgents: 24,
        sizeLimits: limits,
      }),
    ).toBe(true);
    // 21 slots project 1.47M — under the line.
    expect(
      isWorkflowRunOversized({
        totalAgents: 0,
        totalTokens: 0,
        scheduledAgents: 21,
        sizeLimits: limits,
      }),
    ).toBe(false);
  });

  it("never projects below what was actually spent", () => {
    // A run whose finished agents were cheap but that has already spent a lot
    // elsewhere must not be talked back under the line by the projection.
    expect(
      isWorkflowRunOversized({
        totalAgents: 5,
        totalTokens: 2_000_000,
        scheduledAgents: 6,
        sizeLimits: limits,
      }),
    ).toBe(true);
  });

  it("judges against the thresholds it was handed", () => {
    // The env overrides reach this function as `sizeLimits`; the constants are
    // only the fallback.
    const tight = { agents: 3, tokens: 1_000 };
    expect(
      isWorkflowRunOversized({
        totalAgents: 0,
        totalTokens: 0,
        scheduledAgents: 4,
        sizeLimits: tight,
      }),
    ).toBe(true);
    expect(
      isWorkflowRunOversized({
        totalAgents: 2,
        totalTokens: 500,
        scheduledAgents: 2,
        sizeLimits: tight,
      }),
    ).toBe(false);
  });
});

describe("resolveWorkflowSizeLimits", () => {
  it("uses the constants when nothing is set", () => {
    expect(resolveWorkflowSizeLimits()).toEqual({
      agents: WORKFLOW_SIZE_WARNING_AGENTS,
      tokens: WORKFLOW_SIZE_WARNING_TOKENS,
    });
    expect(resolveWorkflowSizeLimits({})).toEqual({
      agents: WORKFLOW_SIZE_WARNING_AGENTS,
      tokens: WORKFLOW_SIZE_WARNING_TOKENS,
    });
  });

  it("reads both overrides", () => {
    expect(
      resolveWorkflowSizeLimits({
        WAVE_WORKFLOW_SIZE_WARNING_AGENTS: "40",
        WAVE_WORKFLOW_SIZE_WARNING_TOKENS: "3000000",
      }),
    ).toEqual({ agents: 40, tokens: 3_000_000 });
  });

  it("ignores values that would warn on every run", () => {
    // Same rule as Claude Code's `_Y()`: 0, negatives and junk are treated as
    // unset rather than as a threshold nothing can stay under.
    for (const bad of ["0", "-5", "abc", ""]) {
      expect(
        resolveWorkflowSizeLimits({
          WAVE_WORKFLOW_SIZE_WARNING_AGENTS: bad,
          WAVE_WORKFLOW_SIZE_WARNING_TOKENS: bad,
        }),
      ).toEqual({
        agents: WORKFLOW_SIZE_WARNING_AGENTS,
        tokens: WORKFLOW_SIZE_WARNING_TOKENS,
      });
    }
  });

  it("fills one field without disturbing the other", () => {
    expect(
      resolveWorkflowSizeLimits({ WAVE_WORKFLOW_SIZE_WARNING_AGENTS: "40" }),
    ).toEqual({
      agents: 40,
      tokens: WORKFLOW_SIZE_WARNING_TOKENS,
    });
  });
});
