import { describe, it, expect } from "vitest";
import {
  TurnBudgetLedger,
  parseTokenBudgetTarget,
} from "../../src/managers/turnBudgetLedger.js";

describe("TurnBudgetLedger", () => {
  describe("total / spent / remaining", () => {
    it("reports no cap and Infinity remaining before any target is set", () => {
      const ledger = new TurnBudgetLedger();

      expect(ledger.total).toBeNull();
      expect(ledger.getTurnSpent()).toBe(0);
      expect(ledger.remaining()).toBe(Infinity);
      expect(ledger.exceededTotal()).toBeNull();
    });

    it("measures spend from the turn's baseline, not from session start", () => {
      const ledger = new TurnBudgetLedger();
      // Tokens burned by an earlier turn must not count against this one
      ledger.addOutputTokens(10_000);
      ledger.beginTurn(1_000);

      expect(ledger.getTurnSpent()).toBe(0);

      ledger.addOutputTokens(400);
      expect(ledger.getTurnSpent()).toBe(400);
      expect(ledger.remaining()).toBe(600);
      expect(ledger.exceededTotal()).toBeNull();
    });

    it("floors remaining at 0 once the total is reached", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(1_000);
      ledger.addOutputTokens(1_500);

      expect(ledger.getTurnSpent()).toBe(1_500);
      expect(ledger.remaining()).toBe(0);
      expect(ledger.exceededTotal()).toBe(1_000);
    });

    it("trips at exactly the total (hard cap, not a suggestion)", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(1_000);
      ledger.addOutputTokens(999);
      expect(ledger.exceededTotal()).toBeNull();

      ledger.addOutputTokens(1);
      expect(ledger.exceededTotal()).toBe(1_000);
    });

    it("treats a null or non-positive total as no cap", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(0);
      ledger.addOutputTokens(5_000);
      expect(ledger.exceededTotal()).toBeNull();
      expect(ledger.remaining()).toBe(0);

      ledger.beginTurn(null);
      expect(ledger.exceededTotal()).toBeNull();
      expect(ledger.remaining()).toBe(Infinity);
    });

    it("ignores non-finite and non-positive charges", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(null);
      ledger.addOutputTokens(0);
      ledger.addOutputTokens(-100);
      ledger.addOutputTokens(Number.NaN);

      expect(ledger.getTurnSpent()).toBe(0);
    });

    it("exposes a readonly view for workflow scripts", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(2_000);
      const budget = ledger.toBudgetInfo();

      expect(budget.total).toBe(2_000);
      expect(budget.spent()).toBe(0);

      // The closures read through, so a later charge is visible to the script
      ledger.addOutputTokens(500);
      expect(budget.spent()).toBe(500);
      expect(budget.remaining()).toBe(1_500);
    });
  });
});

describe("parseTokenBudgetTarget", () => {
  it("parses the `+500k` form", () => {
    expect(parseTokenBudgetTarget("+500k")).toBe(500_000);
    expect(parseTokenBudgetTarget("please do this +500k")).toBe(500_000);
    expect(parseTokenBudgetTarget("+1.5m")).toBe(1_500_000);
    expect(parseTokenBudgetTarget("+250000")).toBe(250_000);
    expect(parseTokenBudgetTarget("+500K")).toBe(500_000);
  });

  it("parses the `use 500k tokens` form", () => {
    expect(parseTokenBudgetTarget("use 500k tokens")).toBe(500_000);
    expect(parseTokenBudgetTarget("Use 200000 tokens for this")).toBe(200_000);
    expect(parseTokenBudgetTarget("use 2m tokens")).toBe(2_000_000);
    expect(parseTokenBudgetTarget("use 500 tokens")).toBe(500);
  });

  it("parses the `500k tokens` form", () => {
    expect(parseTokenBudgetTarget("spend 500k tokens max")).toBe(500_000);
    expect(parseTokenBudgetTarget("500 tokens")).toBeNull();
  });

  it("returns null when the message names no target", () => {
    expect(parseTokenBudgetTarget("")).toBeNull();
    expect(parseTokenBudgetTarget("refactor the parser")).toBeNull();
    expect(parseTokenBudgetTarget("add 3 files")).toBeNull();
  });

  it("does not mistake small counts for a budget", () => {
    // A 1-token budget would block every agent() call of the turn, so a bare
    // "+N" only counts when it is unambiguously token-sized.
    expect(parseTokenBudgetTarget("+3 files")).toBeNull();
    expect(parseTokenBudgetTarget("+1 commit")).toBeNull();
    expect(parseTokenBudgetTarget("+0k")).toBeNull();
  });
});
