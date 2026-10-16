/**
 * Workflow run size thresholds, shared with the UI entries.
 *
 * Dependency-free on purpose: the webview (a browser bundle) imports this module
 * through `wave-agent-sdk/constants`, so nothing here may reach for the agent
 * runtime (see the entry's own note in `constants/index.ts`).
 *
 * Above either threshold a run is marked oversized in the workflow UI — the
 * `/workflows` list row and detail (spec「预算与规模硬上限」场景 7). Values are
 * Claude Code's 2.1.293 defaults, read out of its binary as the fallbacks of
 * `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_AGENTS` (25) and
 * `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_TOKENS` (1_500_000); Claude Code surfaces
 * the same thresholds as a marker in its workflow list (`Large workflow ·
 * /workflows to stop`) and never tells the model.
 *
 * Wave does the same, and that is the point: the marker is the human's cue to
 * stop a run. It used to be a notification injected into the model's context
 * instead, which turned "this run is big" into "ask the user whether to keep
 * going" on *every* deep-research run — a complete one is ~58 agents, so it
 * always crossed. Nobody could ever let one finish; see the spec's 2026-10-16
 * 口径变更.
 */
export const WORKFLOW_SIZE_WARNING_AGENTS = 25;
export const WORKFLOW_SIZE_WARNING_TOKENS = 1_500_000;
