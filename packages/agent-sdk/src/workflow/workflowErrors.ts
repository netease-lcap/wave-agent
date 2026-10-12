/**
 * Errors a workflow script can observe, plus the run-scale caps and warning
 * thresholds keyed to them.
 *
 * `name` is the contract: the pipeline()/parallel() bridges re-inspect a
 * rejected reason by name (a cross-realm `instanceof` is not guaranteed once the
 * script runs inside the sandbox), so both classes set it explicitly.
 */

/** Claude Code's per-run `agent()` call cap (verbatim). */
export const WORKFLOW_AGENT_CALL_CAP = 1000;

/**
 * Size-warning thresholds: the run's agent count or token spend above which one
 * heads-up notification is injected, telling the model how big the run has
 * become and how to stop it (spec「预算与规模硬上限」场景 7).
 *
 * Values are Claude Code's 2.1.293 defaults, read out of the binary as the
 * fallbacks of `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_AGENTS` (25) and
 * `CLAUDE_CODE_WORKFLOW_SIZE_WARNING_TOKENS` (1_500_000). Claude Code shows the
 * same thresholds as a marker in its workflow list UI; wave has no such list
 * surface inside the model's context, so the heads-up goes to the model.
 *
 * Not the hard cap — `WORKFLOW_AGENT_CALL_CAP` and the turn's token budget stay
 * the only things that actually stop a run; these two only warn well before it.
 */
export const WORKFLOW_SIZE_WARNING_AGENTS = 25;
export const WORKFLOW_SIZE_WARNING_TOKENS = 1_500_000;

/**
 * Thrown when a run has already made the maximum number of `agent()` calls.
 * The counter is checked BEFORE the call, so the 1001st call throws (1..1000 are
 * allowed) — matching Claude Code, where the check fires once the counter has
 * reached the cap. The message is Claude Code's verbatim text: an unbounded loop
 * over `budget.remaining()` is the usual cause, because that value is Infinity
 * whenever no token budget was set.
 */
export class WorkflowAgentCapError extends Error {
  constructor(cap: number = WORKFLOW_AGENT_CALL_CAP) {
    super(
      `Workflow agent() call cap reached (${cap}). This usually means a loop using budget.remaining() never terminates because ` +
        `no token budget was set — remaining() returns Infinity when budget.total is null. ` +
        `Add a hard iteration cap to the loop, or pass a token budget.`,
    );
    this.name = "WorkflowAgentCapError";
  }
}

/**
 * Thrown when the turn's token budget is exhausted and the script asks for yet
 * another `agent()`. In-flight agents finish and keep their results; only new
 * calls are refused. `pipeline()`/`parallel()` count these as dropped slots
 * rather than failures, so the run can still complete and report.
 */
export class WorkflowBudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly total: number,
  ) {
    super(
      `Workflow token budget exceeded: ${spent} of ${total} output tokens spent this turn. ` +
        `In-flight agent() calls will still finish and their results are kept, but no new agent() call can start. ` +
        `Pass a larger token budget or continue in the next turn.`,
    );
    this.name = "WorkflowBudgetExceededError";
  }
}

/** Name-based classification of a rejected reason (see the file header). */
export function isWorkflowBudgetExceeded(reason: unknown): boolean {
  if (reason instanceof WorkflowBudgetExceededError) return true;
  return errorName(reason) === "WorkflowBudgetExceededError";
}

/** `name` + `message` of a rejected reason, for failure details. */
export function describeWorkflowError(reason: unknown): {
  name: string;
  message: string;
} {
  return {
    name: reason instanceof Error ? reason.name : errorName(reason),
    // Prefer `.message` even for a foreign-realm Error (one thrown inside the
    // sandbox is not a host Error): `String(reason)` would prepend "Error: " and
    // turn the failure detail into "pipeline[1] failed: Error: boom".
    message: errorMessage(reason),
  };
}

/** `name` of a reason that may come from another realm (VM, worker). */
function errorName(reason: unknown): string {
  const name = (reason as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : "";
}

/** `message` of a reason that may come from another realm (VM, worker). */
function errorMessage(reason: unknown): string {
  const message = (reason as { message?: unknown } | null)?.message;
  if (typeof message === "string") return message;
  return String(reason);
}
