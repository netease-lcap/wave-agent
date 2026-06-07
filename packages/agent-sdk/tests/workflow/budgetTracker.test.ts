import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../../src/workflow/budgetTracker.js";

describe("BudgetTracker", () => {
  describe("no budget (total=null)", () => {
    it("spent() returns 0 initially", () => {
      const tracker = new BudgetTracker(null);
      expect(tracker.spent()).toBe(0);
    });

    it("remaining() returns Infinity", () => {
      const tracker = new BudgetTracker(null);
      expect(tracker.remaining()).toBe(Infinity);
    });

    it("isExceeded() returns false", () => {
      const tracker = new BudgetTracker(null);
      tracker.addUsage(999999);
      expect(tracker.isExceeded()).toBe(false);
    });
  });

  describe("with budget", () => {
    it("addUsage accumulates tokens", () => {
      const tracker = new BudgetTracker(1000);
      tracker.addUsage(300);
      tracker.addUsage(200);
      expect(tracker.spent()).toBe(500);
    });

    it("remaining decreases as usage is added", () => {
      const tracker = new BudgetTracker(1000);
      tracker.addUsage(300);
      expect(tracker.remaining()).toBe(700);
    });

    it("remaining is clamped to 0 (never negative)", () => {
      const tracker = new BudgetTracker(100);
      tracker.addUsage(200);
      expect(tracker.remaining()).toBe(0);
    });

    it("isExceeded triggers when spent >= total", () => {
      const tracker = new BudgetTracker(1000);
      expect(tracker.isExceeded()).toBe(false);
      tracker.addUsage(999);
      expect(tracker.isExceeded()).toBe(false);
      tracker.addUsage(1);
      expect(tracker.isExceeded()).toBe(true);
    });

    it("total getter returns the configured budget", () => {
      const tracker = new BudgetTracker(500);
      expect(tracker.total).toBe(500);
    });

    it("total getter returns null when no budget", () => {
      const tracker = new BudgetTracker(null);
      expect(tracker.total).toBe(null);
    });
  });

  describe("toBudgetInfo()", () => {
    it("returns correct structure with budget", () => {
      const tracker = new BudgetTracker(1000);
      tracker.addUsage(250);
      const info = tracker.toBudgetInfo();

      expect(info.total).toBe(1000);
      expect(info.spent()).toBe(250);
      expect(info.remaining()).toBe(750);
    });

    it("returns correct structure without budget", () => {
      const tracker = new BudgetTracker(null);
      const info = tracker.toBudgetInfo();

      expect(info.total).toBeNull();
      expect(info.spent()).toBe(0);
      expect(info.remaining()).toBe(Infinity);
    });
  });
});
