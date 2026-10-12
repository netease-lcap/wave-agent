import type { BudgetInfo } from "../workflow/types.js";

/** `+250000` style targets are only believed above this value (see parser). */
const MIN_PLAIN_TOKEN_TARGET = 10_000;

/**
 * Turn-scoped output-token ledger.
 *
 * The main agent loop and EVERY workflow of the same turn share one ledger:
 * `spent()` is what the whole turn has generated so far, not what a single
 * workflow spent (spec: multi-agent/workflow.md「预算与规模硬上限」场景 5).
 * The counter itself is cumulative for the session; a turn boundary only
 * snapshots a new baseline, so
 * `spent() = cumulative output tokens - baseline at turn start`
 * — the same three-function shape as Claude Code's
 * `costLedger.totalOutputTokens()` / `turnBudget.outputTokensAtTurnStart()`.
 *
 * Accounting is output-only (see utils/tokenCalculation.ts): callers feed
 * `completion_tokens`, never `total_tokens`. Under OpenAI-compatible usage
 * `total_tokens` already folds the cache reads/writes into the prompt side, so
 * charging it would count the whole context once per request.
 */
export class TurnBudgetLedger {
  /** Cumulative output tokens generated in this session (never reset). */
  private cumulativeOutputTokens = 0;
  /** Cumulative value at the start of the current turn (`spent()` == 0). */
  private turnStartOutputTokens = 0;
  /** The user's token target for the current turn, or null when they gave none. */
  private turnTotal: number | null = null;

  /**
   * Start a turn: snapshot the baseline and adopt the turn's token target.
   * Called by the main agent's AIManager only — a subagent turn nests inside
   * its parent's turn and must not re-baseline the shared ledger.
   */
  beginTurn(total: number | null): void {
    this.turnStartOutputTokens = this.cumulativeOutputTokens;
    this.turnTotal = total;
  }

  /** Record one response's output tokens (`completion_tokens`, output-only). */
  addOutputTokens(tokens: number): void {
    if (!Number.isFinite(tokens) || tokens <= 0) return;
    this.cumulativeOutputTokens += tokens;
  }

  /** Output tokens generated since the current turn started. */
  getTurnSpent(): number {
    return Math.max(
      0,
      this.cumulativeOutputTokens - this.turnStartOutputTokens,
    );
  }

  /** The turn's token target (`null` = the user gave none). */
  get total(): number | null {
    return this.turnTotal;
  }

  /** Remaining budget; `Infinity` while no target was given. */
  remaining(): number {
    if (this.turnTotal === null) return Infinity;
    return Math.max(0, this.turnTotal - this.getTurnSpent());
  }

  /**
   * The turn's target when it has been reached (hard cap tripped), else null.
   * A null or non-positive total means "no cap", so this never fires for those
   * (Claude Code's `me()`: `if (total == null || total <= 0) return`).
   */
  exceededTotal(): number | null {
    if (this.turnTotal === null || this.turnTotal <= 0) return null;
    return this.getTurnSpent() >= this.turnTotal ? this.turnTotal : null;
  }

  /** The readonly view handed to workflow scripts as the `budget` global. */
  toBudgetInfo(): BudgetInfo {
    return {
      total: this.turnTotal,
      spent: () => this.getTurnSpent(),
      remaining: () => this.remaining(),
    };
  }
}

/**
 * Parse the token target a user message gives for this turn
 * (spec: multi-agent/workflow.md「预算与规模硬上限」场景 1).
 *
 * Recognised, case-insensitive: `+500k`, `+1.5m`, `+250000`, `use 500k tokens`,
 * `use 200000 tokens`, `500k tokens`. Anything else — including no target at all
 * — returns null, which is the state workflow scripts read as
 * `budget.total === null` / `remaining() === Infinity` (场景 2).
 *
 * Evidence strength: the syntax comes from the approved spec, NOT from a
 * decompiled Claude Code site — the 2.1.293 binary's parser for this
 * instruction was never located (evidence §5/§6, "尚未取证").
 */
export function parseTokenBudgetTarget(text: string): number | null {
  if (!text) return null;

  const patterns: Array<{ pattern: RegExp; requireTokenSized: boolean }> = [
    // "+500k" / "+1.5m" / "+250000"
    {
      pattern: /(?:^|\s)\+(\d+(?:\.\d+)?)([km])?\b/i,
      requireTokenSized: true,
    },
    // "use 500k tokens" / "use 200000 tokens" — the word "tokens" is explicit,
    // so any magnitude counts.
    {
      pattern: /\buse\s+(\d+(?:\.\d+)?)\s*([km])?\s*tokens?\b/i,
      requireTokenSized: false,
    },
    // "500k tokens"
    {
      pattern: /\b(\d+(?:\.\d+)?)\s*([km])\s*tokens?\b/i,
      requireTokenSized: false,
    },
  ];

  for (const { pattern, requireTokenSized } of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;

    const suffix = match[2]?.toLowerCase();
    const total = Math.round(Number(match[1]) * suffixMultiplier(suffix));

    // A bare "+3" is far more likely to be "+3 files" than a 3-token budget,
    // and a bogus tiny total would block every agent() call of the turn. Without
    // a k/m suffix the number has to be unambiguously token-sized.
    if (requireTokenSized && !suffix && total < MIN_PLAIN_TOKEN_TARGET) {
      continue;
    }

    // A non-positive target is not a target: report it as "none given".
    return total > 0 ? total : null;
  }

  return null;
}

function suffixMultiplier(suffix: string | undefined): number {
  switch (suffix) {
    case "k":
      return 1_000;
    case "m":
      return 1_000_000;
    default:
      return 1;
  }
}
